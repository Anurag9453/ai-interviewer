/**
 * Persistence boundary for M3.
 *
 * "Record evidence, not become the final grading system" — this interface
 * writes turns, per-question asks/closes, and signal judgments. It computes
 * nothing: no scores, no dimension aggregation, no report. That stays
 * scoring.ts's job (M4), consuming this data later.
 *
 * packages/core only ships the interface plus an in-memory test double, so
 * it stays free of a Postgres/Supabase dependency. The real implementation
 * (apps/voice-agent/src/postgres-evidence-sink.ts) writes directly to the
 * schema M0 already defines — interview_questions, interview_turns,
 * answer_evaluations — via a plain Postgres connection, matching the
 * existing architecture where the voice agent bypasses RLS on the hot path.
 */
import type { Difficulty } from "../schema/plan.js";
import type { SignalRecord } from "../schema/evaluation.js";
import type { CloseReason } from "./interview-machine.js";

export type TurnSpeaker = "interviewer" | "candidate";

export interface QuestionAskedInput {
  questionId: string;
  /** 1-based order within the interview. */
  seq: number;
  sectionId: string | null;
  difficultyAtAsk: Difficulty;
}

export interface TurnEvidenceInput {
  questionId: string;
  /** 0-based, per question. */
  turnIndex: number;
  speaker: TurnSpeaker;
  text: string;
  isProbe: boolean;
}

export interface EvaluationUpsertInput {
  questionId: string;
  signals: SignalRecord[];
  model: string;
}

export interface QuestionClosedInput {
  questionId: string;
  reason: CloseReason;
  probesUsed: number;
}

export interface EvidenceSink {
  recordQuestionAsked(input: QuestionAskedInput): Promise<void>;
  /** Returns an evidenceTurnId — what SignalRecord.evidenceTurnId points back to. */
  recordTurn(input: TurnEvidenceInput): Promise<string>;
  /** Called after every evaluate() call, not only at close — matches
   *  answer_evaluations being "upserted as signals resolve" (see M0 schema). */
  upsertEvaluation(input: EvaluationUpsertInput): Promise<void>;
  closeQuestion(input: QuestionClosedInput): Promise<void>;
}

/** Test double and local-dev fallback. Everything is inspectable after the fact. */
export class InMemoryEvidenceSink implements EvidenceSink {
  readonly questionsAsked: QuestionAskedInput[] = [];
  readonly turns: Array<TurnEvidenceInput & { id: string }> = [];
  readonly evaluations: EvaluationUpsertInput[] = [];
  readonly questionsClosed: QuestionClosedInput[] = [];
  private nextTurnId = 0;

  async recordQuestionAsked(input: QuestionAskedInput): Promise<void> {
    this.questionsAsked.push(input);
  }

  async recordTurn(input: TurnEvidenceInput): Promise<string> {
    const id = `turn_${this.nextTurnId++}`;
    this.turns.push({ ...input, id });
    return id;
  }

  async upsertEvaluation(input: EvaluationUpsertInput): Promise<void> {
    // Keep only the latest snapshot per question, mirroring a DB upsert.
    const idx = this.evaluations.findIndex((e) => e.questionId === input.questionId);
    if (idx >= 0) this.evaluations[idx] = input;
    else this.evaluations.push(input);
  }

  async closeQuestion(input: QuestionClosedInput): Promise<void> {
    this.questionsClosed.push(input);
  }
}
