/**
 * M3 adaptive interview brain.
 *
 * Satisfies the exact `InterviewBrain` contract ScriptedBrain and
 * ClaudeEvaluationBrain already satisfied — the state machine, silence
 * ladder, and InterviewRunner are byte-for-byte unchanged. Only the brain
 * gets smarter: adaptive selection (coverage, difficulty, prereqs,
 * seen-avoidance, time), a real per-question signal ledger, and targeted
 * probes, all persisted as evidence.
 *
 * What this is NOT: a grader. `evaluate()` and `onQuestionClosed()` write to
 * an EvidenceSink; nothing here computes a dimension score or a report.
 * scoring.ts (M4) reads what gets persisted here — it does not get called
 * from here.
 *
 * Provider usage, and why: the live per-turn signal judgment goes through
 * `LlmProvider.openLiveSession()` — the streaming interface — never
 * `generateStructured()`. One session opens lazily and is reused for the
 * whole interview (prompt-cacheable prefix, matches how LiveSession is
 * documented to be used). The model's ONLY job on this call is judging
 * must-hear signals via `record_signal` tool calls; it does not choose
 * questions or compose the main spoken lines — those stay deterministic and
 * pool-sourced, which is what keeps interview content reviewable and
 * reproducible. The one place the model's own words reach the candidate is
 * a SECOND-OR-LATER probe on the same signal: the first attempt always uses
 * the authored, reviewed `probe` text from the M1 content; only a repeat
 * probe asks the model to narrow further from context, mirroring the
 * content generator's own rule ("write the probe as the first attempt; the
 * live agent narrows on its own for the second attempt").
 */
import type { Difficulty } from "../schema/plan.js";
import type { Question } from "../schema/plan.js";
import type { InterviewPlan } from "../schema/plan.js";
import type { TopicSpec } from "../prompts/plan-generator.js";
import type { LlmProvider, LiveSession, ToolSpec, Usage } from "../providers/types.js";
import { ZERO_USAGE } from "../providers/types.js";
import type {
  BrainQuestion, EvaluationContext, EvaluationOutcome,
  InterviewBrain, SelectionContext,
} from "./brain.js";
import type { CloseReason } from "./interview-machine.js";
import type { SignalStatus } from "../schema/evaluation.js";
import {
  applyJudgment, createLedger, isFullyResolved, pickProbeTarget, ratio,
  toSignalRecords, unresolvedSignals, type QuestionLedger,
} from "./signal-ledger.js";
import {
  eligibleQuestions, initialSelectionState, pickNextQuestion, recordQuestionOutcome,
  type SelectionState,
} from "./adaptive-selection.js";
import { InMemoryEvidenceSink, type EvidenceSink } from "./evidence-sink.js";

const RECORD_SIGNAL_TOOL: ToolSpec = {
  name: "record_signal",
  description:
    "Record whether a specific must-hear signal was satisfied by the candidate's " +
    "most recent answer. Call once per signal you can now judge. Silent bookkeeping " +
    "— never part of what the candidate hears.",
  parameters: {
    type: "object",
    properties: {
      signalId: { type: "string" },
      status: { type: "string", enum: ["heard", "partial", "missing"] },
      quote: {
        type: "string",
        description: "A short verbatim span from the candidate's answer supporting this judgment.",
      },
    },
    required: ["signalId", "status", "quote"],
    additionalProperties: false,
  },
};

const EVIDENCE_SYSTEM = `You silently judge candidate answers against must-hear signals during a
live technical interview. You do not choose questions and you do not decide
when to move on — that is handled elsewhere. Your only job is judgment.

Call record_signal once for every signal you can now judge from the
candidate's most recent answer:
  heard    the signal is clearly present, even if phrased differently
  partial  gestured at but not stated with the needed specificity
  missing  not present at all, or the answer only restates the question

Never call record_signal for a signal not listed as unresolved this turn.
An answer that only restates the question or expands an acronym satisfies
NOTHING — mark every listed signal missing in that case.

Most turns you say nothing at all — this is silent bookkeeping, not part of
the conversation the candidate hears. Only when told this is a repeat probe
do you speak, and then only one short, open question (under 15 words) that
narrows toward the missing signal without containing the answer.`;

interface AskedQuestionState {
  question: Question;
  ledger: QuestionLedger;
  seq: number;
  probesUsed: number;
  turnIndex: number;
}

export interface AdaptiveBrainOptions {
  provider: LlmProvider;
  plan: InterviewPlan;
  /** Full pool across all topics the plan covers. */
  questions: readonly Question[];
  /** Topic metadata for prerequisite checks. */
  topics: readonly TopicSpec[];
  /** Defaults to an in-memory sink — safe for tests and local dev. */
  sink?: EvidenceSink;
  /** Questions this candidate has answered in a PRIOR session. */
  seenQuestionIds?: ReadonlySet<string>;
  /** Defaults to plan.difficulty. */
  startingDifficulty?: Difficulty;
  /** Called on any live-session failure. Never silent — see ClaudeEvaluationBrain's rationale. */
  onDegraded?: (reason: string, error: unknown) => void;
  /**
   * Fires once per evaluated turn with that turn's OWN usage — never a running
   * total. Callers accumulate these deltas, so handing back a cumulative figure
   * silently produces a triangular sum (see the note at the call site).
   */
  onEvaluated?: (info: { durationMs: number; usage: Usage; model: string; provider: string }) => void;
}

