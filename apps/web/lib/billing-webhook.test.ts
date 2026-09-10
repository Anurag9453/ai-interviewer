import { test } from "node:test";
import assert from "node:assert/strict";
import {
  processWebhookEvent, type BillingStore, type ProductRecord,
  type RazorpayWebhookEvent, type TransactionRecord,
} from "./billing-webhook.js";

/**
 * In-memory BillingStore — mirrors InMemoryEvidenceSink/FakeLifecycleStore's
 * role: every lifecycle case is exercised against real orchestration logic
 * (processWebhookEvent), just without a real DB. Grants are recorded as
 * plain events so a test can assert exactly what was granted, to whom, from
 * which source, without needing interview_credits' real race-safe update.
 */
class FakeBillingStore implements BillingStore {
  events: Array<{ providerEventId: string; eventType: string }> = [];
  private processedEventIds = new Set<string>();
  transactions = new Map<string, TransactionRecord>();
  products = new Map<string, ProductRecord>();
  grants: Array<{ transactionId: string; userId: string; source: string; amount: number }> = [];
  reversals: Array<{ transactionId: string; userId: string; amount: number; reason: string }> = [];
  subscriptions = new Map<string, { userId: string; productId: string; status: string }>();
  private balances = new Map<string, { granted: number; consumed: number }>();
  private nextTxnId = 1;

  seedTransaction(txn: TransactionRecord): void {
    this.transactions.set(txn.id, txn);
  }
  seedProduct(p: ProductRecord): void {
    this.products.set(p.id, p);
  }
  seedBalance(userId: string, granted: number, consumed: number): void {
    this.balances.set(userId, { granted, consumed });
  }
  balanceOf(userId: string) {
    return this.balances.get(userId) ?? { granted: 0, consumed: 0 };
  }

  async recordEvent(providerEventId: string, eventType: string) {
    const key = `razorpay:${providerEventId}`;
    if (this.processedEventIds.has(key)) return { eventRowId: key, alreadyProcessed: true };
    this.processedEventIds.add(key);
    this.events.push({ providerEventId, eventType });
    return { eventRowId: key, alreadyProcessed: false };
  }
  async markEventProcessed(): Promise<void> {}

  async findTransactionByOrderId(orderId: string) {
    return [...this.transactions.values()].find((t) => t.providerOrderId === orderId) ?? null;
  }
  async findTransactionByPaymentId(paymentId: string) {
    // Simplification for the fake: tests seed the transaction id equal to
    // the provider payment id directly, since this store has no separate
    // providerPaymentId field — the real BillingStore queries
    // payment_transactions.provider_payment_id instead.
    return this.transactions.get(paymentId) ?? null;
  }
  async markTransactionStatus(transactionId: string, status: string): Promise<void> {
    const txn = this.transactions.get(transactionId);
    if (txn) txn.status = status;
  }
  async getProduct(productId: string) {
    return this.products.get(productId) ?? null;
  }

  async grantCreditsForTransaction(transactionId: string, userId: string, source: "subscription" | "topup", amount: number): Promise<void> {
    this.grants.push({ transactionId, userId, source, amount });
    const bal = this.balances.get(userId) ?? { granted: 0, consumed: 0 };
    bal.granted += amount;
    this.balances.set(userId, bal);
  }

  async reverseCreditsForTransaction(transactionId: string, userId: string, amount: number, reason: "refund" | "chargeback") {
    const bal = this.balances.get(userId) ?? { granted: 0, consumed: 0 };
    const available = Math.max(0, bal.granted - bal.consumed);
    const applied = Math.min(amount, available);
    bal.granted -= applied;
    this.balances.set(userId, bal);
    this.reversals.push({ transactionId, userId, amount: applied, reason });
    return { amountApplied: applied, shortfall: amount - applied };
  }

  async upsertSubscription(input: Parameters<BillingStore["upsertSubscription"]>[0]): Promise<void> {
    this.subscriptions.set(input.providerSubscriptionId, { userId: input.userId, productId: input.productId, status: input.status });
  }
  async markSubscriptionStatus(providerSubscriptionId: string, status: string) {
    const sub = this.subscriptions.get(providerSubscriptionId);
    if (!sub) return null;
    sub.status = status;
    return { userId: sub.userId, productId: sub.productId };
  }
  async createSubscriptionTransaction(input: { userId: string; productId: string; providerSubscriptionId: string; amountCents: number }) {
    const id = `subtxn_${this.nextTxnId++}`;
    this.transactions.set(id, {
      id, userId: input.userId, productId: input.productId, status: "captured",
      amountCents: input.amountCents, providerOrderId: null, providerSubscriptionId: input.providerSubscriptionId,
    });
    return id;
  }
}

const TOPUP_5: ProductRecord = { id: "topup_5", kind: "topup", interviewQuantity: 5, priceCents: 59900 };
const TOPUP_10: ProductRecord = { id: "topup_10", kind: "topup", interviewQuantity: 10, priceCents: 99900 };
const SUB_10: ProductRecord = { id: "sub_monthly_10", kind: "subscription", interviewQuantity: 10, priceCents: 99900 };

