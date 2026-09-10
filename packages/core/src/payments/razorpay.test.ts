import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { RazorpayProvider } from "./razorpay.js";

/**
 * Deterministic, no network: exercises the REAL Razorpay SDK's
 * validateWebhookSignature (genuine HMAC-SHA256 math), not a stub. Order/
 * subscription creation need a live account and are not covered here — see
 * the module header comment.
 */
test("verifyWebhookSignature accepts a correctly HMAC-SHA256-signed raw body", () => {
  const provider = new RazorpayProvider({ keyId: "rzp_test_x", keySecret: "irrelevant_for_this_call" });
  const secret = "whsec_test_123";
  const rawBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1" } } } });
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");

  assert.equal(provider.verifyWebhookSignature(rawBody, signature, secret).valid, true);
});

test("verifyWebhookSignature rejects a tampered body against the original signature", () => {
  const provider = new RazorpayProvider({ keyId: "rzp_test_x", keySecret: "irrelevant_for_this_call" });
  const secret = "whsec_test_123";
  const rawBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1" } } } });
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  const tamperedBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_ATTACKER" } } } });

  assert.equal(provider.verifyWebhookSignature(tamperedBody, signature, secret).valid, false);
});

test("verifyWebhookSignature rejects a signature made with the wrong secret", () => {
  const provider = new RazorpayProvider({ keyId: "rzp_test_x", keySecret: "irrelevant_for_this_call" });
  const rawBody = JSON.stringify({ event: "payment.captured" });
  const wrongSignature = createHmac("sha256", "not_the_real_secret").update(rawBody).digest("hex");

  assert.equal(provider.verifyWebhookSignature(rawBody, wrongSignature, "whsec_test_123").valid, false);
});
