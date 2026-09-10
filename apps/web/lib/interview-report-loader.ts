import "server-only";
import type { SignalRecord } from "@ai/core";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { computeReport, type ComputedReport, type QuestionEvidence } from "@/lib/report";

const TERMINAL_STATUSES = new Set(["complete", "abandoned"]);

export interface InterviewSummary {
  id: string; user_id: string; plan_id: string; category_id: string;
  difficulty: string; duration_s: number; status: string;
  started_at: string | null; ended_at: string | null; created_at: string;
}

export type ReportLoadResult =
  | { status: "not_found" }
  | { status: "not_ready"; interview: InterviewSummary }
  | { status: "no_questions"; interview: InterviewSummary }
  | { status: "ready"; interview: InterviewSummary; report: ComputedReport };

interface InterviewQuestionRow {
  id: string; question_id: string; seq: number; close_reason: string | null;
}
interface AnswerEvaluationRow {
  interview_question_id: string;
  signals: Array<{ signal_id: string; status: "heard" | "partial" | "missing"; evidence_turn_id: string; quote: string }>;
}
interface QuestionPoolRow {
  id: string; text: string; scores: string[];
  must_hear: Array<{ id: string; signal: string; probe: string }>;
}

/**
 * Everything a report needs, computed on read from real persisted evidence.
 * See lib/report.ts for why this is not "inventing scoring logic": the math
 * (scoreLedger) already exists and is tested, this only wires real DB rows
 * into it. Ownership is enforced by RLS on every client-client-scoped read;
 * the two service-role reads (question_pool, interview_plans) are scoped
 * explicitly to ids that came from an already-ownership-verified interview.
 */
export async function loadInterviewReport(interviewId: string): Promise<ReportLoadResult> {
  const supabase = await createClient();

  const { data: interview } = await supabase
    .from("interviews")
    .select("id, user_id, plan_id, category_id, difficulty, duration_s, status, started_at, ended_at, created_at")
    .eq("id", interviewId)
    .single<InterviewSummary>();

  if (!interview) return { status: "not_found" };
  if (!TERMINAL_STATUSES.has(interview.status)) return { status: "not_ready", interview };

  const [{ data: questionRows }, { data: evalRows }] = await Promise.all([
    supabase
      .from("interview_questions")
      .select("id, question_id, seq, close_reason")
      .eq("interview_id", interviewId)
      .order("seq", { ascending: true })
      .returns<InterviewQuestionRow[]>(),
    supabase
      .from("answer_evaluations")
      .select("interview_question_id, signals")
      .returns<AnswerEvaluationRow[]>(),
  ]);

  const questions = questionRows ?? [];
  if (questions.length === 0) return { status: "no_questions", interview };

  const service = createServiceClient();
  const [{ data: poolRows }, { data: planRow }] = await Promise.all([
    service
      .from("question_pool")
      .select("id, text, scores, must_hear")
      .in("id", questions.map((q) => q.question_id))
      .returns<QuestionPoolRow[]>(),
    service
      .from("interview_plans")
      .select("plan")
      .eq("id", interview.plan_id)
      .single<{ plan: { dimensionWeights?: Record<string, number> } }>(),
  ]);

  const poolById = new Map((poolRows ?? []).map((p) => [p.id, p]));
  const evalByQuestionId = new Map((evalRows ?? []).map((e) => [e.interview_question_id, e.signals]));
  const dimensionWeights = planRow?.plan?.dimensionWeights ?? {};

  const evidence: QuestionEvidence[] = questions
    .map((q): QuestionEvidence | null => {
      const pool = poolById.get(q.question_id);
      if (!pool) return null;
      const rawSignals = evalByQuestionId.get(q.id) ?? [];
      const signals: SignalRecord[] = rawSignals.map((s) => ({
        signalId: s.signal_id, status: s.status, evidenceTurnId: s.evidence_turn_id, quote: s.quote,
      }));
      return { questionId: q.id, text: pool.text, scores: pool.scores, mustHear: pool.must_hear, closeReason: q.close_reason, signals };
    })
    .filter((q): q is QuestionEvidence => q !== null);

  return { status: "ready", interview, report: computeReport(evidence, dimensionWeights) };
}

/** Lightweight variant for list views (dashboard, history) — just the number, or null. */
export async function loadOverallScore(interviewId: string): Promise<number | null> {
  const result = await loadInterviewReport(interviewId);
  return result.status === "ready" ? result.report.score?.overall ?? null : null;
}
