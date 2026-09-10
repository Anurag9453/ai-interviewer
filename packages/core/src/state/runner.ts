/**
 * Interview orchestrator.
 *
 * Owns the machine state and the silence ladder, and executes machine effects
 * through injected `VoiceIO` and `InterviewBrain`. LiveKit is one VoiceIO
 * implementation; the tests use a mock, so the entire interview flow is
 * verifiable without credentials, audio, or a model.
 */
import {
  initialState, transition,
  type CloseReason, type Effect, type EndReason, type Event, type MachineState,
} from "./interview-machine.js";
import {
  DEFAULT_LADDER, IDLE_LADDER, onCandidateSilent, onCandidateSpeaking,
  pollLadder, startLadder, stopLadder,
  type LadderConfig, type LadderStage, type LadderState,
} from "./silence-ladder.js";
import type { UiEvent } from "./ui-events.js";
import type { BrainQuestion, InterviewBrain } from "./brain.js";

export interface VoiceIO {
  /** Resolves when playback finishes. Rejects/resolves early if interrupted. */
  speak(text: string): Promise<void>;
  /** Stop playback immediately — barge-in. */
  interrupt(): void;
  publishUi(event: UiEvent): void;
  now(): number;
}

/** Pre-rendered lines. Fixed text so a nudge costs no model call. */
export const NUDGE_LINES: Record<LadderStage, string | null> = {
  nudge: "Take your time.",
  offer: "Want to talk through your thinking out loud, or should we move to the next one?",
  advance: null, // handled by advancing, nothing spoken
};

export interface RunnerOptions {
  durationS: number;
  closingReserveS: number;
  ladder: LadderConfig;
}

export const DEFAULT_RUNNER_OPTIONS: RunnerOptions = {
  durationS: 900,
  closingReserveS: 120,
  ladder: DEFAULT_LADDER,
};

export class InterviewRunner {
  private machine: MachineState;
  private ladder: LadderState = IDLE_LADDER;
  private current: BrainQuestion | null = null;
  private pendingProbe: string | null = null;
  private asked: string[] = [];
  private startedAt: number | null = null;
  private questionNumber = 0;
  private closedReasons = new Map<string, CloseReason>();

  constructor(
    private readonly brain: InterviewBrain,
    private readonly io: VoiceIO,
    private readonly opts: RunnerOptions = DEFAULT_RUNNER_OPTIONS,
  ) {
    this.machine = initialState(io.now());
  }

  get phase() { return this.machine.phase; }
  get endReason(): EndReason | null { return this.machine.endReason; }
  get askedQuestionIds(): readonly string[] { return this.asked; }
  get closeReasonFor() { return (id: string) => this.closedReasons.get(id); }

  /** Seconds remaining before the closing reserve must begin. */
  private timeLeftS(): number {
    if (this.startedAt === null) return this.opts.durationS - this.opts.closingReserveS;
    const elapsed = (this.io.now() - this.startedAt) / 1000;
    return Math.max(0, this.opts.durationS - this.opts.closingReserveS - elapsed);
  }

  private elapsedS(): number {
    return this.startedAt === null ? 0 : Math.round((this.io.now() - this.startedAt) / 1000);
  }

  async dispatch(event: Event): Promise<void> {
    const { state, effects } = transition(this.machine, event);
    this.machine = state;
    for (const effect of effects) await this.apply(effect);
  }

  /** Called on connect. */
  async start(): Promise<void> {
    this.startedAt = this.io.now();
    await this.dispatch({ t: "CONNECTED", at: this.io.now() });
  }

  // ── inputs from the voice layer ────────────────────────────────────────
  async onCandidateSpeaking(): Promise<void> {
    // Any speech resets the ladder — including filler.
    this.ladder = onCandidateSpeaking();
  }

  async onCandidateSilent(): Promise<void> {
    if (this.machine.phase !== "LISTEN") return;
    this.ladder = onCandidateSilent(this.ladder, this.io.now());
  }

  async onUtteranceFinal(text: string): Promise<void> {
    await this.dispatch({ t: "UTTERANCE_FINAL", at: this.io.now(), text });
  }

  async requestEnd(): Promise<void> {
    await this.dispatch({ t: "END_REQUESTED", at: this.io.now() });
  }