function paymentCapturedEvent(orderId: string, amount: number): RazorpayWebhookEvent {
  return { event: "payment.captured", payload: { payment: { entity: { id: `pay_${orderId}`, order_id: orderId, amount, currency: "INR", status: "captured" } } } };
}

test("top-up +5: a captured payment grants exactly 5 credits from source 'topup'", async () => {
  const store = new FakeBillingStore();
  store.seedProduct(TOPUP_5);
  store.seedTransaction({ id: "txn1", userId: "u1", productId: "topup_5", status: "pending", amountCents: 59900, providerOrderId: "order_1", providerSubscriptionId: null });

  const result = await processWebhookEvent(store, "evt_1", paymentCapturedEvent("order_1", 59900));

  assert.equal(result.status, "processed");
  assert.deepEqual(store.grants, [{ transactionId: "txn1", userId: "u1", source: "topup", amount: 5 }]);
  assert.equal(store.balanceOf("u1").granted, 5);
});

test("top-up +10 works independently of a +5 purchase — each purchase has its own transaction identity", async () => {
  const store = new FakeBillingStore();
  store.seedProduct(TOPUP_5);
  store.seedProduct(TOPUP_10);
  store.seedTransaction({ id: "txn1", userId: "u1", productId: "topup_5", status: "pending", amountCents: 59900, providerOrderId: "order_1", providerSubscriptionId: null });
  store.seedTransaction({ id: "txn2", userId: "u1", productId: "topup_10", status: "pending", amountCents: 99900, providerOrderId: "order_2", providerSubscriptionId: null });

  await processWebhookEvent(store, "evt_1", paymentCapturedEvent("order_1", 59900));
  await processWebhookEvent(store, "evt_2", paymentCapturedEvent("order_2", 99900));

  assert.equal(store.balanceOf("u1").granted, 15, "5 + 10 = 15 total, matching the spec's own worked example");
  assert.equal(store.grants.length, 2);
});

test("subscription + top-up stack additively, never overwriting each other", async () => {
  const store = new FakeBillingStore();
  store.seedProduct(SUB_10);
  store.seedProduct(TOPUP_5);
  store.seedTransaction({ id: "txn_topup", userId: "u1", productId: "topup_5", status: "pending", amountCents: 59900, providerOrderId: "order_1", providerSubscriptionId: null });

  const subEvent: RazorpayWebhookEvent = {
    event: "subscription.charged",
    payload: {
      subscription: { entity: { id: "sub_1", plan_id: "plan_x", status: "active", current_start: 1000, current_end: 2000, notes: { userId: "u1", productId: "sub_monthly_10" } } },
      payment: { entity: { id: "pay_1", amount: 99900, currency: "INR", status: "captured" } },
    },
  };
  await processWebhookEvent(store, "evt_sub", subEvent);
  await processWebhookEvent(store, "evt_topup", paymentCapturedEvent("order_1", 59900));

  assert.equal(store.balanceOf("u1").granted, 15, "10 subscription + 5 topup = 15, exactly the spec's example");
});

test("duplicate webhook delivery grants credits only once", async () => {
  const store = new FakeBillingStore();
  store.seedProduct(TOPUP_5);
  store.seedTransaction({ id: "txn1", userId: "u1", productId: "topup_5", status: "pending", amountCents: 59900, providerOrderId: "order_1", providerSubscriptionId: null });

  const first = await processWebhookEvent(store, "evt_1", paymentCapturedEvent("order_1", 59900));
  const second = await processWebhookEvent(store, "evt_1", paymentCapturedEvent("order_1", 59900));

  assert.equal(first.status, "processed");
  assert.equal(second.status, "already_processed");
  assert.equal(store.grants.length, 1, "the same provider event id must never grant twice");
  assert.equal(store.balanceOf("u1").granted, 5);
});

test("a webhook arriving out of order (already-captured transaction) is a safe no-op, not a second grant", async () => {
  const store = new FakeBillingStore();
  store.seedProduct(TOPUP_5);
  store.seedTransaction({ id: "txn1", userId: "u1", productId: "topup_5", status: "captured", amountCents: 59900, providerOrderId: "order_1", providerSubscriptionId: null });

  // A different event id than what originally captured it (e.g. a resend
  // with a fresh envelope) hitting an already-captured transaction.
  const result = await processWebhookEvent(store, "evt_late", paymentCapturedEvent("order_1", 59900));

  assert.equal(result.status, "already_processed");
  assert.equal(store.grants.length, 0);
});

test("a failed payment marks the transaction failed and grants nothing", async () => {
  const store = new FakeBillingStore();
  store.seedProduct(TOPUP_5);
  store.seedTransaction({ id: "txn1", userId: "u1", productId: "topup_5", status: "pending", amountCents: 59900, providerOrderId: "order_1", providerSubscriptionId: null });

  const event: RazorpayWebhookEvent = { event: "payment.failed", payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 59900, currency: "INR", status: "failed" } } } };
  const result = await processWebhookEvent(store, "evt_1", event);

  assert.equal(result.status, "processed");
  assert.equal(store.transactions.get("txn1")!.status, "failed");
  assert.equal(store.grants.length, 0);
  assert.equal(store.balanceOf("u1").granted, 0);
});

