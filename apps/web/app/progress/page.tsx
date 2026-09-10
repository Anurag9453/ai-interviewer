import Link from "next/link";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadInterviewReport } from "@/lib/interview-report-loader";
import type { Dimension } from "@ai/core";
import { AppHeader, buttonClass, Card, EmptyState, PageHeading, Stat } from "@/components/ui";

const DIMENSION_LABELS: Record<Dimension, string> = {
  correctness: "Correctness", relevance: "Relevance", depth: "Depth",
  clarity: "Clarity", technical_accuracy: "Technical accuracy", problem_solving: "Problem solving",
};

interface InterviewRow {
  id: string; status: string; created_at: string;
}

export default async function ProgressPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const { data: interviews } = await supabase
    .from("interviews")
    .select("id, status, created_at")
    .eq("user_id", userId)
    .in("status", ["complete", "abandoned"])
    .order("created_at", { ascending: true })
    .returns<InterviewRow[]>();

  const completed = interviews ?? [];
  const reports = await Promise.all(completed.map((iv) => loadInterviewReport(iv.id)));

  const trend = reports
    .map((r, i) => (r.status === "ready" && r.report.score?.overall != null
      ? { date: completed[i]!.created_at, score: r.report.score.overall }
      : null))
    .filter((t): t is { date: string; score: number } => t !== null);

  // Average each assessed dimension across every interview that assessed it —
  // real numbers from the same computeReport() the report page uses, not a
  // new aggregation heuristic. Unassessed dimensions stay out entirely rather
  // than being counted as zero.
  const dimensionSums = new Map<Dimension, { total: number; count: number }>();
  for (const r of reports) {
    if (r.status !== "ready" || !r.report.score) continue;
    for (const dim of r.report.score.assessed) {
      const value = r.report.score.dimensions[dim];
      if (value === null) continue;
      const entry = dimensionSums.get(dim) ?? { total: 0, count: 0 };
      entry.total += value; entry.count += 1;
      dimensionSums.set(dim, entry);
    }
  }
  const dimensionAverages = [...dimensionSums.entries()]
    .map(([dim, { total, count }]) => ({ dim, avg: Math.round((total / count) * 10) / 10 }))
    .sort((a, b) => b.avg - a.avg);

  const strongest = dimensionAverages.slice(0, 2);
  const weakest = dimensionAverages.length > 2 ? dimensionAverages.slice(-2).reverse() : [];

  return (
    <>
      <AppHeader current="progress" />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-7 sm:px-6 sm:pt-10">
        <div className="animate-rise">
          <PageHeading
            eyebrow="Progress"
            title="How you're tracking"
            sub="Averaged across every interview that actually assessed a given area."
          />
        </div>

        <Card className="mt-6 grid grid-cols-2 divide-x divide-[var(--color-line)]">
          <Stat value={String(completed.length)} label="Interviews completed" />
          <Stat value={String(trend.length)} label="With a computed score" />
        </Card>

        {trend.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="Not enough data yet"
              body="Complete an interview and this page will show your strongest and weakest areas, plus how your score moves over time."
              action={<Link href="/interview/new" className={buttonClass.primary}>Start an interview</Link>}
            />
          </div>
        ) : (
          <>
            {dimensionAverages.length > 0 && (
              <section aria-labelledby="areas" className="mt-8">
                <h2 id="areas" className="mb-3 text-sm font-medium text-[var(--color-ink-soft)]">
                  Strongest and weakest areas
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Card className="p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-positive)]">
                      Strongest
                    </p>
                    <ul className="mt-3 space-y-3">
                      {strongest.map(({ dim, avg }) => (
                        <DimensionBar key={dim} label={DIMENSION_LABELS[dim]} avg={avg} tone="positive" />
                      ))}
                    </ul>
                  </Card>
                  {weakest.length > 0 && (
                    <Card className="p-5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-caution)]">
                        Needs work
                      </p>
                      <ul className="mt-3 space-y-3">
                        {weakest.map(({ dim, avg }) => (
                          <DimensionBar key={dim} label={DIMENSION_LABELS[dim]} avg={avg} tone="caution" />
                        ))}
                      </ul>
                    </Card>
                  )}
                </div>
              </section>
            )}

            <section aria-labelledby="trend" className="mt-8">
              <h2 id="trend" className="mb-3 text-sm font-medium text-[var(--color-ink-soft)]">
                Score over time
              </h2>
              {trend.length < 2 ? (
                <EmptyState
                  title="One scored interview so far"
                  body="A trend needs at least two, so do another and this will start showing movement."
                />
              ) : (
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-[var(--color-line)]">
                    {trend.map((t, i) => (
                      <li key={t.date} className="flex items-center justify-between px-5 py-3.5">
                        <span className="text-sm text-[var(--color-muted)]">
                          {new Date(t.date).toLocaleDateString()}
                        </span>
                        <span className="flex items-baseline gap-2 text-sm font-semibold tabular-nums">
                          {t.score}
                          <span className="font-normal text-[var(--color-muted)]">/100</span>
                          {i > 0 && <TrendDelta delta={t.score - trend[i - 1]!.score} />}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}

/** Visual only — the number shown is exactly the computed average. */
function DimensionBar({ label, avg, tone }: { label: string; avg: number; tone: "positive" | "caution" }) {
  const pct = Math.max(0, Math.min(100, (avg / 10) * 100));
  const color = tone === "positive" ? "var(--color-positive)" : "var(--color-caution)";
  return (
    <li>
      <div className="flex items-baseline justify-between">
        <span className="text-sm">{label}</span>
        <span className="text-sm font-medium tabular-nums" style={{ color }}>
          {avg}<span className="font-normal text-[var(--color-muted)]">/10</span>
        </span>
      </div>
      <div
        role="img"
        aria-label={`${label}: ${avg} out of 10`}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-sunken)]"
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </li>
  );
}

function TrendDelta({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      className="text-xs font-medium"
      style={{ color: up ? "var(--color-positive)" : "var(--color-critical)" }}
    >
      {up ? "↑" : "↓"} {Math.abs(delta)}
    </span>
  );
}
