import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState, transition, type Effect, type Event, type MachineState } from "./interview-machine.js";

const dos = (e: Effect[]) => e.map((x) => x.do);

/** Drive a sequence and return the final state. */
function run(events: Event[], from: MachineState = initialState(0)) {
  let s = from;
  let last: Effect[] = [];
  for (const e of events) {
    const r = transition(s, e);
    s = r.state;
    last = r.effects;
  }
  return { state: s, effects: last };
}

const EVALUATED_COVERED: Event = {
  t: "EVALUATED", at: 5, hasUnresolvedSignals: false,
  probesRemaining: 3, timeLeftS: 600, minNextQuestionS: 120,
};

test("the happy path reaches COMPLETE", () => {
  const { state } = run([
    { t: "CONNECTED", at: 0 },
    { t: "INTRO_SPOKEN", at: 1 },
    { t: "NEXT_SELECTED", at: 2, questionIndex: 0 },
    { t: "QUESTION_SPOKEN", at: 3 },
    { t: "UTTERANCE_FINAL", at: 4, text: "an answer" },
    EVALUATED_COVERED,
    { t: "NO_QUESTION_AVAILABLE", at: 6 },
    { t: "CLOSING_SPOKEN", at: 7 },
    { t: "GRADED", at: 8 },
  ]);
  assert.equal(state.phase, "COMPLETE");
  assert.equal(state.endReason, "completed");
});

test("the silence ladder only starts once the question has finished playing", () => {
  const ask = run([
    { t: "CONNECTED", at: 0 },
    { t: "INTRO_SPOKEN", at: 1 },
    { t: "NEXT_SELECTED", at: 2, questionIndex: 0 },
  ]);
  assert.equal(ask.state.phase, "ASK");
  assert.ok(!dos(ask.effects).includes("start_silence_ladder"));

  const listen = transition(ask.state, { t: "QUESTION_SPOKEN", at: 3 });
  assert.equal(listen.state.phase, "LISTEN");
  assert.ok(dos(listen.effects).includes("start_silence_ladder"));
});

test("unresolved signals with probes and time left produce a probe", () => {
  const { state, effects } = run([
    { t: "CONNECTED", at: 0 }, { t: "INTRO_SPOKEN", at: 1 },
    { t: "NEXT_SELECTED", at: 2, questionIndex: 0 }, { t: "QUESTION_SPOKEN", at: 3 },
    { t: "UTTERANCE_FINAL", at: 4, text: "thin answer" },
    { t: "EVALUATED", at: 5, hasUnresolvedSignals: true, probesRemaining: 2, timeLeftS: 600, minNextQuestionS: 120 },
  ]);
  assert.equal(state.phase, "PROBE");
  assert.equal(state.probesUsed, 1);
  assert.ok(dos(effects).includes("speak_probe"));
});

test("probes exhausted closes the question rather than probing again", () => {
  const { state, effects } = run([
    { t: "CONNECTED", at: 0 }, { t: "INTRO_SPOKEN", at: 1 },
    { t: "NEXT_SELECTED", at: 2, questionIndex: 0 }, { t: "QUESTION_SPOKEN", at: 3 },
    { t: "UTTERANCE_FINAL", at: 4, text: "still thin" },
    { t: "EVALUATED", at: 5, hasUnresolvedSignals: true, probesRemaining: 0, timeLeftS: 600, minNextQuestionS: 120 },
  ]);
  assert.equal(state.phase, "SELECT_NEXT");
  assert.deepEqual(
    effects.find((e) => e.do === "close_question"),
    { do: "close_question", reason: "probes_exhausted" },
  );
});

test("no time for another question closes with reason time, not probes", () => {
  const { effects } = run([
    { t: "CONNECTED", at: 0 }, { t: "INTRO_SPOKEN", at: 1 },
    { t: "NEXT_SELECTED", at: 2, questionIndex: 0 }, { t: "QUESTION_SPOKEN", at: 3 },
    { t: "UTTERANCE_FINAL", at: 4, text: "partial" },
    { t: "EVALUATED", at: 5, hasUnresolvedSignals: true, probesRemaining: 2, timeLeftS: 60, minNextQuestionS: 120 },
  ]);
  assert.deepEqual(
    effects.find((e) => e.do === "close_question"),
    { do: "close_question", reason: "time" },
  );
});

