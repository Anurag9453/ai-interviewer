import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyRazorpayWebhookSignature } from "@ai/core";
import { processWebhookEvent, type BillingStore, type RazorpayWebhookEvent } from "@/lib/billing-webhook";

/**
 * Razorpay webhook receiver. The raw body text is read and verified BEFORE
 * any JSON parsing — signature verification hashes the exact raw bytes, and
 * `request.json()` would have already consumed/reformatted the stream.
 * Never trusts a client; this is the ONLY path that grants credits for a
 * real payment.
 *
 * `store` is injected (same DI seam processWebhookEvent already uses) so
 * route.test.ts can exercise the real signature/idempotency/parsing logic
 * below with a fake store — no Supabase, no network. `POST` in route.ts
 * binds the real SupabaseBillingStore; that binding itself isn't covered by
 * a route test, same as SupabaseBillingStore's own thin DB calls aren't
 * unit-tested.
 *
 * Lives outside route.ts because Next.js's generated route types only allow
 * specific named exports (GET/POST/etc., config, ...) on a route.ts file —
 * exporting this here too fails `next build`'s type check.
 */
export async function handleWebhook(request: Request, store: BillingStore) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("billing webhook received but RAZORPAY_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  if (!signature) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  // Verification needs only the webhook secret — no Razorpay client, so a
  // missing RAZORPAY_KEY_ID (an outbound-checkout concern) can't 500 the
  // inbound webhook path.
  const { valid } = verifyRazorpayWebhookSignature(rawBody, signature, secret);
  if (!valid) {
    console.error("billing webhook signature verification failed");
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event: RazorpayWebhookEvent & { id?: string };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Razorpay is widely documented (third-party integration guides, not a
  // first-party page I could pull directly) to send an `x-razorpay-event-id`
  // header carrying a stable id per delivery — the JSON body itself has no
  // top-level event id (confirmed from Razorpay's own payload docs: only
  // entity/account_id/event/contains/payload/created_at). Genuinely unverified
  // against a live delivery — the FIRST real webhook received should have
  // its headers logged and checked against this assumption before trusting
  // it further. The fallback is real SHA-256 of the full raw body, not a
  // truncated prefix, so idempotency stays collision-safe even if the
  // header assumption turns out wrong.
  const eventIdHeader = request.headers.get("x-razorpay-event-id");
  if (!eventIdHeader) {
    console.warn("billing webhook: x-razorpay-event-id header absent — falling back to a body hash for idempotency; verify this against Razorpay's real headers on first delivery");
  }
  const providerEventId = eventIdHeader ?? `bodyhash:${createHash("sha256").update(rawBody).digest("hex")}`;

  const result = await processWebhookEvent(store, providerEventId, event);

  // Always 200 for a signature-valid webhook Razorpay delivered correctly —
  // a 4xx/5xx here would make Razorpay retry a webhook that isn't actually
  // going to succeed differently (e.g. "ignored: no matching transaction"),
  // per Razorpay's own webhook retry guidance. `result.status === "error"`
  // is logged for investigation but still acknowledged.
  if (result.status === "error") console.error("billing webhook processing error", result.detail);
  return NextResponse.json({ status: result.status, detail: result.detail });
}
