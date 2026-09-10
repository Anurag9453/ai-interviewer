/**
 * Silence ladder: 8s nudge -> 15s think-or-move offer -> 25s advance.
 *
 * Pure functions over an explicit `now`, so the whole ladder is testable
 * without real timers. The agent polls it on an interval.
 *
 * The ladder measures CONTINUOUS candidate silence. Any VAD-detected speech
 * resets it completely — including filler like "umm" and "so, like" — because
 * cutting someone off mid-thought is the single most complained-about
 * behaviour in an AI interviewer.
 */

export type LadderStage = "nudge" | "offer" | "advance";

export interface LadderConfig {
  nudgeMs: number;
  offerMs: number;
  advanceMs: number;
}

export const DEFAULT_LADDER: LadderConfig = {
  nudgeMs: 8_000,
  offerMs: 15_000,
  advanceMs: 25_000,
};

export interface LadderState {
  /** Timestamp silence began, or null when not counting. */
  silentSince: number | null;
  /** Stages already delivered, so each fires at most once per silence. */
  fired: LadderStage[];
}

export const IDLE_LADDER: LadderState = { silentSince: null, fired: [] };

/** Begin counting. Called when the agent finishes speaking. */
export function startLadder(now: number): LadderState {
  return { silentSince: now, fired: [] };
}

/** Stop counting entirely, e.g. the question closed. */
export function stopLadder(): LadderState {
  return IDLE_LADDER;
}

/**
 * VAD reported the candidate speaking. Resets everything: they are engaged,
 * and any stage already fired should be able to fire again on the next
 * genuine silence.
 */
export function onCandidateSpeaking(): LadderState {
  return IDLE_LADDER;
}

/** VAD reported the candidate stopped. Resume counting from now. */
export function onCandidateSilent(state: LadderState, now: number): LadderState {
  if (state.silentSince !== null) return state;
  return { silentSince: now, fired: [] };
}

export interface PollResult {
  state: LadderState;
  /** Stage crossed on this poll, or null. */
  fire: LadderStage | null;
}

/** Advance the ladder to `now`, returning at most one newly crossed stage. */
export function pollLadder(
  state: LadderState,
  now: number,
  config: LadderConfig = DEFAULT_LADDER,
): PollResult {
  if (state.silentSince === null) return { state, fire: null };

  const elapsed = now - state.silentSince;
  // Highest crossed threshold first: if a poll is late and skips a stage, go
  // straight to the correct one rather than replaying the ladder.
  const ordered: Array<[LadderStage, number]> = [
    ["advance", config.advanceMs],
    ["offer", config.offerMs],
    ["nudge", config.nudgeMs],
  ];

  for (const [stage, threshold] of ordered) {
    if (elapsed >= threshold && !state.fired.includes(stage)) {
      // Mark every stage at or below this one as fired, so a skipped stage
      // does not fire retroactively on the next poll.
      const superseded = ordered
        .filter(([, t]) => t <= threshold)
        .map(([s]) => s);
      return {
        state: { ...state, fired: [...new Set([...state.fired, ...superseded])] },
        fire: stage,
      };
    }
  }
  return { state, fire: null };
}

/** Milliseconds of continuous silence so far, for diagnostics and UI. */
export function silentForMs(state: LadderState, now: number): number {
  return state.silentSince === null ? 0 : now - state.silentSince;
}