/** Overhead per question beyond its own hardTimeS — ask + transition time. */
const OVERHEAD_S = 30;

export class AdaptiveBrain implements InterviewBrain {
  readonly plannedTotal: number;

  private readonly byId: Map<string, Question>;
  private readonly asked = new Map<string, AskedQuestionState>();
  private selection: SelectionState;
  private session: LiveSession | null = null;
  private nextSeq = 1;
  private readonly sink: EvidenceSink;

  constructor(private readonly opts: AdaptiveBrainOptions) {
    this.byId = new Map(opts.questions.map((q) => [q.id, q]));
    this.sink = opts.sink ?? new InMemoryEvidenceSink();
    this.selection = {
      ...initialSelectionState(opts.startingDifficulty ?? opts.plan.difficulty),
      seenIds: opts.seenQuestionIds ?? new Set(),
    };

    const avgHardTimeS =
      opts.questions.reduce((sum, q) => sum + q.hardTimeS, 0) / Math.max(1, opts.questions.length);
    const usableS = opts.plan.durationS - 120; // closing reserve, matches RunnerOptions default
    this.plannedTotal = Math.max(
      1,
      Math.min(opts.questions.length, Math.round(usableS / (avgHardTimeS + OVERHEAD_S))),
    );
  }

  async intro(): Promise<string> {
    const name = this.opts.plan.persona.name;
    return `Thanks for making the time. I'm ${name}, and I'll ask a few questions about ` +
      `${this.categoryLabel()}. I'd rather hear how you think than a textbook answer. ` +
      `Ready when you are.`;
  }

  async selectNext(ctx: SelectionContext): Promise<BrainQuestion | null> {
    const next = pickNextQuestion(
      this.opts.questions,
      this.opts.topics,
      { ...this.selection, askedIds: new Set(ctx.askedQuestionIds) },
      ctx.timeLeftS,
    );
    if (!next) return null;

    const state: AskedQuestionState = {
      question: next,
      ledger: createLedger(next),
      seq: this.nextSeq++,
      probesUsed: 0,
      turnIndex: 0,
    };
    this.asked.set(next.id, state);

    await this.sink.recordQuestionAsked({
      questionId: next.id,
      seq: state.seq,
      sectionId: this.sectionIdFor(next.id),
      difficultyAtAsk: this.selection.difficultyPointer,
    });

    return { questionId: next.id, text: next.text, hardTimeS: next.hardTimeS, maxProbes: next.maxProbes };
  }

  async evaluate(ctx: EvaluationContext): Promise<EvaluationOutcome> {
    const state = this.asked.get(ctx.questionId);
    if (!state) {
      // Defensive: the runner should never call evaluate() on a question we
      // didn't hand it. Fail safe rather than throw mid-interview.
      return { probe: null, hasUnresolvedSignals: false, probesRemaining: 0, recordedSignals: [] };
    }

    const turnId = await this.sink.recordTurn({
      questionId: ctx.questionId,
      turnIndex: state.turnIndex++,
      speaker: "candidate",
      text: ctx.candidateText,
      isProbe: false,
    });

    let modelText = "";
    let degraded = false;
    const started = Date.now();
    try {
      const session = this.ensureSession();
      const unresolvedBefore = unresolvedSignals(state.ledger);
      const isRepeatProbe = ctx.probesUsed > 0;
      const stateBlock = this.buildStateBlock(state, unresolvedBefore, ctx, isRepeatProbe);

      const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
      // Per-turn delta, taken straight off the `done` event.
      //
      // NOT session.totalUsage(): one session is reused for the whole interview
      // (see the prompt-caching note in this file's header), so totalUsage() is
      // the running total. Reporting that to a caller which ADDS it every turn
      // produced a triangular sum — Σ(n-i+1)·cᵢ instead of Σcᵢ, roughly a 5×
      // over-count at nine turns. Observed in production on 2026-09-11 as a
      // 3739-cent figure for a single 8-minute interview.
      let turnUsage: Usage = ZERO_USAGE;
      for await (const ev of session.turn({ candidateUtterance: ctx.candidateText, stateBlock })) {
        if (ev.type === "text") modelText += ev.delta;
        else if (ev.type === "tool_call") toolCalls.push(ev);
        else if (ev.type === "done") turnUsage = ev.usage;
        else if (ev.type === "error") {
          degraded = true;
          this.opts.onDegraded?.("live turn failed", ev.error);
        }
      }
      session.settleToolCalls(toolCalls.map((tc) => ({ id: tc.id, content: "ok" })));

      if (!degraded) {
        for (const call of toolCalls) {
          if (call.name !== "record_signal") continue;
          const input = call.input as { signalId?: unknown; status?: unknown; quote?: unknown };
          if (
            typeof input.signalId !== "string" ||
            typeof input.quote !== "string" ||
            !isSignalStatus(input.status)
          ) {
            continue; // malformed tool input — ignore rather than crash the turn
          }
          state.ledger = applyJudgment(state.ledger, input.signalId, input.status, turnId, input.quote);
        }
        this.opts.onEvaluated?.({
          durationMs: Date.now() - started,
          usage: turnUsage,
          model: this.opts.provider.liveModel,
          provider: this.opts.provider.id,
        });
      }
    } catch (err) {
      degraded = true;
      this.opts.onDegraded?.("evaluate() call failed", err);
    }

    await this.sink.upsertEvaluation({
      questionId: ctx.questionId,
      signals: toSignalRecords(state.ledger),
      model: this.opts.provider.liveModel,
    });

    if (degraded) {
      // No real judgment happened this turn — we cannot safely target a
      // probe (there is nothing new to narrow toward) and we must not
      // report the question as resolved either. "Move on" is the least
      // harmful default: getting stuck on a question the system currently
      // cannot judge is worse than skipping it, mirroring
      // ClaudeEvaluationBrain's established degrade behaviour.
      return { probe: null, hasUnresolvedSignals: false, probesRemaining: 0, recordedSignals: toSignalRecords(state.ledger) };
    }

    const hasUnresolvedSignals = !isFullyResolved(state.ledger);
    const probesRemaining = Math.max(0, state.question.maxProbes - ctx.probesUsed);

    let probe: string | null = null;
    if (hasUnresolvedSignals && probesRemaining > 0) {
      const target = pickProbeTarget(state.ledger);
      if (target) {
        // First attempt on ANY signal in this question: use the authored,
        // reviewed probe text. Later attempts: prefer what the model just
        // said (a narrower nudge in context), falling back to the canned
        // text if it said nothing or the call degraded.
        probe = ctx.probesUsed === 0 ? target.probe : modelText.trim() || target.probe;
        state.probesUsed += 1;
        await this.sink.recordTurn({
          questionId: ctx.questionId,
          turnIndex: state.turnIndex++,
          speaker: "interviewer",
          text: probe,
          isProbe: true,
        });
      }
    }

    return {
      probe,
      hasUnresolvedSignals,
      probesRemaining,
      recordedSignals: toSignalRecords(state.ledger),
    };
  }

