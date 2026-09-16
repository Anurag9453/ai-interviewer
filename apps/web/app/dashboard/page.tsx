import Link from "next/link";
import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/SignOutButton";
import { loadOverallScore } from "@/lib/interview-report-loader";
import { AppHeader, buttonClass, Card, EmptyState, Eyebrow, Stat } from "@/components/ui";
import { describeInterview, isTerminal, scoreBand, statusLabel } from "@/lib/interview-display";

interface InterviewRow {
  id: string;
  plan_id: string;
  category_id: string;
  difficulty: string;
  status: string;
  end_reason: string | null;
  created_at: string;
}

const BAND_CLASS = {
  strong: "text-[var(--color-positive)]",
  mixed: "text-[var(--color-caution)]",
  weak: "text-[var(--color-critical)]",
} as const;

export default async function DashboardPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const [
    { data: profile },
    { data: credits },
    { data: interviews },
    { count: totalCount },
    { data: subscription },
    { data: documents },
    { data: categories },
  ] = await Promise.all([
    supabase.from("profiles").select("display_name, is_admin").eq("id", userId).single(),
    supabase.from("interview_credits").select("granted, consumed").eq("user_id", userId).single(),
    supabase
      .from("interviews")
      .select("id, plan_id, category_id, difficulty, status, end_reason, created_at")
      .order("created_at", { ascending: false })
      .limit(4)
      .returns<InterviewRow[]>(),
    supabase.from("interviews").select("*", { count: "exact", head: true }),
    supabase
      .from("subscriptions")
      .select("product_id, status, current_period_end")
      .eq("status", "active")
      .maybeSingle(),
    // Resume/material interviews can only be labelled through this table —
    // their categories row is active=false and therefore invisible to RLS.
    supabase.from("custom_documents").select("generated_plan_id, document_type, filename"),
    supabase.from("categories").select("id, label").eq("active", true),
  ]);

  void supabase.rpc("touch_last_active"); // fire-and-forget, off the render path

  const remaining = credits ? Math.max(0, credits.granted - credits.consumed) : 0;
  const categoryLabels = new Map((categories ?? []).map((c) => [c.id, c.label]));
  const docsByPlan = new Map(
    (documents ?? []).filter((d) => d.generated_plan_id).map((d) => [d.generated_plan_id as string, d]),
  );

  // Scores are computed from recorded evidence at read time — interview_reports
  // is still never written. Same source as the report/history/progress pages.
  const terminal = (interviews ?? []).filter((iv) => isTerminal(iv.status));
  const scores = await Promise.all(terminal.map((iv) => loadOverallScore(iv.id)));
  const scoreById = new Map(terminal.map((iv, i) => [iv.id, scores[i] ?? null]));
  const scored = scores.filter((s): s is number => s !== null);
  const avgScore = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;

  const isNewUser = (totalCount ?? 0) === 0;
  const planLabel = subscription ? "Monthly" : "Free";

  return (
    <>
      <AppHeader current="dashboard" right={<SignOutButton />} />

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-7 sm:px-6 sm:pt-10">
        <div className="animate-rise">
          <Eyebrow>{isNewUser ? "Welcome" : "Welcome back"}</Eyebrow>
          <h1 className="font-display mt-2 text-[32px] leading-tight sm:text-[40px]">
            {profile?.display_name ? profile.display_name : "Ready to practise?"}
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-muted)]">
            {isNewUser
              ? "Pick how you'd like to be interviewed. It takes about 15 minutes."
              : "Pick up where you left off, or try a different kind of interview."}
          </p>
        </div>

        {/* The two primary actions. Deliberately the largest thing on screen. */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            href="/interview/new"
            className="group flex flex-col justify-between rounded-[var(--radius-card)] bg-[var(--color-ink)] p-5 text-white transition duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] sm:p-6"
          >
            <div>
              <p className="font-display text-2xl leading-tight">Start new interview</p>
              <p className="mt-1.5 text-sm leading-relaxed text-white/70">
                Choose a field and difficulty, then talk it through with the interviewer.
              </p>
            </div>
            <span aria-hidden className="mt-6 text-sm font-medium text-white/90">
              Choose a type <span className="inline-block transition group-hover:translate-x-0.5">→</span>
            </span>
          </Link>

          <Link
            href="/interview/new/resume"
            className="group flex flex-col justify-between rounded-[var(--radius-card)] border border-[var(--color-accent)]/25 bg-[var(--color-accent-wash)] p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] sm:p-6"
          >
            <div>
              <div className="flex items-center gap-2">
                <p className="font-display text-2xl leading-tight">Interview me on my resume</p>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                Upload your resume and get asked about your own roles, projects and claims.
              </p>
            </div>
            <span aria-hidden className="mt-6 text-sm font-medium text-[var(--color-accent-ink)]">
              Upload resume <span className="inline-block transition group-hover:translate-x-0.5">→</span>
            </span>
          </Link>
        </div>

        <Card className="mt-3 grid grid-cols-3 divide-x divide-[var(--color-line)]">
          <Stat value={String(remaining)} label="Interviews left" />
          <Stat value={planLabel} label="Current plan" hint={subscription ? "Renews monthly" : "2 free to start"} />
          <Stat
            value={avgScore !== null ? `${avgScore}` : "—"}
            label="Average score"
            hint={avgScore !== null ? "of 100" : "after your first"}
          />
        </Card>

        {remaining === 0 && (
          <div className="mt-3 flex flex-col items-start justify-between gap-3 rounded-[var(--radius-card)] bg-[var(--color-caution-wash)] px-5 py-4 sm:flex-row sm:items-center">
            <p className="text-sm text-[var(--color-ink-soft)]">
              You&rsquo;re out of interview credits.
            </p>
            <Link href="/billing" className={`${buttonClass.secondary} shrink-0`}>
              Get more
            </Link>
          </div>
        )}

        <section aria-labelledby="recent" className="mt-9">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="recent" className="text-sm font-medium text-[var(--color-ink-soft)]">
              Recent interviews
            </h2>
            {!isNewUser && (
              <Link href="/interviews" className="text-xs font-medium text-[var(--color-accent-ink)] hover:underline">
                View all ({totalCount})
              </Link>
            )}
          </div>

          {isNewUser ? (
            <EmptyState
              title="No interviews yet"
              body="Your first one is free. Most people start with a standard interview to see how it feels, then try a resume interview."
              action={
                <Link href="/interview/new" className={buttonClass.primary}>
                  Start your first interview
                </Link>
              }
            />
          ) : (
            <ul className="space-y-2">
              {(interviews ?? []).map((iv) => {
                const doc = docsByPlan.get(iv.plan_id);
                const d = describeInterview({
                  categoryId: iv.category_id,
                  categoryLabel: categoryLabels.get(iv.category_id) ?? null,
                  documentType: (doc?.document_type as "resume" | "material" | undefined) ?? null,
                  documentFilename: doc?.filename ?? null,
                });
                const score = scoreById.get(iv.id);
                const row = (
                  <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{d.title}</p>
                      <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
                        {d.detail ? `${d.detail} · ` : ""}
                        {iv.difficulty} · {new Date(iv.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    {typeof score === "number" ? (
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${BAND_CLASS[scoreBand(score)]}`}>
                        {score}
                        <span className="font-normal text-[var(--color-muted)]">/100</span>
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-[var(--color-muted)]">
                        {statusLabel(iv.status, iv.end_reason)}
                      </span>
                    )}
                  </div>
                );
                return (
                  <Card key={iv.id} as="li" className="overflow-hidden">
                    {isTerminal(iv.status) ? (
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
        </section>

        {!isNewUser && avgScore !== null && (
          <Link
            href="/progress"
            className="mt-3 flex items-center justify-between rounded-[var(--radius-card)] bg-[var(--color-sunken)] px-5 py-4 transition hover:bg-[var(--color-line)]/40"
          >
            <div>
              <p className="text-sm font-medium">See how you&rsquo;re trending</p>
              <p className="text-xs text-[var(--color-muted)]">
                Scores by dimension across {scored.length} scored interview{scored.length === 1 ? "" : "s"}
              </p>
            </div>
            <span aria-hidden className="text-[var(--color-muted)]">→</span>
          </Link>
        )}

        {profile?.is_admin && (
          <Link href="/admin" className="mt-8 block text-center text-xs text-[var(--color-muted)] hover:underline">
            Admin
          </Link>
        )}
      </main>
    </>
  );
}
