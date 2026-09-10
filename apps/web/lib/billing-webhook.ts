/**
 * Payment webhook orchestration — pure decision logic over an injected
 * BillingStore, so every lifecycle case (capture, failure, renewal,
 * cancellation, refund, duplicate delivery) is testable with a fake store
 * and zero network/DB, mirroring interview-lifecycle.ts's pattern from
 * M6.1. The actual route (app/api/billing/webhook/route.ts) is a thin
 * shell: verify signature, parse, call processWebhookEvent, done.
 *
 * Idempotency is two-layered: the DB's unique(provider, provider_event_id)
 * constraint on payment_events is the hard guarantee (a retried webhook
 * delivery's insert fails/no-ops); BillingStore.recordEvent surfaces that as
 * `{ alreadyProcessed: true }` so this module never re-grants credits for an
 * event it's already handled, regardless of what the DB-level guarantee is
 * masking (e.g. a process crash between insert and grant).
 */

export interface RazorpayWebhookEvent {
  event: string;
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
    subscription?: { entity: RazorpaySubscriptionEntity };
    refund?: { entity: RazorpayRefundEntity };
  };
}

export interface RazorpayPaymentEntity {
  id: string;
  order_id?: string | null;
  amount: number;
  currency: string;
  status: string;
  notes?: Record<string, string>;
}

export interface RazorpaySubscriptionEntity {
  id: string;
  plan_id: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  ended_at?: number | null;
  notes?: Record<string, string>;
}

export interface RazorpayRefundEntity {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
}

export interface TransactionRecord {
  id: string;
  userId: string;
  productId: string;
  status: string;
  amountCents: number;
  providerOrderId: string | null;
  providerSubscriptionId: string | null;
}

export interface ProductRecord {
  id: string;
  kind: "subscription" | "topup";
  interviewQuantity: number;
  priceCents: number;
}

export interface BillingStore {
  /** Returns alreadyProcessed:true if this (provider, providerEventId) was already recorded — the idempotency gate. */
  recordEvent(providerEventId: string, eventType: string, rawPayload: unknown): Promise<{ eventRowId: string; alreadyProcessed: boolean }>;
  markEventProcessed(eventRowId: string, error?: string): Promise<void>;

  findTransactionByOrderId(orderId: string): Promise<TransactionRecord | null>;
  findTransactionByPaymentId(paymentId: string): Promise<TransactionRecord | null>;
  markTransactionStatus(transactionId: string, status: string): Promise<void>;
  getProduct(productId: string): Promise<ProductRecord | null>;

  /** Grants credits and links the grant back to the transaction. Idempotent per-transaction at the caller's discretion (only called once, gated by event idempotency). */
  grantCreditsForTransaction(transactionId: string, userId: string, source: "subscription" | "topup", amount: number): Promise<void>;
  reverseCreditsForTransaction(transactionId: string, userId: string, amount: number, reason: "refund" | "chargeback"): Promise<{ amountApplied: number; shortfall: number }>;

  /** Subscription lifecycle. Creates the row on first charge if it doesn't exist yet. */
  upsertSubscription(input: {
    userId: string; productId: string; providerSubscriptionId: string; status: string;
    currentPeriodStart: Date | null; currentPeriodEnd: Date | null;
  }): Promise<void>;
  markSubscriptionStatus(providerSubscriptionId: string, status: string, endedAt?: Date): Promise<{ userId: string; productId: string } | null>;
  /** Creates the renewal transaction row for a subscription.charged event not tied to a pre-created order. */
  createSubscriptionTransaction(input: { userId: string; productId: string; providerSubscriptionId: string; amountCents: number }): Promise<string>;
}

export interface ProcessResult {
  status: "processed" | "already_processed" | "ignored" | "error";
  detail?: string;
}

const CENTS_TOLERANCE = 0; // exact-match refund amount is treated as "full"

export async function processWebhookEvent(
  store: BillingStore,
  providerEventId: string,
  event: RazorpayWebhookEvent,
): Promise<ProcessResult> {
  const { eventRowId, alreadyProcessed } = await store.recordEvent(providerEventId, event.event, event);
  if (alreadyProcessed) return { status: "already_processed" };

  try {
    const result = await handle(store, event);
    await store.markEventProcessed(eventRowId);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.markEventProcessed(eventRowId, message);
    return { status: "error", detail: message };
  }
}

async function handle(store: BillingStore, event: RazorpayWebhookEvent): Promise<ProcessResult> {
  switch (event.event) {
    case "payment.captured":
      return handlePaymentCaptured(store, event.payload.payment!.entity);
    case "payment.failed":
      return handlePaymentFailed(store, event.payload.payment!.entity);
    case "subscription.charged":
      return handleSubscriptionCharged(store, event.payload.subscription!.entity, event.payload.payment?.entity ?? null);
    case "subscription.cancelled":
      return handleSubscriptionEnded(store, event.payload.subscription!.entity, "cancelled");
    case "subscription.completed":
      return handleSubscriptionEnded(store, event.payload.subscription!.entity, "expired");
    case "subscription.halted":
      return handleSubscriptionEnded(store, event.payload.subscription!.entity, "past_due");
    case "refund.processed":
      return handleRefund(store, event.payload.refund!.entity, "refund");
    case "payment.dispute.created":
      return handleDispute(store, event.payload.payment!.entity);
    default:
      return { status: "ignored", detail: `unhandled event type: ${event.event}` };
  }
}

