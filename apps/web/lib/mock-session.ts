/**
 * In-browser interview simulator.
 *
 * Runs the REAL InterviewRunner, state machine, silence ladder, and
 * ScriptedBrain against a mock voice layer, emitting the same UiEvents the
 * agent would publish over the data channel. It exists so the interview
 * screen, its four states, the clock, and the nudge ladder can be verified
 * end to end without LiveKit, STT, TTS, or a model.
 *
 * This is explicitly a mock: no audio is produced and no model is called.
 */
import {
  DEFAULT_LADDER, InterviewRunner, ScriptedBrain,
  type UiEvent, type VoiceIO,
} from "@ai/core/browser";

export interface MockController {
  /** Simulate the candidate finishing an answer. */
  answer(text: string): Promise<void>;
  /** Simulate VAD detecting speech (resets the silence ladder). */
  speaking(): Promise<void>;
  silent(): Promise<void>;
  end(): Promise<void>;
  disconnect(): Promise<void>;
  stop(): void;
  /** What the interviewer "said", in order. */
  readonly spoken: readonly string[];
}

export function startMockSession(
  onEvent: (e: UiEvent) => void,
  opts: { speakMsPerWord?: number } = {},
): MockController {
  const speakMsPerWord = opts.speakMsPerWord ?? 45;
  const spoken: string[] = [];
  let speakingNow = false;

  const io: VoiceIO = {
    now: () => Date.now(),
    async speak(text: string) {
      spoken.push(text);
      speakingNow = true;
      onEvent({ t: "ui_state", state: "ai_speaking", at: Date.now() });
      onEvent({ t: "transcript", text, final: true });
      // Approximate real playback duration so the ladder timing is realistic.
      await new Promise((r) => setTimeout(r, text.split(/\s+/).length * speakMsPerWord));
      speakingNow = false;
      onEvent({ t: "ui_state", state: "listening", at: Date.now() });
    },
    interrupt() {
      speakingNow = false;
      onEvent({ t: "ui_state", state: "listening", at: Date.now() });
    },
    publishUi: onEvent,
  };

  const runner = new InterviewRunner(new ScriptedBrain(), io, {
    durationS: 900, closingReserveS: 120, ladder: DEFAULT_LADDER,
  });

  const interval = setInterval(() => { void runner.tick(); }, 250);
  onEvent({ t: "connection", quality: "good" });
  void runner.start();

  return {
    spoken,
    async answer(text) {
      onEvent({ t: "ui_state", state: "processing", at: Date.now() });
      onEvent({ t: "transcript", text, final: true });
      await runner.onUtteranceFinal(text);
    },
    async speaking() {
      if (speakingNow) io.interrupt(); // barge-in
      await runner.onCandidateSpeaking();
    },
    async silent() { await runner.onCandidateSilent(); },
    async end() { await runner.requestEnd(); clearInterval(interval); },
    async disconnect() { await runner.onDisconnected(); clearInterval(interval); },
    stop() { clearInterval(interval); },
  };
}
