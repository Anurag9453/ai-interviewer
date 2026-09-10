import { NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminRequest } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET() {
  const auth = await checkAdminRequest();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const service = createServiceClient();
  const [{ data: promotions, error: promoError }, { data: redemptionCounts, error: countError }] = await Promise.all([
    service.from("promotions").select("*").order("created_at", { ascending: false }),
    service.from("promotion_redemptions").select("promotion_id"),
  ]);

  // Previously both errors were discarded, so a failed query rendered as
  // "no promotions" — indistinguishable from genuinely having none, which is
  // a dangerous thing to show an admin about discount configuration.
  if (promoError || countError) {
    console.error("admin promotions list failed", { promoError, countError });
    return NextResponse.json({ error: "promotions_unavailable" }, { status: 502 });
  }

  const counts = new Map<string, number>();
  for (const r of redemptionCounts ?? []) counts.set(r.promotion_id, (counts.get(r.promotion_id) ?? 0) + 1);

  return NextResponse.json({
    promotions: (promotions ?? []).map((p) => ({ ...p, redemptionCount: counts.get(p.id) ?? 0 })),
  });
}

const CreatePromoSchema = z.object({
  code: z.string().min(3).max(40),
  percentOff: z.number().min(0).max(100).optional(),
  amountOffCents: z.number().int().min(0).optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  redemptionLimit: z.number().int().min(1).optional(),
  perUserLimit: z.number().int().min(1).default(1),
  applicableProductIds: z.array(z.string()).optional(),
  minAmountCents: z.number().int().min(0).optional(),
}).refine((v) => v.percentOff !== undefined || v.amountOffCents !== undefined, {
  message: "either percentOff or amountOffCents is required",
});

export async function POST(request: Request) {
  const auth = await checkAdminRequest();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const parsed = CreatePromoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });

  const service = createServiceClient();
  const { data, error } = await service.from("promotions").insert({
    code: parsed.data.code.toUpperCase(),
    percent_off: parsed.data.percentOff ?? null,
    amount_off_cents: parsed.data.amountOffCents ?? null,
    starts_at: parsed.data.startsAt ?? null,
    ends_at: parsed.data.endsAt ?? null,
    redemption_limit: parsed.data.redemptionLimit ?? null,
    per_user_limit: parsed.data.perUserLimit,
    applicable_product_ids: parsed.data.applicableProductIds ?? null,
    min_amount_cents: parsed.data.minAmountCents ?? null,
    active: true,
  }).select("*").single();

  if (error) {
    // Raw Postgres text carries constraint and column names, so it stays in
    // the log. A duplicate code is the one genuinely expected failure and is
    // worth naming, because "already exists" is actionable and "create
    // failed" is not.
    console.error("promotion create failed", { code: parsed.data.code.toUpperCase(), error });
    const isDuplicate = error.code === "23505";
    return NextResponse.json(
      isDuplicate
        ? { error: "code_exists", message: "That promo code already exists." }
        : { error: "create_failed", message: "Couldn't create the promotion." },
      { status: isDuplicate ? 409 : 500 },
    );
  }
  return NextResponse.json({ promotion: data });
}
