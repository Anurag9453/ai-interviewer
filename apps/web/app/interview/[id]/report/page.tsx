import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadInterviewReport } from "@/lib/interview-report-loader";
import type { ComputedReport } from "@/lib/report";
import { AppHeader, buttonClass, Card, EmptyState, Eyebrow } from "@/components/ui";
import { describeInterview, scoreBand, type InterviewDescriptor } from "@/lib/interview-display";

const CATEGORY_LABELS: Record<string, string> = {
  technical_knowledge: "Technical knowledge",
  problem_solving: "Problem solving",
  communication: "Communication",
  answer_depth: "Depth of answers",
  technical_accuracy: "Technical accuracy",
};

const BAND_COLOR = {
  strong: "var(--color-positive)",
  mixed: "var(--color-caution)",
  weak: "var(--color-critical)",
} as const;

export default async function InterviewReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  const { id: interviewId } = await params;

  // Unchanged: this loader is the ownership boundary (RLS-scoped) and the
  // single source of the computed report.
  const result = await loadInterviewReport(interviewId);
  if (result.status === "not_found") notFound();

  const supabase = await createClient();
  // Own-row read (RLS) purely to resolve a human label; a resume/material
  // interview can only be named via custom_documents, since its categories
  // row is active=false and invisible to the read-active policy.
  const [{ data: interviewRow }, { data: category }] = await Promise.all([
    supabase.from("interviews").select("plan_id").eq("id", interviewId).maybeSingle(),
    supabase.from("categories").select("label").eq("id", result.interview.category_id).maybeSingle(),
  ]);
  const { data: document } = interviewRow?.plan_id
    ? await supabase
        .from("custom_documents")
        .select("document_type, filename")
        .eq("generated_plan_id", interviewRow.plan_id)
        .maybeSingle()
    : { data: null };

  const descriptor = describeInterview({
    categoryId: result.interview.category_id,
    categoryLabel: category?.label ?? null,
    documentType: (document?.document_type as "resume" | "material" | undefined) ?? null,
    documentFilename: document?.filename ?? null,
  });

  if (result.status === "not_ready") {
    return (
      <Shell descriptor={descriptor}>
        <EmptyState
          title="Report not ready yet"
          body="This interview is still in progress. Come back once it's finished."
          action={<Link href="/interviews" className={buttonClass.secondary}>Your interviews</Link>}
        />
      </Shell>
    );
  }

  if (result.status === "no_questions") {
    return (
      <Shell descriptor={descriptor}>
        <EmptyState
          title="No questions were recorded"
          body="This interview ended before any question was asked, so there's nothing to report on."
          action={<Link href="/interview/new" className={buttonClass.primary}>Try another</Link>}
        />
      </Shell>
    );
  }

  const { report } = result;

  return (
    <Shell descriptor={descriptor}>
      <ScoreSummary report={report} />

      {report.workOn.length > 0 && (
        <section aria-labelledby="workon" className="mt-8">
          <h2 id="workon" className="mb-3 text-sm font-medium text-[var(--color-ink-soft)]">
            What to work on
          </h2>
          <Card className="px-5 py-4">
            <ul className="space-y-2.5">
              {report.workOn.map((signal) => (
                <li key={signal} className="flex gap-2.5 text-sm leading-relaxed">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-caution)]" />
                  <span>{signal}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      <section aria-labelledby="questions" className="mt-8">
        <h2 id="questions" className="mb-3 text-sm font-medium text-[var(--color-ink-soft)]">
          Questions asked ({report.questions.length})
        </h2>
        <ul className="space-y-2.5">
          {report.questions.map((q, i) => (
            <Card key={q.questionId} as="li" className="px-5 py-4">
              <div className="mb-2.5 flex items-start justify-between gap-3">
                <p className="text-sm font-medium leading-relaxed">
                  <span className="text-[var(--color-muted)]">Q{i + 1}. </span>
                  {q.text}
                </p>
                {q.excluded && (
                  <span className="shrink-0 rounded-full bg-[var(--color-sunken)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-muted)]">
                    Not reached
                  </span>
                )}
              </div>
              {!q.excluded && (
                <ul className="space-y-1.5 text-sm">
                  {q.heard.map((s) => <Signal key={s.signal} kind="heard" text={s.signal} />)}
                  {q.partial.map((s) => <Signal key={s.signal} kind="partial" text={s.signal} />)}
                  {q.missing.map((s) => <Signal key={s.signal} kind="missing" text={s.signal} />)}
                </ul>
              )}
            </Card>
          ))}
        </ul>
      </section>

      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        <Link href="/interview/new" className={`${buttonClass.primary} flex-1`}>Practise again</Link>
        <Link href="/interviews" className={`${buttonClass.secondary} flex-1`}>All interviews</Link>
        <Link href="/progress" className={`${buttonClass.secondary} flex-1`}>Progress</Link>
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-[var(--color-muted)]">
        This report is computed directly from what you said during the interview. A written narrative summary
        isn&rsquo;t available yet.
      </p>
    </Shell>
  );
}

function Signal({ kind, text }: { kind: "heard" | "partial" | "missing"; text: string }) {
  const style = {
    heard: { mark: "✓", color: "var(--color-positive)", muted: false },
    partial: { mark: "~", color: "var(--color-caution)", muted: false },
    missing: { mark: "✗", color: "var(--color-muted)", muted: true },
  }[kind];
  return (
    <li className="flex gap-2 leading-relaxed">
      <span aria-hidden className="shrink-0 font-medium" style={{ color: style.color }}>{style.mark}</span>
      <span className={style.muted ? "text-[var(--color-muted)]" : ""}>{text}</span>
    </li>
  );
}

function ScoreSummary({ report }: { report: ComputedReport }) {
  // Null overall stays null — an interview that ended too early to assess is
  // never rendered as a zero. Bound before the guard so `overall` narrows to
  // a real number below instead of needing a cast.
  const score = report.score;
  if (!score || score.overall === null) {
    return (
      <EmptyState
        title="Score not available"
        body="Not enough of this interview was assessed to compute a score — usually because it ended very early."
        action={<Link href="/interview/new" className={buttonClass.primary}>Try another</Link>}
      />
    );
  }

  const overall = score.overall;
  const band = report.band;
  const color = BAND_COLOR[scoreBand(overall)];

  return (
    <section aria-labelledby="score">
      <Card className="px-6 py-7 text-center">
        <h2 id="score" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
          Overall score
        </h2>
        <p className="mt-1.5 text-5xl font-semibold tabular-nums" style={{ color }}>
          {overall}
          <span className="text-lg font-normal text-[var(--color-muted)]"> / 100</span>
        </p>
        {band && <p className="mt-1.5 text-sm text-[var(--color-muted)]">{band}</p>}
      </Card>

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {Object.entries(score.categories).map(([cat, value]) => (
          <Card key={cat} className="px-4 py-3.5">
            <p className="text-xs text-[var(--color-muted)]">{CATEGORY_LABELS[cat] ?? cat}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">
              {value === null ? (
                // "Not assessed" is a real, distinct outcome from a low score.
                <span className="text-sm font-normal text-[var(--color-muted)]">Not assessed</span>
              ) : (
                <>
                  {value}
                  <span className="text-sm font-normal text-[var(--color-muted)]">/10</span>
                </>
              )}
            </p>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Shell({ children, descriptor }: { children: React.ReactNode; descriptor: InterviewDescriptor }) {
  return (
    <>
      <AppHeader current="history" />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-7 sm:px-6 sm:pt-10">
        <div className="mb-6 animate-rise">
          <Eyebrow>Interview report</Eyebrow>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold sm:text-3xl">{descriptor.title}</h1>
            {descriptor.kind !== "standard" && (
              <span className="rounded-full bg-[var(--color-accent-wash)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent-ink)]">
                {descriptor.kind === "resume" ? "Resume interview" : "Your material"}
              </span>
            )}
          </div>
          {descriptor.detail && (
            <p className="mt-1 text-sm text-[var(--color-muted)]">{descriptor.detail}</p>
          )}
        </div>
        {children}
      </main>
    </>
  );
}
