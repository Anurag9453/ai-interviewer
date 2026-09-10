/**
 * Read-time report computation — no new scoring logic, no persistence.
 *
 * `interview_reports` is never written by any code in this repo yet (that's
 * the narrative-generation backend, explicitly out of M6's scope). What
 * already exists and IS real: `answer_evaluations.signals`, recorded live
 * during the interview by `AdaptiveBrain`/`PostgresEvidenceSink`, and
 * `scoreLedger()` in `packages/core/src/scoring.ts` — a pure, already-tested
 * function purpose-built to turn that evidence into dimension/category/
 * overall scores ("that stays scoring.ts's job... consuming this data
 * later", per evidence-sink.ts's own header comment). This module is that
 * consumer: it computes a report on read, from real persisted evidence,
 * using only the existing tested contract. It never writes anything.
 *
 * The one thing this deliberately does NOT attempt is the narrative pass
 * (strengths/weaknesses prose, an LLM-authored summary) — that requires a
 * model call and editorial judgment calls this module has no business
 * making. `workOn` below is not that: it is a literal, deduplicated list of
 * already-authored `must_hear` signal text for what was missing or partial,
 * not generated commentary.
 */
import { scoreLedger, bandFor, type LedgerEntry, type ScoreResult, type SignalRecord } from "@ai/core";

export interface MustHearSignal {
  id: string;
  signal: string;
  probe: string;
}

export interface QuestionEvidence {
  /** interview_questions.id — unique within this interview. */
  questionId: string;
  text: string;
  /** Dimension ids this question feeds (question_pool.scores). */
  scores: string[];
  mustHear: MustHearSignal[];
  closeReason: string | null;
  signals: SignalRecord[];
}

export interface QuestionReportView {
  questionId: string;
  text: string;
  heard: Array<{ signal: string; quote: string }>;
  partial: Array<{ signal: string; quote: string; probe: string }>;
  missing: Array<{ signal: string; probe: string }>;
  /** Cut off by the clock, or never explicitly closed — not scored, not a weakness. */
  excluded: boolean;
}

export interface ComputedReport {
  /** null only when there is no evidence at all to compute from (e.g. zero questions asked). */
  score: ScoreResult | null;
  band: string | null;
  questions: QuestionReportView[];
  /** Deduplicated, literal must_hear text for missing/partial signals — not AI-generated commentary. */
  workOn: string[];
}

const UNCLOSED = "interview_ended";

export function computeReport(
  questions: QuestionEvidence[],
  dimensionWeights: Record<string, number>,
): ComputedReport {
  const entries: LedgerEntry[] = questions.map((q) => ({
    questionId: q.questionId,
    scores: q.scores,
    signalCount: q.mustHear.length,
    recorded: q.signals,
    // A question the app never got a close_reason for was cut short just as
    // surely as one explicitly marked "interview_ended" — score the same way.
    closeReason: q.closeReason ?? UNCLOSED,
  }));

  const score = questions.length > 0 ? scoreLedger(entries, dimensionWeights) : null;
  const band = score?.overall != null ? bandFor(score.overall) : null;

  const questionViews: QuestionReportView[] = questions.map((q) => {
    const byId = new Map(q.signals.map((s) => [s.signalId, s]));
    const heard: QuestionReportView["heard"] = [];
    const partial: QuestionReportView["partial"] = [];
    const missing: QuestionReportView["missing"] = [];

    for (const mh of q.mustHear) {
      const recorded = byId.get(mh.id);
      if (!recorded || recorded.status === "missing") {
        missing.push({ signal: mh.signal, probe: mh.probe });
      } else if (recorded.status === "partial") {
        partial.push({ signal: mh.signal, quote: recorded.quote, probe: mh.probe });
      } else {
        heard.push({ signal: mh.signal, quote: recorded.quote });
      }
    }

    return {
      questionId: q.questionId,
      text: q.text,
      heard, partial, missing,
      excluded: (q.closeReason ?? UNCLOSED) === UNCLOSED,
    };
  });

  const workOn = dedupe(
    questionViews
      .filter((q) => !q.excluded)
      .flatMap((q) => [...q.missing.map((m) => m.signal), ...q.partial.map((p) => p.signal)]),
  ).slice(0, 6);

  return { score, band, questions: questionViews, workOn };
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
