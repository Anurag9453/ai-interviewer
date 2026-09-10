import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { handleWebhook } from "./handler.js";
import type { BillingStore, ProductRecord, TransactionRecord } from "@/lib/billing-webhook";

/**
 * Route-boundary tests only: signature gate, event-id/hash derivation, JSON
 * parsing, env-var handling. The billing lifecycle itself (grants, refunds,
 * duplicates-by-id at the orchestration layer) is already covered by
 * billing-webhook.test.ts against processWebhookEvent directly — not
 * repeated here. This fake store exists only so a signature-valid request
 * has somewhere to land; its `event` bodies are deliberately the
 * already-verified "ignored" shape (payment.captured with no order_id) so
 * assertions stay about the route, not the billing outcome.
 */
class RecordingStore implements BillingStore {
  recordCalls: Array<{ providerEventId: string; eventType: string }> = [];
  private processedIds = new Set<string>();

  async recordEvent(providerEventId: string, eventType: string) {
    this.recordCalls.push({ providerEventId, eventType });
    if (this.processedIds.has(providerEventId)) return { eventRowId: providerEventId, alreadyProcessed: true };
    this.processedIds.add(providerEventId);
    return { eventRowId: providerEventId, alreadyProcessed: false };
  }
  async markEventProcessed(): Promise<void> {}
  async findTransactionByOrderId(): Promise<TransactionRecord | null> { return null; }
  async findTransactionByPaymentId(): Promise<TransactionRecord | null> { return null; }
  async markTransactionStatus(): Promise<void> {}
  async getProduct(): Promise<ProductRecord | null> { return null; }
  async grantCreditsForTransaction(): Promise<void> {}
  async reverseCreditsForTransaction() { return { amountApplied: 0, shortfall: 0 }; }
  async upsertSubscription(): Promise<void> {}
  async markSubscriptionStatus() { return null; }
  async createSubscriptionTransaction(): Promise<string> { return "txn_test"; }
}

const WEBHOOK_SECRET = "whsec_test_only_not_real";

// payment.captured with no order_id is a deterministic, store-independent
// "ignored" outcome in billing-webhook.ts — safe filler for route tests that
// aren't asserting on billing behavior.
const IGNORED_EVENT_BODY = JSON.stringify({
  event: "payment.captured",
  payload: { payment: { entity: { id: "pay_test123", order_id: null, amount: 100, currency: "INR", status: "captured" } } },
});

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/billing/webhook", { method: "POST", body, headers });
}

let originalSecret: string | undefined;
let originalKeyId: string | undefined;

beforeEach(() => {
  originalSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  originalKeyId = process.env.RAZORPAY_KEY_ID;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  // Deliberately absent: the webhook path must verify signatures without any
  // Razorpay API credentials (a missing key_id used to throw inside the SDK
  // constructor and 500 the whole route).
  delete process.env.RAZORPAY_KEY_ID;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET; else process.env.RAZORPAY_WEBHOOK_SECRET = originalSecret;
  if (originalKeyId === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = originalKeyId;
});

test("a validly signed request reaches processWebhookEvent and returns its result", async () => {
  const store = new RecordingStore();
  const req = makeRequest(IGNORED_EVENT_BODY, {
    "x-razorpay-signature": sign(IGNORED_EVENT_BODY),
    "x-razorpay-event-id": "evt_valid_1",
  });
  const res = await handleWebhook(req, store);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ignored");
  assert.equal(store.recordCalls.length, 1);
  assert.equal(store.recordCalls[0]!.providerEventId, "evt_valid_1");
});

test("an invalid signature is rejected before any billing processing", async () => {
  const store = new RecordingStore();
  const req = makeRequest(IGNORED_EVENT_BODY, {
    "x-razorpay-signature": sign(IGNORED_EVENT_BODY, "wrong_secret"),
    "x-razorpay-event-id": "evt_should_not_process",
  });
  const res = await handleWebhook(req, store);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "invalid_signature");
  assert.equal(store.recordCalls.length, 0, "an invalid signature must never reach the store");
});

