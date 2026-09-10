"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonClass, Card, EmptyState } from "@/components/ui";

export interface PlanOption {
  categoryId: string;
  categoryLabel: string;
  difficulty: string;
  durationMin: number;
}

const DIFFICULTY_ORDER = ["beginner", "intermediate", "advanced"];

const FOCUS_BY_DIFFICULTY: Record<string, string> = {
  beginner: "Whether you can explain the fundamentals clearly and spot the obvious pitfalls.",
  intermediate: "Whether you can reason about trade-offs and justify the approach you'd take.",
  advanced: "Depth under pressure — edge cases, failure modes, and defending decisions when pushed.",
};

/**
 * Progressive configuration: field, then difficulty, then length, then a
 * summary. Each step only appears once the one before it is answered, so the
 * candidate never faces a wall of unrelated controls.
 *
 * Choices are constrained to the `options` the server found in
 * interview_plans, which is why an unavailable combination can't be selected
 * rather than failing at start time.
 */
export function TopicInterviewFlow({
  options, topicsByCategory, remaining,
}: {
  options: PlanOption[];
  topicsByCategory: Record<string, string[]>;
  remaining: number;
}) {
  const router = useRouter();
  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of options) if (!seen.has(o.categoryId)) seen.set(o.categoryId, o.categoryLabel);
    return [...seen].map(([id, label]) => ({ id, label }));
  }, [options]);

  // Preselect when there's only one honest choice — making someone click a
  // single-option list is friction, not a decision.
  const [categoryId, setCategoryId] = useState<string | null>(categories.length === 1 ? categories[0]!.id : null);

  const difficulties = useMemo(() => {
    if (!categoryId) return [];
    const set = new Set(options.filter((o) => o.categoryId === categoryId).map((o) => o.difficulty));
    return DIFFICULTY_ORDER.filter((d) => set.has(d));
  }, [options, categoryId]);

  const [difficulty, setDifficulty] = useState<string | null>(null);
  const effectiveDifficulty = difficulty ?? (difficulties.length === 1 ? difficulties[0]! : null);

  const durations = useMemo(() => {
    if (!categoryId || !effectiveDifficulty) return [];
    return [...new Set(
      options
        .filter((o) => o.categoryId === categoryId && o.difficulty === effectiveDifficulty)
        .map((o) => o.durationMin),
    )].sort((a, b) => a - b);
  }, [options, categoryId, effectiveDifficulty]);

  const [durationMin, setDurationMin] = useState<number | null>(null);
  const effectiveDuration = durationMin ?? (durations.length === 1 ? durations[0]! : null);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = categoryId && effectiveDifficulty && effectiveDuration !== null;
  const categoryLabel = categories.find((c) => c.id === categoryId)?.label ?? "";
  const topics = categoryId ? topicsByCategory[categoryId] ?? [] : [];

  async function start() {
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId, difficulty: effectiveDifficulty, durationMin: effectiveDuration }),
      });
      if (res.status === 402) {
        setError("You're out of interview credits.");
        return;
      }
      if (res.status === 409) {
        setError("That combination isn't available yet — try a different one.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't start the interview. Please try again.");
        return;
      }
      const data = (await res.json()) as { interviewId: string };
      // The room fetches its own token, so none is ever put in the URL.
      router.push(`/interview?interviewId=${data.interviewId}`);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setPending(false);
    }
  }

  if (categories.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          title="No interviews are available yet"
          body="There's no published question bank to interview you against right now. You can still be interviewed on your resume or your own material."
          action={<Link href="/interview/new" className={buttonClass.primary}>Back to options</Link>}
        />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <Step n={1} label="Field" done={Boolean(categoryId)}>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <Choice
              key={c.id}
              selected={categoryId === c.id}
              onClick={() => { setCategoryId(c.id); setDifficulty(null); setDurationMin(null); }}
            >
              {c.label}
            </Choice>
          ))}
        </div>
        {topics.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-[var(--color-muted)]">
              Topics in this bank — the interviewer picks from these adaptively:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {topics.slice(0, 12).map((t) => (
                <span key={t} className="rounded-full bg-[var(--color-sunken)] px-2.5 py-1 text-xs text-[var(--color-ink-soft)]">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </Step>

      {categoryId && (
        <Step n={2} label="Difficulty" done={Boolean(effectiveDifficulty)}>
          <div className="flex flex-wrap gap-2">
            {difficulties.map((d) => (
              <Choice
                key={d}
                selected={effectiveDifficulty === d}
                onClick={() => { setDifficulty(d); setDurationMin(null); }}
              >
                <span className="capitalize">{d}</span>
              </Choice>
            ))}
          </div>
        </Step>
      )}

      {categoryId && effectiveDifficulty && (
        <Step n={3} label="Length" done={effectiveDuration !== null}>
          <div className="flex flex-wrap gap-2">
            {durations.map((m) => (
              <Choice key={m} selected={effectiveDuration === m} onClick={() => setDurationMin(m)}>
                {m} minutes
              </Choice>
            ))}
          </div>
        </Step>
      )}

      {ready && (
        <Card className="animate-rise p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
            Before you start
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Type" value="Technical interview" />
            <Row label="Field" value={categoryLabel} />
            <Row label="Difficulty" value={effectiveDifficulty} capitalize />
            <Row label="Length" value={`about ${effectiveDuration} minutes`} />
          </dl>
          <p className="mt-3.5 border-t border-[var(--color-line)] pt-3.5 text-sm leading-relaxed text-[var(--color-muted)]">
            <span className="font-medium text-[var(--color-ink-soft)]">What&rsquo;s being assessed: </span>
            {FOCUS_BY_DIFFICULTY[effectiveDifficulty] ?? FOCUS_BY_DIFFICULTY.intermediate}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
            It&rsquo;s voice-only — you&rsquo;ll do a quick microphone check, then the interviewer asks one question at
            a time and follows up. You can end it whenever you like.
          </p>

          <div className="mt-5">
            {remaining === 0 ? (
              <div className="space-y-2.5">
                <p className="rounded-[var(--radius-control)] bg-[var(--color-caution-wash)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">
                  You have no interview credits left.
                </p>
                <Link href="/billing" className={`${buttonClass.primary} w-full`}>Get more credits</Link>
              </div>
            ) : (
              <>
                <button onClick={() => void start()} disabled={pending} className={`${buttonClass.primary} w-full py-3`}>
                  {pending ? "Starting…" : "Start interview"}
                </button>
                <p className="mt-2 text-center text-xs text-[var(--color-muted)]">
                  Uses 1 of your {remaining} remaining credit{remaining === 1 ? "" : "s"}
                </p>
              </>
            )}
            {error && <p role="alert" className="mt-2 text-center text-sm text-[var(--color-critical)]">{error}</p>}
          </div>
        </Card>
      )}
    </div>
  );
}

function Step({ n, label, done, children }: { n: number; label: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="animate-rise">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span
          aria-hidden
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
            done ? "bg-[var(--color-ink)] text-white" : "bg-[var(--color-sunken)] text-[var(--color-muted)]"
          }`}
        >
          {n}
        </span>
        <h2 className="text-sm font-medium">{label}</h2>
      </div>
      {children}
    </section>
  );
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-[var(--radius-control)] border px-4 py-2.5 text-sm font-medium transition ${
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-accent-wash)] text-[var(--color-accent-ink)]"
          : "border-[var(--color-line-strong)] bg-[var(--color-raised)] hover:bg-[var(--color-sunken)]"
      }`}
    >
      {children}
    </button>
  );
}

function Row({ label, value, capitalize = false }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[var(--color-muted)]">{label}</dt>
      <dd className={`text-right font-medium ${capitalize ? "capitalize" : ""}`}>{value}</dd>
    </div>
  );
}
