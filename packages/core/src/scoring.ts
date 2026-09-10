import {
  DIMENSIONS,
  REPORT_CATEGORIES,
  type Dimension,
  type ReportCategory,
  type SignalRecord,
} from "./schema/evaluation.js";

const STATUS_VALUE = { heard: 1, partial: 0.5, missing: 0 } as const;

export interface LedgerEntry {
  questionId: string;
  /** Dimension ids this question feeds. */
  scores: string[];
  /** Total signals defined on the question, not just the recorded ones. */
  signalCount: number;
  recorded: SignalRecord[];
  closeReason: string;
}

/**
 * `null` means NOT ASSESSED — no question in this interview exercised the
 * dimension. It is not a zero, is excluded from `overall`, and must be
 * rendered as "not assessed" rather than as a score.
 */
export type MaybeScore = number | null;

export interface ScoreResult {
  dimensions: Record<Dimension, MaybeScore>;
  categories: Record<ReportCategory, MaybeScore>;
  /** null when nothing at all was assessed — do not write a report. */
  overall: number | null;
  assessed: Dimension[];
  notAssessed: Dimension[];
  /** Questions the clock cut off; excluded from scoring, shown as not reached. */
  excludedQuestionIds: string[];
}

/**
 * Deterministic ledger → scores. The model does not produce these numbers.
 *
 * Users take several interviews and compare scores, so identical performance
 * must yield an identical number. The narrative pass may adjust a dimension by
 * at most ±1 with written justification, applied on top of this.
 */
export function scoreLedger(
  entries: LedgerEntry[],
  dimensionWeights: Record<string, number>,
): ScoreResult {
  const excludedQuestionIds: string[] = [];
  const buckets = new Map<Dimension, number[]>(DIMENSIONS.map((d) => [d, []]));

  for (const entry of entries) {
    // A question the clock cut off is not evidence of weakness.
    if (entry.closeReason === "interview_ended" || entry.signalCount === 0) {
      excludedQuestionIds.push(entry.questionId);
      continue;
    }
    const earned = entry.recorded.reduce((sum, r) => sum + STATUS_VALUE[r.status], 0);
    const ratio = clamp01(earned / entry.signalCount);
    for (const dim of entry.scores) {
      buckets.get(dim as Dimension)?.push(ratio * 10);
    }
  }

  const dimensions = {} as Record<Dimension, MaybeScore>;
  const assessed: Dimension[] = [];
  const notAssessed: Dimension[] = [];

  for (const d of DIMENSIONS) {
    const vals = buckets.get(d) ?? [];
    if (vals.length === 0) {
      // Never silently 0 — a dimension no question touched was not assessed.
      dimensions[d] = null;
      notAssessed.push(d);
      continue;
    }
    dimensions[d] = round1(vals.reduce((a, b) => a + b, 0) / vals.length);
    assessed.push(d);
  }

  // A category is scored from whichever of its component dimensions were
  // assessed, with the surviving weights renormalized. All components missing
  // means the category is not assessed either.
  const categories = {} as Record<ReportCategory, MaybeScore>;
  for (const cat of Object.keys(REPORT_CATEGORIES) as ReportCategory[]) {
    const parts = REPORT_CATEGORIES[cat] as Partial<Record<Dimension, number>>;
    let total = 0;
    let weight = 0;
    for (const [dim, w] of Object.entries(parts) as [Dimension, number][]) {
      const score = dimensions[dim];
      if (score === null) continue;
      total += score * w;
      weight += w;
    }
    categories[cat] = weight === 0 ? null : round1(total / weight);
  }

  // Overall is the weighted mean of the ASSESSED raw dimensions, weights
  // renormalized. Never of the five categories — technical_accuracy appears in
  // two of them and would be double counted.
  let weighted = 0;
  let weightSum = 0;
  for (const d of assessed) {
    const score = dimensions[d];
    if (score === null) continue;
    const w = dimensionWeights[d] ?? 1 / DIMENSIONS.length;
    weighted += score * w;
    weightSum += w;
  }

  const overall = weightSum === 0 ? null : Math.round((weighted / weightSum) * 10);

  return { dimensions, categories, overall, assessed, notAssessed, excludedQuestionIds };
}

export function bandFor(overall: number): string {
  if (overall >= 85) return "Strong across the board";
  if (overall >= 70) return "Would clear a screen; solid in an onsite loop";
  if (overall >= 55) return "Would likely clear a screen; would struggle in a full loop";
  if (overall >= 40) return "Fundamentals present but inconsistent under probing";
  return "Not yet interview ready on this material";
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
