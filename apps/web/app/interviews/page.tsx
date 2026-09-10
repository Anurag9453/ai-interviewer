import Link from "next/link";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadOverallScore } from "@/lib/interview-report-loader";
import { AppHeader, buttonClass, Card, EmptyState, PageHeading } from "@/components/ui";
import { describeInterview, formatMinutes, isTerminal, scoreBand, statusLabel } from "@/lib/interview-display";

interface InterviewRow {
  id: string; plan_id: string; category_id: string; difficulty: string; duration_s: number;
  status: string; end_reason: string | null; created_at: string;
}

const BAND_CLASS = {
  strong: "text-[var(--color-positive)]",
  mixed: "text-[var(--color-caution)]",
  weak: "text-[var(--color-critical)]",
} as const;

export default async function InterviewsHistoryPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const [{ data: interviews }, { data: categories }, { data: documents }] = await Promise.all([
    supabase
      .from("interviews")
      .select("id, plan_id, category_id, difficulty, duration_s, status, end_reason, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<InterviewRow[]>(),
    supabase.from("categories").select("id, label"),
    // Resume/material interviews are only nameable through this table — their
    // categories row is active=false and invisible to the read-active policy.
    supabase.from("custom_documents").select("generated_plan_id, document_type, filename"),
  ]);

  const categoryLabels = new Map((categories ?? []).map((c) => [c.id, c.label]));
  const docsByPlan = new Map(
    (documents ?? []).filter((d) => d.generated_plan_id).map((d) => [d.generated_plan_id as string, d]),
  );
  const rows = interviews ?? [];

  // Unchanged: scores are computed from recorded evidence at read time, and an
  // unassessed interview stays null rather than becoming zero.
  const scores = await Promise.all(
    rows.filter((r) => isTerminal(r.status)).map(async (r) => [r.id, await loadOverallScore(r.id)] as const),
  );
  const scoreById = new Map(scores);

  return (
    <>
      <AppHeader current="history" />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-7 sm:px-6 sm:pt-10">
        <div className="animate-rise">
          <PageHeading
            eyebrow="History"
            title="Your interviews"
            {...(rows.length > 0 ? { sub: `${rows.length} session${rows.length === 1 ? "" : "s"} so far.` } : {})}
          />
        </div>

        {rows.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No interviews yet"
              body="Once you've done one, it'll show up here with its score and a full report."
              action={<Link href="/interview/new" className={buttonClass.primary}>Start an interview</Link>}
            />
          </div>
        ) : (
          <ul className="mt-6 space-y-2">
            {rows.map((iv) => {
              const doc = docsByPlan.get(iv.plan_id);
              const d = describeInterview({
                categoryId: iv.category_id,
                categoryLabel: categoryLabels.get(iv.category_id) ?? null,
                documentType: (doc?.document_type as "resume" | "material" | undefined) ?? null,
                documentFilename: doc?.filename ?? null,
              });
              const score = scoreById.get(iv.id);
              const terminal = isTerminal(iv.status);

              const row = (
                <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{d.title}</p>
                      {d.kind !== "standard" && (
                        <span className="shrink-0 rounded-full bg-[var(--color-accent-wash)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent-ink)]">
                          {d.kind === "resume" ? "Resume" : "Material"}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
                      {d.detail ? `${d.detail} · ` : ""}
                      <span className="capitalize">{iv.difficulty}</span> · {formatMinutes(iv.duration_s)} ·{" "}
                      {new Date(iv.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {typeof score === "number" ? (
                      <p className={`text-sm font-semibold tabular-nums ${BAND_CLASS[scoreBand(score)]}`}>
                        {score}
                        <span className="font-normal text-[var(--color-muted)]">/100</span>
                      </p>
                    ) : (
                      <p className="text-xs text-[var(--color-muted)]">{statusLabel(iv.status, iv.end_reason)}</p>
                    )}
                    {terminal && (
                      <p aria-hidden className="mt-0.5 text-xs text-[var(--color-accent-ink)]">Report →</p>
                    )}
                  </div>
                </div>
              );

              return (
                <Card key={iv.id} as="li" className="overflow-hidden">
                  {terminal ? (
                    <Link
                      href={`/interview/${iv.id}/report`}
                      className="block transition hover:bg-[var(--color-sunken)]"
                    >
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </Card>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
