import { createHmac } from "node:crypto";
import type {
  CreateOrderInput, CreateOrderResult, CreateSubscriptionInput,
  CreateSubscriptionResult, PaymentProvider, WebhookVerification,
} from "./types.js";

/**
 * Deterministic test double — real HMAC-SHA256 verification (so signature
 * tests exercise genuine crypto, not a stub that always returns true/false),
 * fake order/subscription creation (scripted ids, no network).
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly id = "fake";
  readonly ordersCreated: CreateOrderInput[] = [];
  readonly subscriptionsCreated: CreateSubscriptionInput[] = [];
  private orderCounter = 0;
  private subscriptionCounter = 0;

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    this.ordersCreated.push(input);
    return { providerOrderId: `order_fake_${++this.orderCounter}`, amountCents: input.amountCents, currency: input.currency };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult> {
    this.subscriptionsCreated.push(input);
    return { providerSubscriptionId: `sub_fake_${++this.subscriptionCounter}`, status: "created" };
  }

  verifyWebhookSignature(rawBody: string, signature: string, secret: string): WebhookVerification {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return { valid: expected === signature };
  }
}

/** Matches FakePaymentProvider's own verification exactly, for constructing a valid test signature. */
export function signFakeWebhook(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}