test("silence advance closes the question as candidate_stuck", () => {
  const { state, effects } = run([
    { t: "CONNECTED", at: 0 }, { t: "INTRO_SPOKEN", at: 1 },
    { t: "NEXT_SELECTED", at: 2, questionIndex: 0 }, { t: "QUESTION_SPOKEN", at: 3 },
    { t: "SILENCE_ADVANCE", at: 30 },
  ]);
  assert.equal(state.phase, "SELECT_NEXT");
  assert.deepEqual(
    effects.find((e) => e.do === "close_question"),
    { do: "close_question", reason: "candidate_stuck" },
  );
  assert.ok(dos(effects).includes("cancel_silence_ladder"));
});

test("a probe returns to LISTEN and restarts the ladder", () => {
  const probing = run([
    { t: "CONNECTED", at: 0 }, { t: "INTRO_SPOKEN", at: 1 },
    { t: "NEXT_SELECTED", at: 2, questionIndex: 0 }, { t: "QUESTION_SPOKEN", at: 3 },
    { t: "UTTERANCE_FINAL", at: 4, text: "thin" },
    { t: "EVALUATED", at: 5, hasUnresolvedSignals: true, probesRemaining: 2, timeLeftS: 600, minNextQuestionS: 120 },
  ]);
  const back = transition(probing.state, { t: "PROBE_SPOKEN", at: 6 });
  assert.equal(back.state.phase, "LISTEN");
  assert.ok(dos(back.effects).includes("start_silence_ladder"));
});

test("selecting the next question resets the probe counter", () => {
  const probed = run([
    { t: "CONNECTED", at: 0 }, { t: "INTRO_SPOKEN", at: 1 },
    { t: "NEXT_SELECTED", at: 2, questionIndex: 0 }, { t: "QUESTION_SPOKEN", at: 3 },
    { t: "UTTERANCE_FINAL", at: 4, text: "thin" },
    { t: "EVALUATED", at: 5, hasUnresolvedSignals: true, probesRemaining: 2, timeLeftS: 600, minNextQuestionS: 120 },
    { t: "PROBE_SPOKEN", at: 6 },
    { t: "UTTERANCE_FINAL", at: 7, text: "better" },
    EVALUATED_COVERED,
  ]);
  assert.equal(probed.state.probesUsed, 1);
  const next = transition(probed.state, { t: "NEXT_SELECTED", at: 9, questionIndex: 1 });
  assert.equal(next.state.probesUsed, 0);
  assert.equal(next.state.questionIndex, 1);
});

test("End Interview goes to CLOSING so the interview is still graded", () => {
  const listening = run([
    { t: "CONNECTED", at: 0 }, { t: "INTRO_SPOKEN", at: 1 },
    { t: "NEXT_SELECTED", at: 2, questionIndex: 0 }, { t: "QUESTION_SPOKEN", at: 3 },
  ]);
  const ended = transition(listening.state, { t: "END_REQUESTED", at: 10 });
  assert.equal(ended.state.phase, "CLOSING");
  assert.equal(ended.state.endReason, "user_ended");
  assert.ok(dos(ended.effects).includes("speak_closing"));
  assert.deepEqual(
    ended.effects.find((e) => e.do === "close_question"),
    { do: "close_question", reason: "interview_ended" },
  );
});

test("disconnect abandons and tears down from any phase", () => {
  const listening = run([
    { t: "CONNECTED", at: 0 }, { t: "INTRO_SPOKEN", at: 1 },
    { t: "NEXT_SELECTED", at: 2, questionIndex: 0 }, { t: "QUESTION_SPOKEN", at: 3 },
  ]);
  const gone = transition(listening.state, { t: "DISCONNECTED", at: 11 });
  assert.equal(gone.state.phase, "ABANDONED");
  assert.equal(gone.state.endReason, "disconnected");
  assert.ok(dos(gone.effects).includes("teardown"));
});

test("a failed grading pass still completes the interview", () => {
  const grading = run([
    { t: "CONNECTED", at: 0 }, { t: "INTRO_SPOKEN", at: 1 },
    { t: "NO_QUESTION_AVAILABLE", at: 2 }, { t: "CLOSING_SPOKEN", at: 3 },
  ]);
  assert.equal(grading.state.phase, "GRADING");
  const done = transition(grading.state, { t: "GRADING_FAILED", at: 4 });
  assert.equal(done.state.phase, "COMPLETE");
});

test("terminal phases absorb late events", () => {
  const { state } = run([
    { t: "CONNECTED", at: 0 }, { t: "INTRO_SPOKEN", at: 1 },
    { t: "NO_QUESTION_AVAILABLE", at: 2 }, { t: "CLOSING_SPOKEN", at: 3 },
    { t: "GRADED", at: 4 },
    { t: "UTTERANCE_FINAL", at: 5, text: "hello?" },
    { t: "DISCONNECTED", at: 6 },
  ]);
  assert.equal(state.phase, "COMPLETE");
  assert.equal(state.endReason, "completed");
});
