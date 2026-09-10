import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePromo, type PromotionRecord } from "./promo.js";

function promo(over: Partial<PromotionRecord> = {}): PromotionRecord {
  return {
    id: "p1", code: "SAVE10", percentOff: 10, amountOffCents: null,
    active: true, startsAt: null, endsAt: null,
    redemptionLimit: null, perUserLimit: 1,
    applicableProductIds: null, minAmountCents: null,
    ...over,
  };
}

const NOW = new Date("2026-06-01T00:00:00Z");

test("a percent-off promo computes the discount and caps it at the base amount", () => {
  const result = validatePromo({
    promotion: promo({ percentOff: 10 }), productId: "topup_5", baseAmountCents: 59900,
    now: NOW, totalRedemptions: 0, userRedemptions: 0,
  });
  assert.deepEqual(result, { ok: true, discountCents: 5990, finalAmountCents: 53910 });
});

test("a flat amount-off promo is used as-is, never exceeding the base amount", () => {
  const result = validatePromo({
    promotion: promo({ percentOff: null, amountOffCents: 100000 }), productId: "topup_5", baseAmountCents: 59900,
    now: NOW, totalRedemptions: 0, userRedemptions: 0,
  });
  assert.equal(result.ok, true);
  assert.equal((result as { finalAmountCents: number }).finalAmountCents, 0, "discount must never exceed the base amount");
});

test("an inactive promo is rejected regardless of other fields", () => {
  const result = validatePromo({
    promotion: promo({ active: false }), productId: "topup_5", baseAmountCents: 59900,
    now: NOW, totalRedemptions: 0, userRedemptions: 0,
  });
  assert.deepEqual(result, { ok: false, reason: "inactive" });
});

test("a promo outside its start/end window is rejected", () => {
  const notStarted = validatePromo({
    promotion: promo({ startsAt: new Date("2026-07-01T00:00:00Z") }), productId: "topup_5", baseAmountCents: 59900,
    now: NOW, totalRedemptions: 0, userRedemptions: 0,
  });
  assert.deepEqual(notStarted, { ok: false, reason: "not_started" });

  const expired = validatePromo({
    promotion: promo({ endsAt: new Date("2026-05-01T00:00:00Z") }), productId: "topup_5", baseAmountCents: 59900,
    now: NOW, totalRedemptions: 0, userRedemptions: 0,
  });
  assert.deepEqual(expired, { ok: false, reason: "expired" });
});

test("a promo at its global redemption limit is rejected", () => {
  const result = validatePromo({
    promotion: promo({ redemptionLimit: 100 }), productId: "topup_5", baseAmountCents: 59900,
    now: NOW, totalRedemptions: 100, userRedemptions: 0,
  });
  assert.deepEqual(result, { ok: false, reason: "redemption_limit_reached" });
});

test("a user who already hit their per-user limit is rejected, even with global capacity left", () => {
  const result = validatePromo({
    promotion: promo({ perUserLimit: 1, redemptionLimit: 1000 }), productId: "topup_5", baseAmountCents: 59900,
    now: NOW, totalRedemptions: 5, userRedemptions: 1,
  });
  assert.deepEqual(result, { ok: false, reason: "per_user_limit_reached" });
});

test("a promo scoped to specific products rejects a purchase of a product not in the list", () => {
  const result = validatePromo({
    promotion: promo({ applicableProductIds: ["sub_monthly_10"] }), productId: "topup_5", baseAmountCents: 59900,
    now: NOW, totalRedemptions: 0, userRedemptions: 0,
  });
  assert.deepEqual(result, { ok: false, reason: "product_not_applicable" });
});

test("an empty applicableProductIds list means the promo applies to every product", () => {
  const result = validatePromo({
    promotion: promo({ applicableProductIds: [] }), productId: "topup_5", baseAmountCents: 59900,
    now: NOW, totalRedemptions: 0, userRedemptions: 0,
  });
  assert.equal(result.ok, true);
});

test("a purchase below the promo's minimum amount is rejected", () => {
  const result = validatePromo({
    promotion: promo({ minAmountCents: 100000 }), productId: "topup_5", baseAmountCents: 59900,
    now: NOW, totalRedemptions: 0, userRedemptions: 0,
  });
  assert.deepEqual(result, { ok: false, reason: "below_minimum_amount" });
});
