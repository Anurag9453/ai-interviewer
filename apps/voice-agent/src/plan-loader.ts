/**
 * Reconstructs the real content-domain objects `AdaptiveBrain` needs
 * (`InterviewPlan`, `Question[]`, `TopicSpec[]`, seen-question ids) from the
 * DB rows M0's schema already defines — no new schema, no new content
 * pipeline, just the DB-row -> domain-type mapping the production agent was
 * missing.
 *
 * `Question.id` throughout packages/core is the CONTENT id
 * (`question_pool.external_id`, e.g. "gl.sandbox-to-load"), never the DB
 * uuid — matching postgres-evidence-sink.ts's own documented convention.
 * The mapping functions here are pure and unit-tested; the `load*` functions
 * are the thin, untested-directly DB-querying shell around them.
 */
import type { Sql } from "postgres";
import type { Difficulty, InterviewPlan, Question } from "@ai/core";
import type { TopicSpec } from "@ai/core";

export interface QuestionPoolRow {
  external_id: string;
  topic_id: string;
  text: string;
  kind: string;
  scores: string[];
  must_hear: Array<{ id: string; signal: string; probe: string }>;
  answer_key: { weak: string; competent: string; excellent: string };
  max_probes: number;
  hard_time_s: number;
  difficulty_band: string;
}

export interface TopicRow {
  id: string;
  label: string;
  importance: number;
  depth_ready: boolean;
  prereqs: string[] | null;
  aliases: string[] | null;
  rubric_ref: string;
}

export interface InterviewPlanRow {
  plan_key: string;
  category_id: string;
  difficulty: string;
  mode: string;
  duration_s: number;
  prompt_version: string;
  plan: { persona: InterviewPlan["persona"]; sections: InterviewPlan["sections"]; dimensionWeights: Record<string, number> };
}

export function toQuestion(row: QuestionPoolRow): Question {
  return {
    id: row.external_id,
    topicId: row.topic_id,
    text: row.text,
    kind: row.kind as Question["kind"],
    scores: row.scores,
    mustHear: row.must_hear,
    answerKey: row.answer_key,
    maxProbes: row.max_probes,
    hardTimeS: row.hard_time_s,
    difficultyBand: row.difficulty_band as Difficulty,
  };
}

/**
 * `description`/`expectation` are content-authoring-time-only fields
 * (prompt input for generating NEW questions) — `adaptive-selection.ts`'s
 * actual selection logic only ever reads `.id` and `.prereqs` off a topic.
 * Not stored in the `topics` table at all, so left as empty strings rather
 * than fabricating prose that would never be shown to anyone.
 */
export function toTopicSpec(row: TopicRow): TopicSpec {
  return {
    id: row.id,
    label: row.label,
    description: "",
    aliases: row.aliases ?? [],
    importance: row.importance,
    depthReady: row.depth_ready,
    prereqs: row.prereqs ?? [],
    rubricRef: row.rubric_ref,
    expectation: "",
  };
}

export function toInterviewPlan(row: InterviewPlanRow): InterviewPlan {
  return {
    planKey: row.plan_key,
    categoryId: row.category_id,
    difficulty: row.difficulty as Difficulty,
    mode: row.mode as InterviewPlan["mode"],
    durationS: row.duration_s,
    promptVersion: row.prompt_version,
    persona: row.plan.persona,
    sections: row.plan.sections,
    dimensionWeights: row.plan.dimensionWeights,
  };
}

export interface LoadedPlanData {
  plan: InterviewPlan;
  questions: Question[];
  topics: TopicSpec[];
  planDbId: string;
}

/**
 * Everything AdaptiveBrain needs to run this interview, for real, from the
 * database. Throws if the plan/pool has drifted from what the interview row
 * references — refusing to silently run an adaptive interview against the
 * wrong or missing content is the correct failure mode here.
 */
export async function loadPlanData(sql: Sql, planId: string): Promise<LoadedPlanData> {
  const [planRow] = await sql<InterviewPlanRow[]>`
    select plan_key, category_id, difficulty, mode, duration_s, prompt_version, plan
    from public.interview_plans where id = ${planId}`;
  if (!planRow) throw new Error(`no interview_plans row for id=${planId}`);

  const poolRows = await sql<QuestionPoolRow[]>`
    select external_id, topic_id, text, kind, scores, must_hear, answer_key, max_probes, hard_time_s, difficulty_band
    from public.question_pool where plan_id = ${planId}`;
  if (poolRows.length === 0) throw new Error(`question_pool is empty for plan_id=${planId}`);

  const topicRows = await sql<TopicRow[]>`
    select id, label, importance, depth_ready, prereqs, aliases, rubric_ref
    from public.topics where category_id = ${planRow.category_id}`;

  return {
    plan: toInterviewPlan(planRow),
    questions: poolRows.map(toQuestion),
    topics: topicRows.map(toTopicSpec),
    planDbId: planId,
  };
}

/** Content ids (question_pool.external_id) this candidate has already answered in a prior interview. */
export async function loadSeenQuestionIds(sql: Sql, userId: string): Promise<Set<string>> {
  const rows = await sql<{ external_id: string }[]>`
    select qp.external_id
    from public.seen_questions sq
    join public.question_pool qp on qp.id = sq.question_id
    where sq.user_id = ${userId}`;
  return new Set(rows.map((r) => r.external_id));
}
