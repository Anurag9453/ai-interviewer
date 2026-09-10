import { NextResponse } from "next/server";
import { z } from "zod";
import { RazorpayProvider } from "@ai/core";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validatePromo, type PromotionRecord } from "@/lib/promo";

const BodySchema = z.object({
  productId: z.string().min(1),
  promoCode: z.string().min(1).optional(),
});

/**
 * Creates a Razorpay order (topup) or subscription, after server-side promo
 * validation and final-amount calculation — never trusts a client-supplied
 * amount. No credits are granted here; that only happens once the webhook
 * confirms a real, signature-verified payment event.
 */
export async function POST(request: Request) {
  const missing = (["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"] as const).filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return NextResponse.json({ error: "billing_not_configured", missingEnv: missing }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  // billing_products has RLS "read active" for authenticated — the cookie
  // client is sufficient and correct here, no service-role needed.
  const { data: product } = await supabase
    .from("billing_products").select("*").eq("id", parsed.data.productId).eq("active", true).single();
  if (!product) return NextResponse.json({ error: "unknown_product" }, { status: 404 });

  const service = createServiceClient();
  let finalAmountCents = product.price_cents;
  let discountCents = 0;
  let promotionId: string | null = null;

  if (parsed.data.promoCode) {
    // promotions has NO client policy at all — every read here is
    // service-role, the same trust model as question_pool.
    const { data: promoRow } = await service.from("promotions").select("*").eq("code", parsed.data.promoCode).single();
    if (!promoRow) return NextResponse.json({ error: "invalid_promo_code" }, { status: 400 });

    const [{ count: totalRedemptions }, { count: userRedemptions }] = await Promise.all([
      service.from("promotion_redemptions").select("*", { count: "exact", head: true }).eq("promotion_id", promoRow.id),
      service.from("promotion_redemptions").select("*", { count: "exact", head: true }).eq("promotion_id", promoRow.id).eq("user_id", userId),
    ]);

    const record: PromotionRecord = {
      id: promoRow.id, code: promoRow.code, percentOff: promoRow.percent_off, amountOffCents: promoRow.amount_off_cents,
      active: promoRow.active, startsAt: promoRow.starts_at ? new Date(promoRow.starts_at) : null,
      endsAt: promoRow.ends_at ? new Date(promoRow.ends_at) : null, redemptionLimit: promoRow.redemption_limit,
      perUserLimit: promoRow.per_user_limit, applicableProductIds: promoRow.applicable_product_ids,
      minAmountCents: promoRow.min_amount_cents,
    };
    const result = validatePromo({
      promotion: record, productId: product.id, baseAmountCents: product.price_cents, now: new Date(),
      totalRedemptions: totalRedemptions ?? 0, userRedemptions: userRedemptions ?? 0,
    });
    if (!result.ok) return NextResponse.json({ error: "promo_not_applicable", reason: result.reason }, { status: 400 });
    finalAmountCents = result.finalAmountCents;
    discountCents = result.discountCents;
    promotionId = promoRow.id;
  }

  const provider = new RazorpayProvider({ keyId: process.env.RAZORPAY_KEY_ID!, keySecret: process.env.RAZORPAY_KEY_SECRET! });
  const transactionId = crypto.randomUUID();

  try {
    if (product.kind === "topup") {
      const order = await provider.createOrder({
        amountCents: finalAmountCents, currency: product.currency,
        notes: { userId, productId: product.id, transactionId },
        receipt: transactionId,
      });
      await service.from("payment_transactions").insert({
        id: transactionId, user_id: userId, product_id: product.id, status: "pending",
        amount_cents: finalAmountCents, currency: product.currency,
        provider_order_id: order.providerOrderId, promotion_id: promotionId, discount_cents: discountCents,
      });
      if (promotionId) {
        await service.from("promotion_redemptions").insert({ promotion_id: promotionId, user_id: userId, payment_transaction_id: transactionId });
      }
      return NextResponse.json({
        kind: "order", orderId: order.providerOrderId, amountCents: finalAmountCents,
        currency: product.currency, keyId: process.env.RAZORPAY_KEY_ID,
      });
    }

    if (!product.provider_plan_id) {
      return NextResponse.json({ error: "subscription_plan_not_configured" }, { status: 503 });
    }
    const sub = await provider.createSubscription({
      providerPlanId: product.provider_plan_id, totalCount: 12,
      notes: { userId, productId: product.id, transactionId },
    });
    await service.from("payment_transactions").insert({
      id: transactionId, user_id: userId, product_id: product.id, status: "pending",
      amount_cents: finalAmountCents, currency: product.currency,
      provider_subscription_id: sub.providerSubscriptionId, promotion_id: promotionId, discount_cents: discountCents,
    });
    if (promotionId) {
      await service.from("promotion_redemptions").insert({ promotion_id: promotionId, user_id: userId, payment_transaction_id: transactionId });
    }
    return NextResponse.json({
      kind: "subscription", subscriptionId: sub.providerSubscriptionId,
      amountCents: finalAmountCents, currency: product.currency, keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("checkout failed", err);
    return NextResponse.json({ error: "checkout_failed" }, { status: 502 });
  }
}
