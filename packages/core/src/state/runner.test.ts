import { test } from "node:test";
import assert from "node:assert/strict";
import { InterviewRunner, type RunnerOptions, type VoiceIO } from "./runner.js";
import { ScriptedBrain } from "./scripted-brain.js";
import { DEFAULT_LADDER } from "./silence-ladder.js";
import type { UiEvent } from "./ui-events.js";

/** Mock voice layer with a controllable clock. No audio, no network, no model. */
class MockIO implements VoiceIO {
  t = 0;
  spoken: string[] = [];
  ui: UiEvent[] = [];
  interrupted = 0;
  /** Wall time each utterance consumes. */
  speakMs = 1_000;

  now() { return this.t; }
  async speak(text: string) { this.spoken.push(text); this.t += this.speakMs; }
  interrupt() { this.interrupted += 1; }
  publishUi(e: UiEvent) { this.ui.push(e); }
  advance(ms: number) { this.t += ms; }

  phases() { return this.ui.filter((e) => e.t === "phase").map((e) => (e as { phase: string }).phase); }
  nudges() { return this.ui.filter((e) => e.t === "nudge").map((e) => (e as { stage: string }).stage); }
}

const OPTS: RunnerOptions = { durationS: 900, closingReserveS: 120, ladder: DEFAULT_LADDER };
const GOOD_ANSWER =
  "There is probably a query inside a loop, so I would collect the ids first and query once into a map keyed on id.";

function harness(opts: RunnerOptions = OPTS) {
  const io = new MockIO();
  const brain = new ScriptedBrain();
  return { io, brain, runner: new InterviewRunner(brain, io, opts) };
}

test("a full three-question interview reaches COMPLETE", async () => {
  const { io, brain, runner } = harness();
  await runner.start();
  for (let i = 0; i < 3; i++) {
    await runner.onUtteranceFinal(GOOD_ANSWER);
  }
  assert.equal(runner.phase, "COMPLETE");
  assert.equal(runner.endReason, "completed");
  assert.equal(runner.askedQuestionIds.length, 3);
  assert.equal(brain.closedQuestions.length, 3);
  assert.ok(brain.closedQuestions.every((c) => c.reason === "covered"));
});

test("the intro, all three questions, and the closing are spoken in order", async () => {
  const { io, runner } = harness();
  await runner.start();
  for (let i = 0; i < 3; i++) await runner.onUtteranceFinal(GOOD_ANSWER);
  assert.equal(io.spoken.length, 5, "intro + 3 questions + closing");
  assert.match(io.spoken[0]!, /Thanks for making the time/);
  assert.match(io.spoken[1]!, /passes every test in your sandbox/);
  assert.match(io.spoken[4]!, /That's all my questions/);
});

test("phases follow the specified machine order", async () => {
  const { io, runner } = harness();
  await runner.start();
  await runner.onUtteranceFinal(GOOD_ANSWER);
  const phases = io.phases();
  assert.deepEqual(phases.slice(0, 6), [
    "INTRO", "SELECT_NEXT", "ASK", "LISTEN", "EVALUATE", "SELECT_NEXT",
  ]);
});

test("a too-short answer produces exactly one probe, then moves on", async () => {
  const { io, runner } = harness();
  await runner.start();
  await runner.onUtteranceFinal("Bulkification.");
  assert.equal(runner.phase, "LISTEN", "still on the same question, awaiting the probe answer");
  assert.ok(io.spoken.includes("Can you take that a level deeper?"));

  await runner.onUtteranceFinal("Bulkify it.");
  // Probe budget spent, so the question closes rather than probing again.
  assert.equal(io.spoken.filter((s) => s === "Can you take that a level deeper?").length, 1);
});

// ── silence ladder through the real runner ────────────────────────────────
test("the ladder nudges at 8s, offers at 15s, and advances at 25s", async () => {
  const { io, brain, runner } = harness();
  await runner.start();
  assert.equal(runner.phase, "LISTEN");

  io.advance(8_000);
  await runner.tick();
  assert.deepEqual(io.nudges(), ["nudge"]);
  assert.ok(io.spoken.includes("Take your time."));

  io.advance(7_000 - io.speakMs); // account for the nudge's own playback
  await runner.tick();
  assert.deepEqual(io.nudges(), ["nudge", "offer"]);
  assert.ok(io.spoken.some((s) => /think.*out loud|move to the next/i.test(s)));

  io.advance(20_000);
  await runner.tick();
  // Advance is not spoken — it closes the question and selects the next.
  assert.equal(brain.closedQuestions[0]?.reason, "candidate_stuck");
  assert.equal(runner.askedQuestionIds.length, 2, "moved on to the second question");
});

test("candidate speech prevents any nudge from firing", async () => {
  const { io, runner } = harness();
  await runner.start();
  // Speaks briefly every 5s for 40s.
  for (let i = 0; i < 8; i++) {
    io.advance(5_000);
    await runner.onCandidateSpeaking();
    await runner.onCandidateSilent();
    await runner.tick();
  }
  assert.deepEqual(io.nudges(), [], "a candidate who keeps talking is never nudged");
  assert.equal(runner.phase, "LISTEN");
});

test("the ladder does not run outside LISTEN", async () => {
  const { io, runner } = harness();
  await runner.start();
  await runner.onUtteranceFinal(GOOD_ANSWER);
  await runner.onUtteranceFinal(GOOD_ANSWER);
  await runner.onUtteranceFinal(GOOD_ANSWER);
  assert.equal(runner.phase, "COMPLETE");
  const before = io.nudges().length;
  io.advance(60_000);
  await runner.tick();
  assert.equal(io.nudges().length, before, "no nudges after the interview ended");
});

// ── teardown paths ────────────────────────────────────────────────────────
test("End Interview closes the open question and still completes", async () => {
  const { io, brain, runner } = harness();
  await runner.start();
  await runner.requestEnd();
  assert.equal(runner.phase, "COMPLETE");
  assert.equal(runner.endReason, "user_ended");
  assert.equal(brain.closedQuestions[0]?.reason, "interview_ended");
  const ended = io.ui.find((e) => e.t === "ended");
  assert.deepEqual(ended, { t: "ended", reason: "user_ended", reportPending: true });
});

test("a disconnect abandons the session and marks the report not pending", async () => {
  const { io, runner } = harness();
  await runner.start();
  await runner.onDisconnected();
  assert.equal(runner.phase, "ABANDONED");
  assert.equal(runner.endReason, "disconnected");
  const ended = io.ui.find((e) => e.t === "ended");
  assert.deepEqual(ended, { t: "ended", reason: "disconnected", reportPending: false });
});

test("running out of clock closes the interview instead of asking again", async () => {
  // 200s total leaves 80s usable, under the 180s each question needs.
  const { runner } = harness({ durationS: 200, closingReserveS: 120, ladder: DEFAULT_LADDER });
  await runner.start();
  assert.equal(runner.phase, "COMPLETE");
  assert.equal(runner.askedQuestionIds.length, 0, "no question fits, so it closes cleanly");
});

test("clock and progress events reach the UI channel", async () => {
  const { io, runner } = harness();
  await runner.start();
  io.advance(30_000);
  await runner.tick();
  const clock = io.ui.filter((e) => e.t === "clock").at(-1) as { elapsedS: number; remainingS: number };
  assert.ok(clock.elapsedS >= 30);
  assert.equal(clock.elapsedS + clock.remainingS, 900);
  assert.deepEqual(
    io.ui.find((e) => e.t === "progress"),
    { t: "progress", questionNumber: 1, plannedTotal: 3 },
  );
});
