/**
 * Server-side promo validation and discount calculation — pure, no I/O.
 * The final payable amount is ALWAYS computed here, never trusted from the
 * client: the checkout route reads the promotion + redemption counts from
 * the DB (service-role — promotions has no client policy at all) and calls
 * this before creating a Razorpay order for anything less than full price.
 */
export interface PromotionRecord {
  id: string;
  code: string;
  percentOff: number | null;
  amountOffCents: number | null;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  redemptionLimit: number | null;
  perUserLimit: number;
  applicableProductIds: string[] | null;
  minAmountCents: number | null;
}

export interface PromoValidationInput {
  promotion: PromotionRecord;
  productId: string;
  baseAmountCents: number;
  now: Date;
  /** Total successful redemptions of this promo across all users, from promotion_redemptions. */
  totalRedemptions: number;
  /** This user's own redemptions of this promo. */
  userRedemptions: number;
}

export type PromoValidationResult =
  | { ok: true; discountCents: number; finalAmountCents: number }
  | { ok: false; reason: PromoRejectionReason };

export type PromoRejectionReason =
  | "inactive" | "not_started" | "expired" | "redemption_limit_reached"
  | "per_user_limit_reached" | "product_not_applicable" | "below_minimum_amount";

export function validatePromo(input: PromoValidationInput): PromoValidationResult {
  const { promotion: p, now } = input;

  if (!p.active) return { ok: false, reason: "inactive" };
  if (p.startsAt && now < p.startsAt) return { ok: false, reason: "not_started" };
  if (p.endsAt && now > p.endsAt) return { ok: false, reason: "expired" };
  if (p.redemptionLimit !== null && input.totalRedemptions >= p.redemptionLimit) {
    return { ok: false, reason: "redemption_limit_reached" };
  }
  if (input.userRedemptions >= p.perUserLimit) return { ok: false, reason: "per_user_limit_reached" };
  if (p.applicableProductIds && p.applicableProductIds.length > 0 && !p.applicableProductIds.includes(input.productId)) {
    return { ok: false, reason: "product_not_applicable" };
  }
  if (p.minAmountCents !== null && input.baseAmountCents < p.minAmountCents) {
    return { ok: false, reason: "below_minimum_amount" };
  }

  const discountCents = computeDiscount(p, input.baseAmountCents);
  return { ok: true, discountCents, finalAmountCents: Math.max(0, input.baseAmountCents - discountCents) };
}

function computeDiscount(p: PromotionRecord, baseAmountCents: number): number {
  // Both may be set (schema allows either-or-both); apply whichever is larger,
  // then cap at the base amount — a discount can never make a purchase free
  // by accident or produce a negative payable amount.
  const percentDiscount = p.percentOff ? Math.round((baseAmountCents * p.percentOff) / 100) : 0;
  const flatDiscount = p.amountOffCents ?? 0;
  return Math.min(baseAmountCents, Math.max(percentDiscount, flatDiscount));
}