  async closing(): Promise<string> {
    return "That's all my questions. Thanks for talking it through — your report will be ready in a moment.";
  }

  async onQuestionClosed(questionId: string, reason: CloseReason): Promise<void> {
    const state = this.asked.get(questionId);
    const questionRatio = state ? ratio(state.ledger) : 0;
    const topicId = state?.question.topicId ?? this.byId.get(questionId)?.topicId ?? "unknown";

    this.selection = recordQuestionOutcome(this.selection, topicId, questionRatio);

    await this.sink.closeQuestion({
      questionId,
      reason,
      probesUsed: state?.probesUsed ?? 0,
    });
  }

  /** Not part of InterviewBrain — called by whoever constructs this brain
   *  once the interview is fully done, so the live session's connection is
   *  released deterministically rather than left to GC. */
  dispose(): void {
    this.session?.dispose();
    this.session = null;
  }

  // ── internal ────────────────────────────────────────────────────────────

  private ensureSession(): LiveSession {
    if (!this.session) {
      this.session = this.opts.provider.openLiveSession({
        systemPrompt: EVIDENCE_SYSTEM,
        planContext: `category: ${this.opts.plan.categoryId}, difficulty: ${this.opts.plan.difficulty}`,
        tools: [RECORD_SIGNAL_TOOL],
        maxOutputTokens: 512,
      });
    }
    return this.session;
  }

  private buildStateBlock(
    state: AskedQuestionState,
    unresolved: ReturnType<typeof unresolvedSignals>,
    ctx: EvaluationContext,
    isRepeatProbe: boolean,
  ): string {
    const lines = [
      `CURRENT QUESTION: ${state.question.text}`,
      `UNRESOLVED SIGNALS:`,
      ...unresolved.map((s) => `  - ${s.id}: ${s.signal}`),
      `PROBES USED SO FAR: ${ctx.probesUsed}`,
      `TIME LEFT: ${Math.round(ctx.timeLeftS)}s`,
    ];
    lines.push(
      isRepeatProbe
        ? "This is a repeat probe. If signals remain unresolved after judging, " +
            "speak ONE brief, narrower follow-up question. Otherwise say nothing."
        : "Judge the signals from the candidate's answer via record_signal. " +
            "Do not speak — this turn is silent bookkeeping only.",
    );
    return lines.join("\n");
  }

  private sectionIdFor(questionId: string): string | null {
    const topicId = this.byId.get(questionId)?.topicId;
    if (!topicId) return null;
    return this.opts.plan.sections.find((s) => s.topicIds.includes(topicId))?.id ?? null;
  }

  private categoryLabel(): string {
    return this.opts.plan.categoryId.replace(/_/g, " ");
  }
}

function isSignalStatus(value: unknown): value is SignalStatus {
  return value === "heard" || value === "partial" || value === "missing";
}