  async onDisconnected(): Promise<void> {
    await this.dispatch({ t: "DISCONNECTED", at: this.io.now() });
  }

  /** Poll the ladder. The agent calls this on a short interval. */
  async tick(): Promise<void> {
    const now = this.io.now();
    if (this.machine.phase === "LISTEN") {
      const { state, fire } = pollLadder(this.ladder, now, this.opts.ladder);
      this.ladder = state;
      if (fire === "advance") {
        await this.dispatch({ t: "SILENCE_ADVANCE", at: now });
      } else if (fire) {
        this.io.publishUi({ t: "nudge", stage: fire });
        const line = NUDGE_LINES[fire];
        if (line) await this.io.speak(line);
      }
    }
    this.io.publishUi({
      t: "clock", elapsedS: this.elapsedS(),
      remainingS: Math.max(0, this.opts.durationS - this.elapsedS()),
    });
  }

  // ── effect execution ──────────────────────────────────────────────────
  private async apply(effect: Effect): Promise<void> {
    switch (effect.do) {
      case "publish_phase":
        this.io.publishUi({ t: "phase", phase: effect.phase, at: this.io.now() });
        return;

      case "speak_intro": {
        await this.io.speak(await this.brain.intro());
        await this.dispatch({ t: "INTRO_SPOKEN", at: this.io.now() });
        return;
      }

      case "select_next_question": {
        const next = await this.brain.selectNext({
          askedQuestionIds: [...this.asked],
          timeLeftS: this.timeLeftS(),
          elapsedS: this.elapsedS(),
        });
        if (!next) {
          await this.dispatch({ t: "NO_QUESTION_AVAILABLE", at: this.io.now() });
          return;
        }
        this.current = next;
        this.asked.push(next.questionId);
        this.questionNumber += 1;
        this.io.publishUi({
          t: "progress", questionNumber: this.questionNumber,
          plannedTotal: this.brain.plannedTotal,
        });
        await this.dispatch({
          t: "NEXT_SELECTED", at: this.io.now(), questionIndex: this.questionNumber - 1,
        });
        return;
      }

      case "speak_question": {
        if (!this.current) return;
        await this.io.speak(this.current.text);
        await this.dispatch({ t: "QUESTION_SPOKEN", at: this.io.now() });
        return;
      }

      case "start_silence_ladder":
        this.ladder = startLadder(this.io.now());
        return;

      case "cancel_silence_ladder":
        this.ladder = stopLadder();
        return;

      case "evaluate_utterance": {
        if (!this.current) return;
        const outcome = await this.brain.evaluate({
          questionId: this.current.questionId,
          candidateText: effect.text,
          probesUsed: this.machine.probesUsed,
          elapsedS: this.elapsedS(),
          timeLeftS: this.timeLeftS(),
        });
        this.pendingProbe = outcome.probe;
        await this.dispatch({
          t: "EVALUATED",
          at: this.io.now(),
          hasUnresolvedSignals: outcome.hasUnresolvedSignals,
          probesRemaining: outcome.probesRemaining,
          timeLeftS: this.timeLeftS(),
          minNextQuestionS: this.current.hardTimeS,
        });
        return;
      }

      case "speak_probe": {
        const line = this.pendingProbe;
        this.pendingProbe = null;
        if (line) await this.io.speak(line);
        await this.dispatch({ t: "PROBE_SPOKEN", at: this.io.now() });
        return;
      }

      case "close_question": {
        if (!this.current) return;
        this.closedReasons.set(this.current.questionId, effect.reason);
        await this.brain.onQuestionClosed(this.current.questionId, effect.reason);
        this.current = null;
        return;
      }

      case "speak_closing": {
        await this.io.speak(await this.brain.closing());
        await this.dispatch({ t: "CLOSING_SPOKEN", at: this.io.now() });
        return;
      }

      case "start_grading":
        // M3 owns grading. M2 completes immediately so teardown is exercised.
        await this.dispatch({ t: "GRADED", at: this.io.now() });
        return;

      case "teardown":
        this.ladder = stopLadder();
        this.io.publishUi({
          t: "ended", reason: effect.reason,
          reportPending: effect.reason === "completed" || effect.reason === "user_ended",
        });
        return;
    }
  }
}
