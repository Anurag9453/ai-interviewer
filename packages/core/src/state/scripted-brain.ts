/**
 * M2-B brain: a fixed three-question script.
 *
 * Deliberately not adaptive. It exists so the end-to-end voice path can be
 * verified before M3 introduces question selection, the signal ledger, and
 * probes. It satisfies `InterviewBrain`, so M3 swaps in without the runner,
 * machine, ladder, or agent wiring changing.
 */
import type {
  BrainQuestion, EvaluationContext, EvaluationOutcome,
  InterviewBrain, SelectionContext,
} from "./brain.js";
import type { CloseReason } from "./interview-machine.js";

/** Shared with ClaudeEvaluationBrain so both M2-B brains ask the same three questions. */
export const SCRIPT: BrainQuestion[] = [
  {
    questionId: "m2.q1",
    text: "A trigger passes every test in your sandbox and then fails during a large data load. Where do you look first?",
    hardTimeS: 180,
    maxProbes: 1,
  },
  {
    questionId: "m2.q2",
    text: "You need to call an external system when an opportunity is closed. Walk me through your options.",
    hardTimeS: 180,
    maxProbes: 1,
  },
  {
    questionId: "m2.q3",
    text: "How do you test logic that calls an external system?",
    hardTimeS: 180,
    maxProbes: 1,
  },
];

export class ScriptedBrain implements InterviewBrain {
  readonly plannedTotal = SCRIPT.length;
  private closed: Array<{ questionId: string; reason: CloseReason }> = [];

  async intro(): Promise<string> {
    return "Thanks for making the time. I'll ask a few Salesforce questions, and I'd rather hear how you think than a textbook answer. Ready when you are.";
  }

  async selectNext(ctx: SelectionContext): Promise<BrainQuestion | null> {
    const next = SCRIPT.find((q) => !ctx.askedQuestionIds.includes(q.questionId));
    if (!next) return null;
    // Even the scripted brain respects the clock, so CLOSING is reachable.
    if (ctx.timeLeftS < next.hardTimeS) return null;
    return next;
  }

  async evaluate(ctx: EvaluationContext): Promise<EvaluationOutcome> {
    // M2 has no signal ledger. One probe on a very short answer is enough to
    // exercise the PROBE branch of the machine on a real call.
    const tooShort = ctx.candidateText.trim().split(/\s+/).length < 8;
    const probesRemaining = Math.max(0, 1 - ctx.probesUsed);
    const shouldProbe = tooShort && probesRemaining > 0;
    return {
      probe: shouldProbe ? "Can you take that a level deeper?" : null,
      hasUnresolvedSignals: tooShort,
      probesRemaining,
      recordedSignals: [],
    };
  }

  async closing(): Promise<string> {
    return "That's all my questions. Thanks for talking it through — your report will be ready in a moment.";
  }

  async onQuestionClosed(questionId: string, reason: CloseReason): Promise<void> {
    this.closed.push({ questionId, reason });
  }

  /** Test/diagnostic accessor. */
  get closedQuestions(): ReadonlyArray<{ questionId: string; reason: CloseReason }> {
    return this.closed;
  }
}