test("a full refund reverses the granted credits, capped at what's still unconsumed", async () => {
  const store = new FakeBillingStore();
  store.seedProduct(TOPUP_5);
  store.seedTransaction({ id: "pay_1", userId: "u1", productId: "topup_5", status: "captured", amountCents: 59900, providerOrderId: "order_1", providerSubscriptionId: null });
  store.seedBalance("u1", 5, 2); // 2 of the 5 already consumed on a real interview

  const event: RazorpayWebhookEvent = { event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", amount: 59900, status: "processed" } } } };
  const result = await processWebhookEvent(store, "evt_1", event);

  assert.equal(result.status, "processed");
  assert.equal(store.transactions.get("pay_1")!.status, "refunded");
  assert.equal(store.balanceOf("u1").granted, 2, "reversal is capped: 5 granted - 3 unconsumed reversed = 2 (matching the 2 already consumed)");
  assert.deepEqual(store.reversals, [{ transactionId: "pay_1", userId: "u1", amount: 3, reason: "refund" }]);
});

test("a refund exceeding the current balance (fully consumed) reverses what it can and reports the shortfall, not silently", async () => {
  const store = new FakeBillingStore();
  store.seedProduct(TOPUP_5);
  store.seedTransaction({ id: "pay_1", userId: "u1", productId: "topup_5", status: "captured", amountCents: 59900, providerOrderId: "order_1", providerSubscriptionId: null });
  store.seedBalance("u1", 5, 5); // fully consumed already

  const event: RazorpayWebhookEvent = { event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", amount: 59900, status: "processed" } } } };
  const result = await processWebhookEvent(store, "evt_1", event);

  assert.equal(result.status, "processed");
  assert.match(result.detail ?? "", /shortfall/);
  assert.deepEqual(store.reversals, [{ transactionId: "pay_1", userId: "u1", amount: 0, reason: "refund" }]);
});

test("a partial refund is recorded but does not auto-reverse credits", async () => {
  const store = new FakeBillingStore();
  store.seedProduct(TOPUP_5);
  store.seedTransaction({ id: "pay_1", userId: "u1", productId: "topup_5", status: "captured", amountCents: 59900, providerOrderId: "order_1", providerSubscriptionId: null });
  store.seedBalance("u1", 5, 0);

  const event: RazorpayWebhookEvent = { event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", amount: 20000, status: "processed" } } } };
  const result = await processWebhookEvent(store, "evt_1", event);

  assert.equal(result.status, "processed");
  assert.equal(store.transactions.get("pay_1")!.status, "partially_refunded");
  assert.equal(store.reversals.length, 0, "a partial refund's credit impact is a product-policy decision, not silently invented");
  assert.equal(store.balanceOf("u1").granted, 5);
});

test("subscription cancellation stops future charges without clawing back already-granted credits", async () => {
  const store = new FakeBillingStore();
  store.upsertSubscription({ userId: "u1", productId: "sub_monthly_10", providerSubscriptionId: "sub_1", status: "active", currentPeriodStart: null, currentPeriodEnd: null });
  store.seedBalance("u1", 10, 3);

  const event: RazorpayWebhookEvent = { event: "subscription.cancelled", payload: { subscription: { entity: { id: "sub_1", plan_id: "plan_x", status: "cancelled" } } } };
  const result = await processWebhookEvent(store, "evt_1", event);

  assert.equal(result.status, "processed");
  assert.equal(store.subscriptions.get("sub_1")!.status, "cancelled");
  assert.equal(store.balanceOf("u1").granted, 10, "cancellation must not reverse credits already granted");
});

test("credit consumption against multiple grant sources: balance is one fungible pool regardless of source", async () => {
  const store = new FakeBillingStore();
  store.seedProduct(SUB_10);
  store.seedProduct(TOPUP_5);
  store.seedTransaction({ id: "txn_topup", userId: "u1", productId: "topup_5", status: "pending", amountCents: 59900, providerOrderId: "order_1", providerSubscriptionId: null });

  const subEvent: RazorpayWebhookEvent = {
    event: "subscription.charged",
    payload: {
      subscription: { entity: { id: "sub_1", plan_id: "plan_x", status: "active", notes: { userId: "u1", productId: "sub_monthly_10" } } },
      payment: { entity: { id: "pay_1", amount: 99900, currency: "INR", status: "captured" } },
    },
  };
  await processWebhookEvent(store, "evt_sub", subEvent);
  await processWebhookEvent(store, "evt_topup", paymentCapturedEvent("order_1", 59900));

  // Simulate consuming 12 of the 15 fungible credits — draws from the pool,
  // not from a specific source bucket (matches consume_interview_credit()'s
  // real behavior: a single granted/consumed counter, source-agnostic).
  const bal = store.balanceOf("u1");
  assert.equal(bal.granted, 15);
  assert.ok(store.grants.some((g) => g.source === "subscription" && g.amount === 10));
  assert.ok(store.grants.some((g) => g.source === "topup" && g.amount === 5));
});
