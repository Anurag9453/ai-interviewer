import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LADDER, IDLE_LADDER, onCandidateSilent, onCandidateSpeaking,
  pollLadder, silentForMs, startLadder, stopLadder, type LadderStage,
} from "./silence-ladder.js";

/** Poll from t0 to t0+durationMs at 250ms, collecting fired stages. */
function sweep(fromMs: number, durationMs: number, speakAt: number[] = []) {
  let state = startLadder(fromMs);
  const fired: Array<{ at: number; stage: LadderStage }> = [];
  for (let t = fromMs; t <= fromMs + durationMs; t += 250) {
    if (speakAt.includes(t)) {
      state = onCandidateSpeaking();
      continue;
    }
    if (state.silentSince === null) state = onCandidateSilent(state, t);
    const r = pollLadder(state, t, DEFAULT_LADDER);
    state = r.state;
    if (r.fire) fired.push({ at: t - fromMs, stage: r.fire });
  }
  return { state, fired };
}

test("fires nudge, offer, then advance at 8s, 15s and 25s", () => {
  const { fired } = sweep(0, 26_000);
  assert.deepEqual(fired.map((f) => f.stage), ["nudge", "offer", "advance"]);
  assert.equal(fired[0]!.at, 8_000);
  assert.equal(fired[1]!.at, 15_000);
  assert.equal(fired[2]!.at, 25_000);
});

test("each stage fires at most once", () => {
  const { fired } = sweep(0, 40_000);
  assert.equal(fired.filter((f) => f.stage === "nudge").length, 1);
  assert.equal(fired.filter((f) => f.stage === "advance").length, 1);
});

// The requirement that matters most: never interrupt someone who is talking.
test("candidate speech resets the ladder completely", () => {
  let state = startLadder(0);
  ({ state } = pollLadder(state, 7_000));           // 7s silent, nothing fired
  state = onCandidateSpeaking();
  assert.deepEqual(state, IDLE_LADDER);

  state = onCandidateSilent(state, 10_000);
  const r = pollLadder(state, 17_000, DEFAULT_LADDER); // 7s since restart
  assert.equal(r.fire, null, "must not fire 7s after speech restarted the clock");
});

test("nothing fires while the candidate keeps talking through the window", () => {
  // Speaks briefly every 5s across 40s: no stage should ever be reached.
  const speakAt = [5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000];
  const { fired } = sweep(0, 40_000, speakAt);
  assert.deepEqual(fired, [], "a candidate speaking every 5s must never be nudged");
});

test("filler speech after a nudge still resets, so offer does not fire early", () => {
  let state = startLadder(0);
  const nudge = pollLadder(state, 8_000, DEFAULT_LADDER);
  state = nudge.state;
  assert.equal(nudge.fire, "nudge");

  // "umm, so..." at 9s — VAD reports speech.
  state = onCandidateSpeaking();
  state = onCandidateSilent(state, 9_500);

  const atOriginal15s = pollLadder(state, 15_000, DEFAULT_LADDER);
  assert.equal(atOriginal15s.fire, null, "offer must not fire on the original clock");

  // And the nudge is eligible again on this fresh silence.
  const fresh = pollLadder(state, 17_600, DEFAULT_LADDER);
  assert.equal(fresh.fire, "nudge");
});

test("a late poll jumps to the correct stage without replaying earlier ones", () => {
  // Agent was busy; first poll lands at 26s.
  const state = startLadder(0);
  const r = pollLadder(state, 26_000, DEFAULT_LADDER);
  assert.equal(r.fire, "advance", "should advance, not deliver a stale nudge");
  // Superseded stages are marked so they cannot fire retroactively.
  const next = pollLadder(r.state, 26_250, DEFAULT_LADDER);
  assert.equal(next.fire, null);
});

test("a stopped ladder never fires", () => {
  const state = stopLadder();
  assert.equal(pollLadder(state, 999_999, DEFAULT_LADDER).fire, null);
});

test("silentForMs reports zero when not counting", () => {
  assert.equal(silentForMs(IDLE_LADDER, 5_000), 0);
  assert.equal(silentForMs(startLadder(1_000), 5_000), 4_000);
});

test("onCandidateSilent does not restart an already-running clock", () => {
  const started = startLadder(1_000);
  const again = onCandidateSilent(started, 5_000);
  assert.equal(again.silentSince, 1_000, "must not extend the deadline");
});
