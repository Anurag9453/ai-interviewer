/**
 * M2-B brain: the same fixed three-question script as ScriptedBrain, but
 * `evaluate()` makes a real Claude call to judge the answer instead of a
 * word-count heuristic.
 *
 * This is the ONE place Claude is called in M2-B — deliberately not the full
 * signal ledger, not adaptive selection, not scoring. It exists to exercise
 * the real STT -> Claude -> TTS path with genuine model judgment while
 * staying far short of M3. `selectNext`/`intro`/`closing` are unchanged from
 * ScriptedBrain, so M3 only has to replace `evaluate()`'s implementation, not
 * the whole class.
 *
 * Reliability stance: one attempt, no application-level retry (the SDK
 * already retries transient errors at the HTTP layer). On failure this
 * degrades to "no probe, move on" — the LEAST harmful default, since getting
 * the candidate stuck on a broken evaluation is worse than skipping one
 * probe — but the failure is never silent: `onDegraded` is called with the
 * reason so the caller can log it and surface it, never fabricated as a real
 * evaluation.
 */
import { z } from "zod";
import type { LlmProvider } from "../providers/types.js";
import type {
  BrainQuestion, EvaluationContext, EvaluationOutcome,
  InterviewBrain, SelectionContext,
} from "./brain.js";
import type { CloseReason } from "./interview-machine.js";
import { SCRIPT } from "./scripted-brain.js";

const EvaluationSchema = z.object({
  shouldProbe: z.boolean(),
  /** Spoken probe text. Empty when shouldProbe is false. */
  probe: z.string().max(200),
});

const EVALUATE_SYSTEM = `You are assisting a live spoken technical interview. You judge ONE candidate
answer and decide whether it needs a follow-up probe.

Rules:
- shouldProbe is true only when the answer is genuinely shallow — a label
  restated as if it were an explanation, or a answer with no mechanism at all.
- The probe must be a single spoken question, under 20 words, that does not
  contain the answer.
- Never praise, never confirm correctness, never teach. This is mid-interview
  bookkeeping, not feedback.
- If the answer is reasonable for a mid-level candidate, shouldProbe is false
  and probe is an empty string.`;

export interface ClaudeEvaluationBrainOptions {
  provider: LlmProvider;
  /** Called on evaluation failure, before the safe fallback is returned. Never silent. */
  onDegraded?: (reason: string, error: unknown) => void;
  /** Called after every successful evaluation, for latency/usage instrumentation. */
  onEvaluated?: (info: { durationMs: number; costCents: number }) => void;
}

export class ClaudeEvaluationBrain implements InterviewBrain {
  readonly plannedTotal = SCRIPT.length;
  private closed: Array<{ questionId: string; reason: CloseReason }> = [];

  constructor(private readonly opts: ClaudeEvaluationBrainOptions) {}

  async intro(): Promise<string> {
    return "Thanks for making the time. I'll ask a few Salesforce questions, and I'd rather hear how you think than a textbook answer. Ready when you are.";
  }

  async selectNext(ctx: SelectionContext): Promise<BrainQuestion | null> {
    const next = SCRIPT.find((q) => !ctx.askedQuestionIds.includes(q.questionId));
    if (!next) return null;
    if (ctx.timeLeftS < next.hardTimeS) return null;
    return next;
  }

  async evaluate(ctx: EvaluationContext): Promise<EvaluationOutcome> {
    const started = Date.now();
    try {
      const result = await this.opts.provider.generateStructured({
        systemPrompt: EVALUATE_SYSTEM,
        userPrompt:
          `Question: ${questionTextFor(ctx.questionId)}\n\n` +
          `Candidate's answer: "${ctx.candidateText}"\n\n` +
          `Probes already used on this question: ${ctx.probesUsed}`,
        schema: EvaluationSchema,
        quality: "fast",
        maxOutputTokens: 512,
      });
      this.opts.onEvaluated?.({
        durationMs: Date.now() - started,
        costCents: result.usage.costCents,
      });
      const probesRemaining = ctx.probesUsed >= 1 ? 0 : 1; // matches maxProbes:1 in SCRIPT
      const shouldProbe = result.value.shouldProbe && probesRemaining > 0;
      return {
        probe: shouldProbe ? result.value.probe : null,
        hasUnresolvedSignals: result.value.shouldProbe,
        probesRemaining,
        recordedSignals: [],
      };
    } catch (err) {
      this.opts.onDegraded?.("evaluate() call failed", err);
      // Safe default: move on rather than leave the candidate stuck on a
      // question the system cannot currently judge.
      return { probe: null, hasUnresolvedSignals: false, probesRemaining: 0, recordedSignals: [] };
    }
  }

  async closing(): Promise<string> {
    return "That's all my questions. Thanks for talking it through — your report will be ready in a moment.";
  }

  async onQuestionClosed(questionId: string, reason: CloseReason): Promise<void> {
    this.closed.push({ questionId, reason });
  }

  get closedQuestions(): ReadonlyArray<{ questionId: string; reason: CloseReason }> {
    return this.closed;
  }
}

function questionTextFor(questionId: string): string {
  return SCRIPT.find((q) => q.questionId === questionId)?.text ?? "(unknown question)";
}
