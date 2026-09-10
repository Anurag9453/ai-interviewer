/**
 * Payment provider abstraction — mirrors ../providers/types.ts's LlmProvider
 * split exactly: a browser-safe interface here, a concrete Node-only adapter
 * per provider (razorpay.ts), never imported from the full app barrel's
 * browser-safe subset. Application/entitlement code (webhook-handler.ts,
 * the checkout route) is written against THIS interface only, so a future
 * Stripe adapter is a second file implementing it, not a rewrite of how
 * credits get granted.
 */

export interface CreateOrderInput {
  /** Smallest currency unit (paise for INR). */
  amountCents: number;
  currency: string;
  /** Echoed back on the webhook — carries our own ids through the provider, never trusted alone. */
  notes: Record<string, string>;
  receipt: string;
}

export interface CreateOrderResult {
  providerOrderId: string;
  amountCents: number;
  currency: string;
}

export interface CreateSubscriptionInput {
  /** The provider-side plan id (Razorpay: created once via dashboard/API, stored on billing_products.provider_plan_id). */
  providerPlanId: string;
  totalCount: number;
  notes: Record<string, string>;
}

export interface CreateSubscriptionResult {
  providerSubscriptionId: string;
  status: string;
}

export interface WebhookVerification {
  valid: boolean;
}

export interface PaymentProvider {
  readonly id: string;
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult>;
  /** `rawBody` MUST be the exact, unparsed request body text — signature verification hashes it byte-for-byte. */
  verifyWebhookSignature(rawBody: string, signature: string, secret: string): WebhookVerification;
}
