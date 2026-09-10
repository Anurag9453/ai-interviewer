/**
 * LOCAL webhook verification — NOT a Razorpay sandbox test.
 *
 * Signs a payload with the same HMAC-SHA256 scheme Razorpay uses and POSTs it
 * to the locally running dev server, so the full server-side path is
 * exercised against the real database: middleware pass-through → route →
 * signature verification → event-id/idempotency → processWebhookEvent →
 * SupabaseBillingStore → grant_interview_credits RPC.
 *
 * What this does NOT prove: that Razorpay itself can reach us, that its real
 * payload shape matches, or that its signature/header behaviour is as
 * assumed. Only a real Test Mode delivery proves that.
 *
 * Every row it writes is deleted again at the end, and the credit balance is
 * restored to its starting value — it must leave the database exactly as it
 * found it.
 *
 * Run: node --env-file=.env.local --import tsx _verify-webhook-local.ts
 * Requires: dev server on :3000 with the same RAZORPAY_WEBHOOK_SECRET loaded.
 */
import { createHmac, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
// The 0-credits-remaining account, deliberately — never the one still
// holding an unspent free interview credit.
const USER_ID = "32756d8c-2016-4fb2-8ea3-a6d0ab85aa49";
const PRODUCT_ID = "topup_5";

if (!SECRET) {
  console.error("RAZORPAY_WEBHOOK_SECRET is not set — add it to apps/web/.env.local first.");
  process.exit(1);
}

const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const orderId = `order_LOCALTEST_${randomUUID().slice(0, 12)}`;
const paymentId = `pay_LOCALTEST_${randomUUID().slice(0, 12)}`;
const transactionId = randomUUID();
const eventId = `evt_LOCALTEST_${randomUUID().slice(0, 12)}`;

const results: Array<{ check: string; pass: boolean; detail: string }> = [];
function record(check: string, pass: boolean, detail: string) {
  results.push({ check, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${check}${detail ? ` — ${detail}` : ""}`);
}

async function balance(): Promise<{ granted: number; consumed: number }> {
  const { data } = await svc.from("interview_credits").select("granted, consumed").eq("user_id", USER_ID).single();
  return { granted: data!.granted, consumed: data!.consumed };
}

function post(body: string, headers: Record<string, string>) {
  return fetch(`${BASE_URL}/api/billing/webhook`, { method: "POST", body, headers });
}

function signedHeaders(body: string, withEventId: boolean): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "x-razorpay-signature": createHmac("sha256", SECRET!).update(body).digest("hex"),
  };
  if (withEventId) h["x-razorpay-event-id"] = eventId;
  return h;
}

async function cleanup() {
  console.log("\n--- cleanup ---");
  // credit_grants links back via note, not an FK column (grant_interview_credits
  // only writes user_id/source/amount/note).
  const noteKey = `transaction:${transactionId}`;
  const { data: grantRows } = await svc.from("credit_grants").select("id, amount").eq("note", noteKey);
  const grantedBack = (grantRows ?? []).reduce((sum, g) => sum + g.amount, 0);

  // Drop the FK from payment_transactions first, or the grant delete is blocked.
  await svc.from("payment_transactions").update({ credit_grant_id: null }).eq("id", transactionId);
  await svc.from("credit_grants").delete().eq("note", noteKey);
  await svc.from("payment_events").delete().like("provider_event_id", "%LOCALTEST%");
  await svc.from("payment_events").delete().like("provider_event_id", "bodyhash:%");
  await svc.from("payment_transactions").delete().eq("id", transactionId);

  if (grantedBack > 0) {
    const b = await balance();
    await svc.from("interview_credits").update({ granted: b.granted - grantedBack }).eq("user_id", USER_ID);
    console.log(`removed ${grantedBack} test credits, restored granted to ${b.granted - grantedBack}`);
  }
  const final = await balance();
  console.log(`final balance: granted=${final.granted} consumed=${final.consumed}`);
}

async function main() {
  const before = await balance();
  console.log(`baseline: granted=${before.granted} consumed=${before.consumed}\n`);

  const { data: product } = await svc.from("billing_products").select("interview_quantity, price_cents, currency").eq("id", PRODUCT_ID).single();
  const expectedCredits = product!.interview_quantity;

  const { error: seedErr } = await svc.from("payment_transactions").insert({
    id: transactionId, user_id: USER_ID, product_id: PRODUCT_ID, status: "pending",
    amount_cents: product!.price_cents, currency: product!.currency, provider_order_id: orderId,
  });
  if (seedErr) throw new Error(`seed failed: ${seedErr.message}`);
  console.log(`seeded pending transaction ${transactionId} (order ${orderId})\n`);

  const body = JSON.stringify({
    entity: "event", account_id: "acc_LOCALTEST", event: "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: paymentId, order_id: orderId, amount: product!.price_cents,
          currency: product!.currency, status: "captured",
          notes: { userId: USER_ID, productId: PRODUCT_ID, transactionId },
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  });

  // 1. tampered signature must be rejected
  const bad = await post(body, { "content-type": "application/json", "x-razorpay-signature": "0".repeat(64) });
  record("invalid signature rejected", bad.status === 400, `status=${bad.status} body=${JSON.stringify(await bad.json())}`);

  // 2. valid signature grants credits
  const ok = await post(body, signedHeaders(body, true));
  const okBody = await ok.json();
  record("valid signature processed", ok.status === 200 && okBody.status === "processed", `status=${ok.status} body=${JSON.stringify(okBody)}`);

  const afterGrant = await balance();
  record("credits granted", afterGrant.granted === before.granted + expectedCredits,
    `granted ${before.granted} -> ${afterGrant.granted} (expected +${expectedCredits})`);

  const { data: txnAfter } = await svc.from("payment_transactions").select("status").eq("id", transactionId).single();
  record("transaction marked captured", txnAfter?.status === "captured", `status=${txnAfter?.status}`);

  const { data: grantRow } = await svc.from("credit_grants").select("id, source, amount").eq("note", `transaction:${transactionId}`).single();
  record("credit_grants ledger row written", grantRow?.source === "topup" && grantRow?.amount === expectedCredits,
    `source=${grantRow?.source} amount=${grantRow?.amount}`);

  const { data: linkRow } = await svc.from("payment_transactions").select("credit_grant_id").eq("id", transactionId).single();
  record("transaction linked to its grant row", linkRow?.credit_grant_id === grantRow?.id,
    `credit_grant_id=${linkRow?.credit_grant_id ?? "null"}`);

  const { data: eventRow } = await svc.from("payment_events").select("provider_event_id, event_type").eq("provider_event_id", eventId).maybeSingle();
  record("payment_events row uses the header event id", eventRow?.provider_event_id === eventId,
    `stored=${eventRow?.provider_event_id ?? "none"} type=${eventRow?.event_type ?? "-"}`);

  // 3. exact replay is idempotent
  const replay = await post(body, signedHeaders(body, true));
  const replayBody = await replay.json();
  record("duplicate delivery is idempotent", replayBody.status === "already_processed", `body=${JSON.stringify(replayBody)}`);

  const afterReplay = await balance();
  record("replay granted no extra credits", afterReplay.granted === afterGrant.granted,
    `granted still ${afterReplay.granted}`);

  // 4. same body with NO event-id header -> body-hash fallback key, and since
  //    the transaction is already captured, it must not re-grant either.
  const noHeader = await post(body, signedHeaders(body, false));
  const noHeaderBody = await noHeader.json();
  const { data: hashEvents } = await svc.from("payment_events").select("provider_event_id").like("provider_event_id", "bodyhash:%");
  record("no-header delivery falls back to a body hash key", (hashEvents ?? []).length === 1,
    `rows=${JSON.stringify((hashEvents ?? []).map((e) => e.provider_event_id.slice(0, 24) + "..."))} response=${JSON.stringify(noHeaderBody)}`);

  const afterNoHeader = await balance();
  record("already-captured transaction is not double-granted", afterNoHeader.granted === afterGrant.granted,
    `granted still ${afterNoHeader.granted}`);

  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed`);
}

main()
  .catch((err) => {
    console.error("\nverification aborted:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(cleanup);