async function handlePaymentCaptured(store: BillingStore, payment: RazorpayPaymentEntity): Promise<ProcessResult> {
  if (!payment.order_id) return { status: "ignored", detail: "payment.captured with no order_id (not an order-based purchase)" };
  const txn = await store.findTransactionByOrderId(payment.order_id);
  if (!txn) return { status: "ignored", detail: `no transaction for order_id=${payment.order_id}` };
  if (txn.status === "captured") return { status: "already_processed" };

  const product = await store.getProduct(txn.productId);
  if (!product) throw new Error(`no product for id=${txn.productId}`);

  await store.markTransactionStatus(txn.id, "captured");
  // Topups are the only order-based (non-subscription) product kind today —
  // a subscription's recurring charges arrive via subscription.charged.
  await store.grantCreditsForTransaction(txn.id, txn.userId, "topup", product.interviewQuantity);
  return { status: "processed" };
}

async function handlePaymentFailed(store: BillingStore, payment: RazorpayPaymentEntity): Promise<ProcessResult> {
  if (!payment.order_id) return { status: "ignored" };
  const txn = await store.findTransactionByOrderId(payment.order_id);
  if (!txn) return { status: "ignored", detail: `no transaction for order_id=${payment.order_id}` };
  await store.markTransactionStatus(txn.id, "failed");
  return { status: "processed" };
}

async function handleSubscriptionCharged(
  store: BillingStore, sub: RazorpaySubscriptionEntity, payment: RazorpayPaymentEntity | null,
): Promise<ProcessResult> {
  const notes = sub.notes ?? payment?.notes ?? {};
  const userId = notes.userId;
  const productId = notes.productId;
  if (!userId || !productId) {
    throw new Error(`subscription.charged missing userId/productId in notes (subscription=${sub.id})`);
  }
  const product = await store.getProduct(productId);
  if (!product) throw new Error(`no product for id=${productId}`);

  await store.upsertSubscription({
    userId, productId, providerSubscriptionId: sub.id, status: "active",
    currentPeriodStart: sub.current_start ? new Date(sub.current_start * 1000) : null,
    currentPeriodEnd: sub.current_end ? new Date(sub.current_end * 1000) : null,
  });

  // Each billing cycle is its own transaction+grant — a renewal genuinely
  // is a new purchase event, not a mutation of the first one.
  const amountCents = payment?.amount ?? product.priceCents;
  const transactionId = await store.createSubscriptionTransaction({
    userId, productId, providerSubscriptionId: sub.id, amountCents,
  });
  await store.grantCreditsForTransaction(transactionId, userId, "subscription", product.interviewQuantity);
  return { status: "processed" };
}

async function handleSubscriptionEnded(
  store: BillingStore, sub: RazorpaySubscriptionEntity, status: "cancelled" | "expired" | "past_due",
): Promise<ProcessResult> {
  const ended = sub.ended_at ? new Date(sub.ended_at * 1000) : undefined;
  const found = await store.markSubscriptionStatus(sub.id, status, ended);
  if (!found) return { status: "ignored", detail: `no subscription row for provider_subscription_id=${sub.id}` };
  // Cancellation/expiry/past_due never claws back already-granted credits —
  // it only stops future charges. This matches standard SaaS behavior and
  // is the explicit, non-invented policy: a refund event (handled
  // separately) is the only path that reverses credits.
  return { status: "processed" };
}

async function handleRefund(
  store: BillingStore, refund: RazorpayRefundEntity, reason: "refund",
): Promise<ProcessResult> {
  const txn = await store.findTransactionByPaymentId(refund.payment_id);
  if (!txn) return { status: "ignored", detail: `no transaction for payment_id=${refund.payment_id}` };

  const isFullRefund = refund.amount >= txn.amountCents - CENTS_TOLERANCE;
  if (!isFullRefund) {
    // Partial refund: flagged, not auto-reversed — deciding how many
    // credits a partial refund is "worth" is a product policy call this
    // module refuses to invent silently.
    await store.markTransactionStatus(txn.id, "partially_refunded");
    return { status: "processed", detail: "partial refund recorded; credits not auto-reversed, needs admin review" };
  }

  const product = await store.getProduct(txn.productId);
  await store.markTransactionStatus(txn.id, "refunded");
  const { amountApplied, shortfall } = await store.reverseCreditsForTransaction(
    txn.id, txn.userId, product?.interviewQuantity ?? 0, reason,
  );
  if (shortfall > 0) {
    return { status: "processed", detail: `reversed ${amountApplied}, shortfall ${shortfall} (already consumed)` };
  }
  return { status: "processed" };
}

async function handleDispute(store: BillingStore, payment: RazorpayPaymentEntity): Promise<ProcessResult> {
  if (!payment.order_id) return { status: "ignored" };
  const txn = await store.findTransactionByOrderId(payment.order_id);
  if (!txn) return { status: "ignored", detail: `no transaction for order_id=${payment.order_id}` };
  // A dispute being opened is not the same as losing it — flag, don't
  // reverse credits yet. A lost dispute reaches this module as a refund
  // event once Razorpay resolves it.
  await store.markTransactionStatus(txn.id, "disputed");
  return { status: "processed" };
}
