/**
 * Per-question signal ledger.
 *
 * Pure data + pure functions — no I/O, no provider, no clock. AdaptiveBrain
 * drives it from tool calls the live session emits; every transition here is
 * unit-testable without a model.
 */
import type { MustHearSignal } from "../schema/plan.js";
import type { SignalRecord, SignalStatus } from "../schema/evaluation.js";

export interface LedgerSignal {
  id: string;
  /** The signal description, for prompting — never shown to the candidate. */
  signal: string;
  /** Canned first-attempt probe text, authored and reviewed at content time. */
  probe: string;
  status: SignalStatus;
  evidenceTurnId: string | null;
  quote: string;
}

export interface QuestionLedger {
  questionId: string;
  /** Preserves authored order: basic -> advanced, per the M1 generation rules. */
  signals: LedgerSignal[];
}

/** New signals default to "missing" — unjudged is scored identically to
 *  judged-and-missing, matching scoreLedger()'s existing semantics where an
 *  omitted signal counts as 0. `evidenceTurnId: null` is what distinguishes
 *  "never reached" from "explicitly judged missing" for evidence purposes. */
export function createLedger(question: { id: string; mustHear: MustHearSignal[] }): QuestionLedger {
  return {
    questionId: question.id,
    signals: question.mustHear.map((m) => ({
      id: m.id,
      signal: m.signal,
      probe: m.probe,
      status: "missing",
      evidenceTurnId: null,
      quote: "",
    })),
  };
}

/**
 * Applies one judgment. Pure — returns a new ledger, never mutates.
 *
 * There is no automatic protection against downgrading a "heard" signal —
 * every call here is an explicit judgment the brain chose to apply, so a
 * downgrade only happens when the model genuinely said the candidate
 * contradicted themselves. The brain is responsible for only calling this
 * for signals the live session actually judged this turn, not for
 * re-asserting stale state.
 */
export function applyJudgment(
  ledger: QuestionLedger,
  signalId: string,
  status: SignalStatus,
  evidenceTurnId: string,
  quote: string,
): QuestionLedger {
  return {
    ...ledger,
    signals: ledger.signals.map((s) =>
      s.id === signalId ? { ...s, status, evidenceTurnId, quote } : s,
    ),
  };
}

export function unresolvedSignals(ledger: QuestionLedger): LedgerSignal[] {
  return ledger.signals.filter((s) => s.status !== "heard");
}

/** Lowest-ordered (most basic) unresolved signal — the next probe target. */
export function pickProbeTarget(ledger: QuestionLedger): LedgerSignal | null {
  return unresolvedSignals(ledger)[0] ?? null;
}

export function isFullyResolved(ledger: QuestionLedger): boolean {
  return unresolvedSignals(ledger).length === 0;
}

const STATUS_VALUE: Record<SignalStatus, number> = { heard: 1, partial: 0.5, missing: 0 };

/** Fraction of signals resolved, 0-1. Matches scoreLedger()'s scoring unit. */
export function ratio(ledger: QuestionLedger): number {
  if (ledger.signals.length === 0) return 0;
  const earned = ledger.signals.reduce((sum, s) => sum + STATUS_VALUE[s.status], 0);
  return earned / ledger.signals.length;
}

/** Schema-conformant evidence — only signals actually judged (real evidenceTurnId). */
export function toSignalRecords(ledger: QuestionLedger): SignalRecord[] {
  return ledger.signals
    .filter((s): s is LedgerSignal & { evidenceTurnId: string } => s.evidenceTurnId !== null)
    .map((s) => ({ signalId: s.id, status: s.status, evidenceTurnId: s.evidenceTurnId, quote: s.quote }));
}
