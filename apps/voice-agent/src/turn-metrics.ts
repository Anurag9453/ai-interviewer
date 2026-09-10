/**
 * Per-turn latency instrumentation.
 *
 * Two sources feed this: LiveKit's own `metrics_collected` event (STT, TTS,
 * EOU, interruption — all measured natively by the framework) and our own
 * timestamps around the Claude call, which AgentSession never sees because
 * it's called directly through packages/core's provider seam, not through
 * AgentSession's llm slot.
 *
 * Structured, one line per event, so a single turn can be reconstructed from
 * logs by matching timestamps — this is the "enough to inspect one complete
 * turn" requirement, not a metrics backend.
 */
import type { AgentMetrics } from "@livekit/agents";

export interface TurnLog {
  interviewId: string;
  event: string;
  [key: string]: unknown;
}

export function logTurnEvent(entry: TurnLog): void {
  // One JSON line. Deliberately not a logging library dependency for M2-B —
  // structured stdout is enough to grep a turn out of the agent's logs.
  console.log(JSON.stringify({ ts: Date.now(), ...entry }));
}

/**
 * Bridges LiveKit's native metrics into the same structured log stream.
 * Covers: end-of-utterance delay, STT latency, TTS time-to-first-byte,
 * interruption detection latency — all measured by the framework itself.
 */
export function logLiveKitMetrics(interviewId: string, m: AgentMetrics): void {
  switch (m.type) {
    case "eou_metrics":
      logTurnEvent({
        interviewId, event: "eou",
        endOfUtteranceDelayMs: m.endOfUtteranceDelayMs,
        transcriptionDelayMs: m.transcriptionDelayMs,
        onUserTurnCompletedDelayMs: m.onUserTurnCompletedDelayMs,
      });
      return;
    case "stt_metrics":
      logTurnEvent({
        interviewId, event: "stt", requestId: m.requestId,
        durationMs: m.durationMs, audioDurationMs: m.audioDurationMs,
      });
      return;
    case "tts_metrics":
      logTurnEvent({
        interviewId, event: "tts", requestId: m.requestId,
        ttfbMs: m.ttfbMs, durationMs: m.durationMs, cancelled: m.cancelled,
      });
      return;
    case "interruption_metrics":
      logTurnEvent({
        interviewId, event: "interruption",
        detectionDelayMs: m.detectionDelay, totalDurationMs: m.totalDuration,
        numInterruptions: m.numInterruptions,
      });
      return;
    case "vad_metrics":
      // High-frequency, low-signal for a single-turn trace — omitted.
      return;
    default:
      logTurnEvent({ interviewId, event: m.type });
  }
}

/**
 * Tracks the one leg LiveKit doesn't see: end-of-user-speech -> Claude's
 * first output -> Claude finished. Call `markUtteranceEnd()` when the
 * candidate's final transcript arrives, then `markClaudeDone()` after the
 * evaluate() call resolves.
 */
export class TurnTimer {
  private utteranceEndAt: number | null = null;

  constructor(private readonly interviewId: string) {}

  markUtteranceEnd(): void {
    this.utteranceEndAt = Date.now();
  }

  markClaudeDone(outcome: { hadProbe: boolean }): void {
    if (this.utteranceEndAt === null) return;
    const claudeLatencyMs = Date.now() - this.utteranceEndAt;
    logTurnEvent({
      interviewId: this.interviewId, event: "claude_eval",
      // "end-of-user-speech -> LLM output" — since evaluate() is a single
      // blocking call rather than a stream, first-token and full-response
      // latency are the same number in M2-B. Streaming evaluation is M3
      // territory (the LiveSession abstraction already supports it).
      endOfSpeechToLlmOutputMs: claudeLatencyMs,
      hadProbe: outcome.hadProbe,
    });
    this.utteranceEndAt = null;
  }
}
