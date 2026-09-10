/**
 * The M3 plug-in boundary.
 *
 * M2 ships `ScriptedBrain` (a fixed question list). M3 replaces it with the
 * adaptive selector, signal ledger, and probe logic WITHOUT touching the
 * state machine, the silence ladder, the UI contract, or the agent wiring.
 */
import type { CloseReason } from "./interview-machine.js";
import type { SignalRecord } from "../schema/evaluation.js";

export interface BrainQuestion {
  questionId: string;
  text: string;
  /** Hard time budget for this question, seconds. */
  hardTimeS: number;
  maxProbes: number;
}

export interface EvaluationContext {
  questionId: string;
  candidateText: string;
  probesUsed: number;
  elapsedS: number;
  timeLeftS: number;
}

export interface EvaluationOutcome {
  /** Text to speak as a probe, or null to move on. */
  probe: string | null;
  hasUnresolvedSignals: boolean;
  probesRemaining: number;
  /** M3 populates this; M2 leaves it empty. */
  recordedSignals: SignalRecord[];
}

export interface SelectionContext {
  askedQuestionIds: string[];
  timeLeftS: number;
  elapsedS: number;
}

export interface InterviewBrain {
  readonly plannedTotal: number;
  intro(): Promise<string>;
  /** null means nothing suitable remains, which sends the machine to CLOSING. */
  selectNext(ctx: SelectionContext): Promise<BrainQuestion | null>;
  evaluate(ctx: EvaluationContext): Promise<EvaluationOutcome>;
  closing(): Promise<string>;
  /** Called as each question closes, so M3 can persist its ledger. */
  onQuestionClosed(questionId: string, reason: CloseReason): Promise<void>;
}
