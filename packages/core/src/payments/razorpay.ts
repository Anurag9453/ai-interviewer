/**
 * Real Razorpay adapter. Node-only (the `razorpay` SDK), never exported from
 * browser.ts — same split as providers/index.ts vs providers/types.ts.
 *
 * API shapes verified against Razorpay's own docs before writing this (not
 * from training-data recall): webhook signature is HMAC-SHA256 of the RAW
 * request body string, header `X-Razorpay-Signature`, verified here via the
 * SDK's own `Razorpay.validateWebhookSignature` static (which does exactly
 * that HMAC comparison) rather than a hand-rolled one.
 *
 * NOT live-tested against a real Razorpay account — no credentials exist in
 * this environment. The webhook signature verification path IS deterministically
 * tested (packages/core/src/payments/razorpay.test.ts) since it's pure HMAC
 * math requiring no network call; order/subscription creation are not.
 */
import Razorpay from "razorpay";
import type {
  CreateOrderInput, CreateOrderResult, CreateSubscriptionInput,
  CreateSubscriptionResult, PaymentProvider, WebhookVerification,
} from "./types.js";

export interface RazorpayProviderOptions {
  keyId: string;
  keySecret: string;
}

/**
 * Standalone signature verification — deliberately NOT a method on the
 * provider class. Verification is pure HMAC-SHA256 over the webhook secret;
 * it needs no API credentials, so a webhook receiver must not have to
 * construct a Razorpay client (whose SDK constructor throws when key_id is
 * absent) just to check a signature. Webhook receipt stays independent of
 * outbound API config.
 */
export function verifyRazorpayWebhookSignature(rawBody: string, signature: string, secret: string): WebhookVerification {
  const valid = Razorpay.validateWebhookSignature(rawBody, signature, secret);
  return { valid };
}

export class RazorpayProvider implements PaymentProvider {
  readonly id = "razorpay";
  private readonly client: Razorpay;

  constructor(opts: RazorpayProviderOptions) {
    this.client = new Razorpay({ key_id: opts.keyId, key_secret: opts.keySecret });
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const order = await this.client.orders.create({
      amount: input.amountCents,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
    });
    return { providerOrderId: order.id, amountCents: Number(order.amount), currency: order.currency };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
    const sub = await this.client.subscriptions.create({
      plan_id: input.providerPlanId,
      total_count: input.totalCount,
      notes: input.notes,
    });
    return { providerSubscriptionId: sub.id, status: sub.status };
  }

  verifyWebhookSignature(rawBody: string, signature: string, secret: string): WebhookVerification {
    return verifyRazorpayWebhookSignature(rawBody, signature, secret);
  }
}
