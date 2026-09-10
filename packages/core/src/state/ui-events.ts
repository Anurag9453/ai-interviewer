/**
 * Contract for the LiveKit data channel: agent -> browser live UI state.
 *
 * The browser never polls. Everything it renders during an interview arrives
 * on this channel.
 */
import type { Phase } from "./interview-machine.js";
import type { LadderStage } from "./silence-ladder.js";

/** The four states the interview screen distinguishes, plus connecting. */
export type UiState =
  | "connecting"
  | "ai_speaking"
  | "listening"
  | "processing";

/** LiveKit's own session states, which we map from. */
export type LkAgentState = "initializing" | "idle" | "listening" | "thinking" | "speaking";
export type LkUserState = "speaking" | "listening" | "away";

/**
 * Map LiveKit's (agent, user) state pair onto our UI state.
 *
 * LiveKit has no separate "responding" state — the thinking -> speaking edge
 * IS that moment, so the browser animates the transition rather than being
 * told about a fifth state.
 */
export function deriveUiState(agent: LkAgentState, user: LkUserState): UiState {
  if (agent === "initializing") return "connecting";
  if (agent === "speaking") return "ai_speaking";
  if (agent === "thinking") return "processing";
  // Agent is listening or idle. Whether the candidate is mid-sentence or
  // silent is both "listening" to the screen; the mic ring animates off the
  // separate `candidateSpeaking` flag rather than a fifth UI state.
  void user;
  return "listening";
}

/** Whether the mic ring should show active speech. */
export function candidateSpeaking(user: LkUserState): boolean {
  return user === "speaking";
}

export type UiEvent =
  | { t: "ui_state"; state: UiState; at: number }
  | { t: "phase"; phase: Phase; at: number }
  | { t: "clock"; elapsedS: number; remainingS: number }
  | { t: "progress"; questionNumber: number; plannedTotal: number }
  | { t: "transcript"; text: string; final: boolean }
  | { t: "nudge"; stage: LadderStage }
  | { t: "connection"; quality: "good" | "degraded" | "lost" }
  | { t: "ended"; reason: string; reportPending: boolean };

export const UI_TOPIC = "interview-ui";

export function encodeUiEvent(e: UiEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(e));
}

export function decodeUiEvent(bytes: Uint8Array): UiEvent | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed === "object" && parsed !== null && "t" in parsed) {
      return parsed as UiEvent;
    }
    return null;
  } catch {
    // Malformed payload from the wire is data, never a crash.
    return null;
  }
}

/**
 * The reverse channel: browser -> agent. Deliberately tiny — the candidate
 * has exactly one thing to tell the agent that isn't already implied by
 * audio or by disconnecting: "end the interview now". Everything else
 * (navigation, questions, answers) flows through voice or through
 * disconnecting the room, never through this topic.
 */
export type ControlEvent = { t: "end_interview" };

export const CONTROL_TOPIC = "interview-control";

export function encodeControlEvent(e: ControlEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(e));
}

export function decodeControlEvent(bytes: Uint8Array): ControlEvent | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed === "object" && parsed !== null && "t" in parsed && (parsed as { t: unknown }).t === "end_interview") {
      return parsed as ControlEvent;
    }
    return null;
  } catch {
    return null;
  }
}
