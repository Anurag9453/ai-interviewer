import { NextResponse } from "next/server";
import { checkAdminRequest } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase/service";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One consolidated admin analytics payload. Every number here comes from a
 * real query against real tables — with real data this sparse (a handful
 * of test interviews), most of it will read as zero/null, which the admin
 * UI shows as an explicit "no data yet" rather than fabricating a number.
 * Unit-economics figures are clearly separated and labeled as estimates —
 * see usage-metering.ts's own header comment for why.
 */
export async function GET() {
  const auth = await checkAdminRequest();
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const service = createServiceClient();
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();

  // Nine queries, previously destructured straight out of Promise.all. Two
  // failure modes were unhandled: a transport-level rejection escaped as an
  // unhandled 500, and a per-query `{ error }` was silently treated as empty
  // data — which for an analytics dashboard means confidently reporting zero
  // revenue. Both now produce an explicit, safe error state.
  let settled;
  try {
    settled = await Promise.all([
      service.from("profiles").select("*", { count: "exact", head: true }),
      service.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
      service.from("profiles").select("*", { count: "exact", head: true }).gte("last_active_at", sevenDaysAgo),
      service.from("interviews").select("*", { count: "exact", head: true }),
      service.from("payment_transactions").select("user_id").eq("status", "captured"),
      service.from("payment_transactions").select("*, billing_products(kind)"),
      service.from("promotion_redemptions").select("*", { count: "exact" }),
      service.from("usage_events").select("duration_s, llm_cost_cents, estimated_cost_cents, stt_audio_s, tts_characters, livekit_minutes"),
      service.from("credit_grants").select("amount").in("source", ["subscription", "topup"]),
    ]);
  } catch (err) {
    console.error("admin overview request failed", err);
    return NextResponse.json({ error: "overview_unavailable" }, { status: 502 });
  }

  const queryErrors = settled.map((r) => r.error).filter(Boolean);
  if (queryErrors.length > 0) {
    // Raw Postgres text stays server-side; the admin gets a status only.
    console.error("admin overview query failed", queryErrors);
    return NextResponse.json({ error: "overview_unavailable" }, { status: 502 });
  }

  const [
    { count: totalUsers },
    { count: newUsers },
    { count: activeUsers },
    { count: totalInterviews },
    { data: paidUserIds },
    { data: transactions },
    { data: promoRedemptions },
    { data: usageEvents },
    { data: paidCreditGrants },
  ] = settled;

  const paidUserIdSet = new Set((paidUserIds ?? []).map((r) => r.user_id));
  const captured = (transactions ?? []).filter((t) => t.status === "captured");
  const refunded = (transactions ?? []).filter((t) => t.status === "refunded" || t.status === "partially_refunded");
  const grossRevenueCents = captured.reduce((sum, t) => sum + t.amount_cents, 0);
  const revenueByProduct: Record<string, number> = {};
  let subscriptionRevenueCents = 0;
  let topupRevenueCents = 0;
  for (const t of captured) {
    revenueByProduct[t.product_id] = (revenueByProduct[t.product_id] ?? 0) + t.amount_cents;
    const kind = (t as { billing_products?: { kind: string } }).billing_products?.kind;
    if (kind === "subscription") subscriptionRevenueCents += t.amount_cents;
    if (kind === "topup") topupRevenueCents += t.amount_cents;
  }
  const refundedRevenueCents = refunded.reduce((sum, t) => sum + t.amount_cents, 0);
  const promoDiscountCents = captured.reduce((sum, t) => sum + (t.discount_cents ?? 0), 0);

  const interviewCount = usageEvents?.length ?? 0;
  const totalDurationS = (usageEvents ?? []).reduce((sum, u) => sum + (u.duration_s ?? 0), 0);
  const totalLlmCostCents = (usageEvents ?? []).reduce((sum, u) => sum + Number(u.llm_cost_cents ?? 0), 0);
  const totalEstimatedCostCents = (usageEvents ?? []).reduce((sum, u) => sum + Number(u.estimated_cost_cents ?? 0), 0);
  const totalSttAudioS = (usageEvents ?? []).reduce((sum, u) => sum + Number(u.stt_audio_s ?? 0), 0);
  const totalTtsCharacters = (usageEvents ?? []).reduce((sum, u) => sum + (u.tts_characters ?? 0), 0);
  const totalLivekitMinutes = (usageEvents ?? []).reduce((sum, u) => sum + Number(u.livekit_minutes ?? 0), 0);

  const totalPaidCreditsSold = (paidCreditGrants ?? []).reduce((sum, g) => sum + g.amount, 0);
  const avgEstimatedCostCentsPerInterview = interviewCount > 0 ? totalEstimatedCostCents / interviewCount : null;
  const revenuePerPaidInterviewCents = totalPaidCreditsSold > 0 ? grossRevenueCents / totalPaidCreditsSold : null;
  const grossContributionCentsPerInterview =
    revenuePerPaidInterviewCents !== null && avgEstimatedCostCentsPerInterview !== null
      ? revenuePerPaidInterviewCents - avgEstimatedCostCentsPerInterview
      : null;

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    users: {
      total: totalUsers ?? 0,
      newLast7d: newUsers ?? 0,
      activeLast7d: activeUsers ?? 0,
      totalInterviews: totalInterviews ?? 0,
      paidUsers: paidUserIdSet.size,
      freeUsers: Math.max(0, (totalUsers ?? 0) - paidUserIdSet.size),
    },
    revenue: {
      grossCents: grossRevenueCents,
      byProductCents: revenueByProduct,
      subscriptionCents: subscriptionRevenueCents,
      topupCents: topupRevenueCents,
      refundedCents: refundedRevenueCents,
      promoDiscountCents,
      promoRedemptionCount: promoRedemptions?.length ?? 0,
    },
    usage: {
      interviewsWithUsageData: interviewCount,
      totalDurationS,
      totalLlmCostCents,
      totalSttAudioS,
      totalTtsCharacters,
      totalLivekitMinutes,
      note: interviewCount === 0
        ? "No usage_events recorded yet — metering was wired up this milestone; historical interviews predate it."
        : null,
    },
    unitEconomics: {
      estimated: true,
      avgEstimatedCostCentsPerInterview,
      revenuePerPaidInterviewCents,
      grossContributionCentsPerInterview,
      totalPaidCreditsSold,
      note: "Estimates only — not accounting-grade. See usage-metering.ts for the (rough) STT/TTS cost model; LLM cost is the real provider-reported figure. " +
        "Free-trial-specific cost is not broken out: credits are one fungible pool by design (see M8's credit_grants ledger), so a completed interview cannot be attributed to a specific grant source.",
    },
  });
}
