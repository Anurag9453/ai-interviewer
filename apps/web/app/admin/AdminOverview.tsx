"use client";

import { useEffect, useState } from "react";

interface Overview {
  generatedAt: string;
  users: { total: number; newLast7d: number; activeLast7d: number; totalInterviews: number; paidUsers: number; freeUsers: number };
  revenue: {
    grossCents: number; byProductCents: Record<string, number>; subscriptionCents: number; topupCents: number;
    refundedCents: number; promoDiscountCents: number; promoRedemptionCount: number;
  };
  usage: {
    interviewsWithUsageData: number; totalDurationS: number; totalLlmCostCents: number;
    totalSttAudioS: number; totalTtsCharacters: number; totalLivekitMinutes: number; note: string | null;
  };
  unitEconomics: {
    estimated: boolean; avgEstimatedCostCentsPerInterview: number | null; revenuePerPaidInterviewCents: number | null;
    grossContributionCentsPerInterview: number | null; totalPaidCreditsSold: number; note: string;
  };
}

function rupees(cents: number): string {
  return `₹${(cents / 100).toFixed(2)}`;
}

export function AdminOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/overview")
      .then((r) => { if (!r.ok) throw new Error(`status ${r.status}`); return r.json(); })
      .then(setData)
      .catch(() => setError("Couldn't load admin data."));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-[var(--color-muted)]">Loading…</p>;

  return (
    <div className="space-y-8">
      <Section title="Users">
        <Grid>
          <Stat label="Total" value={String(data.users.total)} />
          <Stat label="New (7d)" value={String(data.users.newLast7d)} />
          <Stat label="Active (7d)" value={String(data.users.activeLast7d)} />
          <Stat label="Interviews taken" value={String(data.users.totalInterviews)} />
          <Stat label="Paid users" value={String(data.users.paidUsers)} />
          <Stat label="Free-only users" value={String(data.users.freeUsers)} />
        </Grid>
      </Section>

      <Section title="Revenue">
        <Grid>
          <Stat label="Gross" value={rupees(data.revenue.grossCents)} />
          <Stat label="Subscription" value={rupees(data.revenue.subscriptionCents)} />
          <Stat label="Top-up" value={rupees(data.revenue.topupCents)} />
          <Stat label="Refunded" value={rupees(data.revenue.refundedCents)} />
          <Stat label="Promo discount given" value={rupees(data.revenue.promoDiscountCents)} />
          <Stat label="Promo redemptions" value={String(data.revenue.promoRedemptionCount)} />
        </Grid>
        {Object.keys(data.revenue.byProductCents).length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-[var(--color-muted)]">
            {Object.entries(data.revenue.byProductCents).map(([id, cents]) => (
              <li key={id}>{id}: {rupees(cents)}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="AI / infrastructure usage">
        {data.usage.note && <p className="mb-3 text-sm text-[var(--color-muted)]">{data.usage.note}</p>}
        <Grid>
          <Stat label="Interviews metered" value={String(data.usage.interviewsWithUsageData)} />
          <Stat label="Total duration" value={`${Math.round(data.usage.totalDurationS / 60)} min`} />
          <Stat label="Claude cost" value={rupees(data.usage.totalLlmCostCents)} />
          <Stat label="STT audio" value={`${Math.round(data.usage.totalSttAudioS)}s`} />
          <Stat label="TTS characters" value={data.usage.totalTtsCharacters.toLocaleString()} />
          <Stat label="LiveKit minutes" value={data.usage.totalLivekitMinutes.toFixed(1)} />
        </Grid>
      </Section>

      <Section title="Unit economics (estimates)">
        <p className="mb-3 text-sm text-[var(--color-muted)]">{data.unitEconomics.note}</p>
        <Grid>
          <Stat label="Est. cost / interview" value={data.unitEconomics.avgEstimatedCostCentsPerInterview !== null ? rupees(data.unitEconomics.avgEstimatedCostCentsPerInterview) : "—"} />
          <Stat label="Revenue / paid credit" value={data.unitEconomics.revenuePerPaidInterviewCents !== null ? rupees(data.unitEconomics.revenuePerPaidInterviewCents) : "—"} />
          <Stat label="Est. contribution / interview" value={data.unitEconomics.grossContributionCentsPerInterview !== null ? rupees(data.unitEconomics.grossContributionCentsPerInterview) : "—"} />
          <Stat label="Paid credits sold" value={String(data.unitEconomics.totalPaidCreditsSold)} />
        </Grid>
      </Section>

      <p className="text-xs text-[var(--color-muted)]">Generated {new Date(data.generatedAt).toLocaleString()}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-[var(--color-muted)]">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">{children}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/8 px-3.5 py-3">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-[var(--color-muted)]">{label}</p>
    </div>
  );
}
