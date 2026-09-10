/**
 * Real EvidenceSink, backed by the schema M0 already defines.
 *
 * packages/core's EvidenceSink interface is keyed by the CONTENT question id
 * (e.g. "gl.sandbox-to-load" — question_pool.external_id). The database's
 * actual foreign-key chain is two steps removed from that:
 *
 *   question_pool.external_id  --(looked up once, cached)-->  question_pool.id (uuid)
 *   interview_questions.id (uuid, ONE ROW PER ASK OF A QUESTION IN THIS
 *     INTERVIEW — the same content question asked in two different
 *     interviews gets two different rows) is what interview_turns and
 *     answer_evaluations actually reference.
 *
 * Both mappings are resolved and cached here, inside the concrete
 * implementation — AdaptiveBrain and the rest of packages/core never need to
 * know a uuid exists. One sink instance is scoped to exactly one interview.
 *
 * Uses a plain `postgres` connection with the service role's privileges,
 * matching M0's stated architecture: the voice agent bypasses RLS on the hot
 * path, so every query here is explicitly scoped by interviewId — there is
 * no database-enforced isolation backing this file, only the discipline of
 * always filtering by it.
 */
import type { Sql } from "postgres";
import type {
  EvaluationUpsertInput, EvidenceSink, QuestionAskedInput,
  QuestionClosedInput, TurnEvidenceInput,
} from "@ai/core";

export class PostgresEvidenceSink implements EvidenceSink {
  /** content questionId -> question_pool.id (uuid) */
  private readonly poolIdCache = new Map<string, string>();
  /** content questionId -> interview_questions.id (uuid), for THIS interview */
  private readonly askedRowId = new Map<string, string>();

  constructor(
    private readonly sql: Sql,
    private readonly interviewId: string,
    private readonly planId: string,
  ) {}

  async recordQuestionAsked(input: QuestionAskedInput): Promise<void> {
    const poolId = await this.resolvePoolId(input.questionId);
    const [row] = await this.sql<{ id: string }[]>`
      insert into interview_questions
        (interview_id, question_id, seq, section_id, difficulty_at_ask)
      values (${this.interviewId}, ${poolId}, ${input.seq}, ${input.sectionId}, ${input.difficultyAtAsk})
      returning id`;
    if (!row) throw new Error(`interview_questions insert returned no row for ${input.questionId}`);
    this.askedRowId.set(input.questionId, row.id);
  }

  async recordTurn(input: TurnEvidenceInput): Promise<string> {
    const rowId = this.requireRowId(input.questionId);
    const [row] = await this.sql<{ id: string }[]>`
      insert into interview_turns
        (interview_question_id, turn_index, speaker, text, is_probe)
      values (${rowId}, ${input.turnIndex}, ${input.speaker}, ${input.text}, ${input.isProbe})
      returning id`;
    if (!row) throw new Error(`interview_turns insert returned no row for ${input.questionId}`);
    return row.id;
  }

  async upsertEvaluation(input: EvaluationUpsertInput): Promise<void> {
    const rowId = this.requireRowId(input.questionId);
    // signals is jsonb {signal_id, status, evidence_turn_id, quote} — matches
    // the DB's snake_case column comment; SignalRecord itself is camelCase.
    const signalsJson = input.signals.map((s) => ({
      signal_id: s.signalId, status: s.status, evidence_turn_id: s.evidenceTurnId, quote: s.quote,
    }));
    await this.sql`
      insert into answer_evaluations (interview_question_id, signals, model)
      values (${rowId}, ${this.sql.json(signalsJson)}, ${input.model})
      on conflict (interview_question_id) do update set
        signals = excluded.signals, model = excluded.model, evaluated_at = now()`;
  }

  async closeQuestion(input: QuestionClosedInput): Promise<void> {
    const rowId = this.requireRowId(input.questionId);
    await this.sql`
      update interview_questions
      set closed_at = now(), close_reason = ${input.reason}, probes_used = ${input.probesUsed}
      where id = ${rowId}`;
  }

  private async resolvePoolId(externalId: string): Promise<string> {
    const cached = this.poolIdCache.get(externalId);
    if (cached) return cached;
    const [row] = await this.sql<{ id: string }[]>`
      select id from question_pool
      where plan_id = ${this.planId} and external_id = ${externalId}`;
    if (!row) {
      throw new Error(
        `question_pool has no row for external_id="${externalId}" under plan ${this.planId} — ` +
          `content and DB have drifted, or the wrong plan_id was passed`,
      );
    }
    this.poolIdCache.set(externalId, row.id);
    return row.id;
  }

  private requireRowId(questionId: string): string {
    const id = this.askedRowId.get(questionId);
    if (!id) {
      throw new Error(
        `no interview_questions row for "${questionId}" — recordQuestionAsked() must be ` +
          `called before any turn/evaluation/close for it`,
      );
    }
    return id;
  }
}
