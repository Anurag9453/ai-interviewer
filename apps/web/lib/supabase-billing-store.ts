import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { BillingStore, ProductRecord, TransactionRecord } from "./billing-webhook";

const UNIQUE_VIOLATION = "23505";

/**
 * Real BillingStore, backed by Postgres via the service-role client.
 * Idempotency: payment_events has `unique(provider, provider_event_id)` —
 * this plain insert either succeeds (fresh event) or fails with Postgres's
 * standard 23505 unique-violation code (duplicate), which recordEvent()
 * below turns into `alreadyProcessed: true`. Not tested directly (it's a
 * thin DB-query shell, same as PostgresEvidenceSink/PostgresLifecycleStore
 * from M6.1/M7) — billing-webhook.test.ts covers the orchestration logic
 * this wraps, against a fake.
 */
export class SupabaseBillingStore implements BillingStore {
  private readonly service = createServiceClient();

  async recordEvent(providerEventId: string, eventType: string, rawPayload: unknown) {
    const { data, error } = await this.service
      .from("payment_events")
      .insert({ provider: "razorpay", provider_event_id: providerEventId, event_type: eventType, raw_payload: rawPayload })
      .select("id")
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        const { data: existing } = await this.service
          .from("payment_events").select("id").eq("provider", "razorpay").eq("provider_event_id", providerEventId).single();
        return { eventRowId: existing?.id ?? providerEventId, alreadyProcessed: true };
      }
      throw error;
    }
    return { eventRowId: data.id, alreadyProcessed: false };
  }

  async markEventProcessed(eventRowId: string, error?: string): Promise<void> {
    await this.service.from("payment_events")
      .update({ processed_at: new Date().toISOString(), processing_error: error ?? null })
      .eq("id", eventRowId);
  }

  async findTransactionByOrderId(orderId: string): Promise<TransactionRecord | null> {
    const { data } = await this.service
      .from("payment_transactions")
      .select("id, user_id, product_id, status, amount_cents, provider_order_id, provider_subscription_id")
      .eq("provider_order_id", orderId)
      .single();
    return data ? toTransactionRecord(data) : null;
  }

  async findTransactionByPaymentId(paymentId: string): Promise<TransactionRecord | null> {
    const { data } = await this.service
      .from("payment_transactions")
      .select("id, user_id, product_id, status, amount_cents, provider_order_id, provider_subscription_id")
      .eq("provider_payment_id", paymentId)
      .single();
    return data ? toTransactionRecord(data) : null;
  }

  async markTransactionStatus(transactionId: string, status: string): Promise<void> {
    await this.service.from("payment_transactions")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", transactionId);
  }

  async getProduct(productId: string): Promise<ProductRecord | null> {
    const { data } = await this.service
      .from("billing_products").select("id, kind, interview_quantity, price_cents").eq("id", productId).single();
    if (!data) return null;
    return { id: data.id, kind: data.kind, interviewQuantity: data.interview_quantity, priceCents: data.price_cents };
  }

  async grantCreditsForTransaction(transactionId: string, userId: string, source: "subscription" | "topup", amount: number): Promise<void> {
    const { data: grant, error } = await this.service
      .rpc("grant_interview_credits", { p_user_id: userId, p_source: source, p_amount: amount, p_note: `transaction:${transactionId}` });
    if (error) throw error;
    void grant;
    // Link the grant row back to the transaction for admin visibility —
    // grant_interview_credits doesn't return the grant's id, so it's looked
    // up by the note we just wrote (most-recent match for this user/source/amount).
    const { data: grantRow } = await this.service
      .from("credit_grants").select("id").eq("user_id", userId).eq("note", `transaction:${transactionId}`)
      .order("granted_at", { ascending: false }).limit(1).single();
    if (grantRow) {
      await this.service.from("payment_transactions").update({ credit_grant_id: grantRow.id }).eq("id", transactionId);
    }
  }

  async reverseCreditsForTransaction(transactionId: string, userId: string, amount: number, reason: "refund" | "chargeback") {
    const { data, error } = await this.service
      .rpc("reverse_interview_credits", { p_user_id: userId, p_amount: amount, p_reason: reason, p_payment_transaction_id: transactionId })
      .single<{ amount_applied: number; shortfall: number }>();
    if (error) throw error;
    return { amountApplied: data.amount_applied, shortfall: data.shortfall };
  }

  async upsertSubscription(input: {
    userId: string; productId: string; providerSubscriptionId: string; status: string;
    currentPeriodStart: Date | null; currentPeriodEnd: Date | null;
  }): Promise<void> {
    await this.service.from("subscriptions").upsert({
      user_id: input.userId, product_id: input.productId, provider_subscription_id: input.providerSubscriptionId,
      status: input.status, current_period_start: input.currentPeriodStart?.toISOString() ?? null,
      current_period_end: input.currentPeriodEnd?.toISOString() ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: "provider_subscription_id" });
  }

  async markSubscriptionStatus(providerSubscriptionId: string, status: string, endedAt?: Date) {
    const { data } = await this.service
      .from("subscriptions")
      .update({ status, updated_at: new Date().toISOString(), ...(endedAt ? { current_period_end: endedAt.toISOString() } : {}) })
      .eq("provider_subscription_id", providerSubscriptionId)
      .select("user_id, product_id")
      .single();
    return data ? { userId: data.user_id, productId: data.product_id } : null;
  }

  async createSubscriptionTransaction(input: { userId: string; productId: string; providerSubscriptionId: string; amountCents: number }): Promise<string> {
    const { data, error } = await this.service.from("payment_transactions").insert({
      user_id: input.userId, product_id: input.productId, provider_subscription_id: input.providerSubscriptionId,
      status: "captured", amount_cents: input.amountCents, currency: "INR",
    }).select("id").single();
    if (error || !data) throw error ?? new Error("payment_transactions insert returned no row");
    return data.id;
  }
}

function toTransactionRecord(row: {
  id: string; user_id: string; product_id: string; status: string; amount_cents: number;
  provider_order_id: string | null; provider_subscription_id: string | null;
}): TransactionRecord {
  return {
    id: row.id, userId: row.user_id, productId: row.product_id, status: row.status,
    amountCents: row.amount_cents, providerOrderId: row.provider_order_id, providerSubscriptionId: row.provider_subscription_id,
  };
}