test("x-razorpay-event-id header present is used verbatim as the idempotency key", async () => {
  const store = new RecordingStore();
  const req = makeRequest(IGNORED_EVENT_BODY, {
    "x-razorpay-signature": sign(IGNORED_EVENT_BODY),
    "x-razorpay-event-id": "evt_exact_header_value",
  });
  await handleWebhook(req, store);
  assert.deepEqual(store.recordCalls, [{ providerEventId: "evt_exact_header_value", eventType: "payment.captured" }]);
});

test("header absent falls back to a full SHA-256 digest of the raw body", async () => {
  const store = new RecordingStore();
  const req = makeRequest(IGNORED_EVENT_BODY, { "x-razorpay-signature": sign(IGNORED_EVENT_BODY) });
  await handleWebhook(req, store);
  assert.equal(store.recordCalls.length, 1);
  const expectedHash = `bodyhash:${createHash("sha256").update(IGNORED_EVENT_BODY).digest("hex")}`;
  assert.equal(store.recordCalls[0]!.providerEventId, expectedHash);
  // Full hex digest, not a truncated prefix — this is exactly the gap that was hardened.
  assert.equal(store.recordCalls[0]!.providerEventId.length, "bodyhash:".length + 64);
});

test("two identical requests without the header derive the same fallback key, and the second is a duplicate", async () => {
  const store = new RecordingStore();
  const req1 = makeRequest(IGNORED_EVENT_BODY, { "x-razorpay-signature": sign(IGNORED_EVENT_BODY) });
  const req2 = makeRequest(IGNORED_EVENT_BODY, { "x-razorpay-signature": sign(IGNORED_EVENT_BODY) });

  const res1 = await handleWebhook(req1, store);
  const res2 = await handleWebhook(req2, store);

  assert.equal((await res1.json()).status, "ignored");
  assert.equal((await res2.json()).status, "already_processed", "same derived key -> the store's idempotency gate catches the second delivery");
  assert.equal(store.recordCalls.length, 2, "recordEvent is still called each time — the store decides alreadyProcessed");
  assert.equal(store.recordCalls[0]!.providerEventId, store.recordCalls[1]!.providerEventId, "same body -> same fallback key");
});

test("a malformed, non-JSON body with an otherwise-invalid signature is rejected safely, never reaching JSON.parse", async () => {
  const store = new RecordingStore();
  const malformed = "{not json, missing secret so this would also fail signature";
  const req = makeRequest(malformed, { "x-razorpay-signature": "0".repeat(64) });
  const res = await handleWebhook(req, store);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "invalid_signature");
  assert.equal(store.recordCalls.length, 0);
});

test("a malformed, non-JSON body with a VALID signature is rejected as invalid_json, not a 500", async () => {
  const store = new RecordingStore();
  const malformed = "{not json}";
  const req = makeRequest(malformed, { "x-razorpay-signature": sign(malformed) });
  const res = await handleWebhook(req, store);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "invalid_json");
  assert.equal(store.recordCalls.length, 0);
});

test("missing signature header is rejected before touching the secret-derived HMAC", async () => {
  const store = new RecordingStore();
  const req = makeRequest(IGNORED_EVENT_BODY, {});
  const res = await handleWebhook(req, store);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "missing_signature");
  assert.equal(store.recordCalls.length, 0);
});

test("a missing RAZORPAY_WEBHOOK_SECRET returns a graceful 503 exposing only the env-var name", async () => {
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  const store = new RecordingStore();
  const req = makeRequest(IGNORED_EVENT_BODY, { "x-razorpay-signature": sign(IGNORED_EVENT_BODY) });
  const res = await handleWebhook(req, store);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "webhook_not_configured");
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes(WEBHOOK_SECRET), "the response must never echo back a secret value");
  assert.equal(store.recordCalls.length, 0);
});
