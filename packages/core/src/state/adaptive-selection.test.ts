import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adaptDifficulty, eligibleQuestions, initialSelectionState,
  pickNextQuestion, recordQuestionOutcome, type SelectableQuestion, type TopicPrereqInfo,
} from "./adaptive-selection.js";

const Q = (id: string, topicId: string, band: "beginner" | "intermediate" | "advanced", hardTimeS = 180): SelectableQuestion => ({
  id, topicId, difficultyBand: band, hardTimeS,
});

const TOPICS: TopicPrereqInfo[] = [
  { id: "governor_limits", prereqs: [] },
  { id: "bulkification", prereqs: ["governor_limits"] },
  { id: "async_apex", prereqs: ["governor_limits"] },
];

// ── difficulty adaptation ──────────────────────────────────────────────────

test("difficulty steps up after two consecutive strong closes", () => {
  let d = adaptDifficulty("intermediate", []);
  assert.equal(d, "intermediate", "no history yet — stays put");
  d = adaptDifficulty("intermediate", [0.9]);
  assert.equal(d, "intermediate", "only one data point — window not full yet");
  d = adaptDifficulty("intermediate", [0.9, 0.85]);
  assert.equal(d, "advanced");
});

test("difficulty steps down after two consecutive weak closes", () => {
  const d = adaptDifficulty("intermediate", [0.2, 0.3]);
  assert.equal(d, "beginner");
});

test("difficulty does not move on mixed or middling performance", () => {
  assert.equal(adaptDifficulty("intermediate", [0.9, 0.2]), "intermediate");
  assert.equal(adaptDifficulty("intermediate", [0.6, 0.55]), "intermediate");
});

test("difficulty clamps at the top and bottom band", () => {
  assert.equal(adaptDifficulty("advanced", [0.9, 0.95]), "advanced");
  assert.equal(adaptDifficulty("beginner", [0.1, 0.15]), "beginner");
});

test("only the most recent two closes count — an old streak does not linger", () => {
  const state = [0.9, 0.9, 0.2, 0.3]; // strong then weak
  assert.equal(adaptDifficulty("intermediate", state), "beginner");
});

// ── coverage-based selection ────────────────────────────────────────────────

test("an uncovered topic is preferred over a covered one at equal difficulty match", () => {
  const pool = [Q("a", "governor_limits", "intermediate"), Q("b", "bulkification", "intermediate")];
  let state = initialSelectionState("intermediate");
  state = { ...state, coveredTopics: new Set(["governor_limits"]) };
  const picked = pickNextQuestion(pool, TOPICS, state, 900);
  assert.equal(picked?.topicId, "bulkification");
});

// ── prerequisite constraints ─────────────────────────────────────────────

test("a question is excluded while its prerequisite topic is uncovered", () => {
  const pool = [Q("a", "bulkification", "intermediate")];
  const state = initialSelectionState("intermediate");
  const eligible = eligibleQuestions(pool, TOPICS, state, 900);
  assert.deepEqual(eligible, [], "governor_limits has not been covered yet");
});

test("a question becomes eligible once its prerequisite topic is covered", () => {
  const pool = [Q("a", "bulkification", "intermediate")];
  let state = initialSelectionState("intermediate");
  state = { ...state, coveredTopics: new Set(["governor_limits"]) };
  const eligible = eligibleQuestions(pool, TOPICS, state, 900);
  assert.equal(eligible.length, 1);
});

test("prereqs are a hard constraint — never relaxed, even if it empties the pool", () => {
  // Only prereq-locked questions remain. Unlike seen-avoidance, there is no
  // fallback here: violating topic ordering is worse than ending a question
  // early — pickNextQuestion correctly returns null in this case.
  const pool = [Q("a", "bulkification", "intermediate"), Q("b", "async_apex", "intermediate")];
  const state = initialSelectionState("intermediate");
  const eligible = eligibleQuestions(pool, TOPICS, state, 900);
  assert.deepEqual(eligible, []);
  assert.equal(pickNextQuestion(pool, TOPICS, state, 900), null);
});

test("once the prerequisite is covered, previously-locked questions become eligible together", () => {
  const pool = [Q("a", "bulkification", "intermediate"), Q("b", "async_apex", "intermediate")];
  let state = initialSelectionState("intermediate");
  state = { ...state, coveredTopics: new Set(["governor_limits"]) };
  const eligible = eligibleQuestions(pool, TOPICS, state, 900);
  assert.equal(eligible.length, 2);
});

// ── unseen-question / seen-question avoidance ─────────────────────────────

test("a question seen in a prior session is deprioritised, not necessarily excluded", () => {
  const pool = [Q("a", "governor_limits", "intermediate"), Q("b", "governor_limits", "intermediate")];
  let state = initialSelectionState("intermediate");
  state = { ...state, seenIds: new Set(["a"]) };
  const picked = pickNextQuestion(pool, TOPICS, state, 900);
  assert.equal(picked?.id, "b", "prefers the genuinely-new question");
});

test("seen-avoidance falls back to seen questions rather than ending early", () => {
  const pool = [Q("a", "governor_limits", "intermediate")];
  let state = initialSelectionState("intermediate");
  state = { ...state, seenIds: new Set(["a"]) };
  const eligible = eligibleQuestions(pool, TOPICS, state, 900);
  assert.equal(eligible.length, 1, "only option left is a previously-seen question — still offered");
});

test("a question already asked THIS session is always excluded, no fallback", () => {
  const pool = [Q("a", "governor_limits", "intermediate")];
  let state = initialSelectionState("intermediate");
  state = { ...state, askedIds: new Set(["a"]) };
  const eligible = eligibleQuestions(pool, TOPICS, state, 900);
  assert.deepEqual(eligible, [], "this-session dedup has no fallback — asking twice would be a real bug");
});

// ── time-aware selection ──────────────────────────────────────────────────

test("a question that does not fit the remaining time is excluded, with no fallback", () => {
  const pool = [Q("a", "governor_limits", "intermediate", 300)];
  const state = initialSelectionState("intermediate");
  assert.deepEqual(eligibleQuestions(pool, TOPICS, state, 100), []);
  assert.deepEqual(eligibleQuestions(pool, TOPICS, state, 300), pool, "fits exactly at the boundary");
});

// ── no eligible question remaining ────────────────────────────────────────

test("pickNextQuestion returns null, not a throw, when nothing is eligible", () => {
  const pool = [Q("a", "governor_limits", "intermediate", 999)];
  const state = initialSelectionState("intermediate");
  assert.equal(pickNextQuestion(pool, TOPICS, state, 10), null);
});

test("an empty pool returns null cleanly", () => {
  const state = initialSelectionState("intermediate");
  assert.equal(pickNextQuestion([], TOPICS, state, 900), null);
});

// ── recordQuestionOutcome / coverage bookkeeping ──────────────────────────

test("recordQuestionOutcome marks the topic covered and feeds difficulty adaptation", () => {
  let state = initialSelectionState("intermediate");
  state = recordQuestionOutcome(state, "governor_limits", 0.9);
  assert.ok(state.coveredTopics.has("governor_limits"));
  assert.equal(state.recentRatios.length, 1);

  state = recordQuestionOutcome(state, "bulkification", 0.95);
  assert.equal(state.difficultyPointer, "advanced", "two strong closes in a row stepped it up");
});

test("difficulty match genuinely discriminates across bands (not just intermediate content)", () => {
  const pool = [
    Q("beg", "governor_limits", "beginner"),
    Q("int", "governor_limits", "intermediate"),
    Q("adv", "governor_limits", "advanced"),
  ];
  const advancedState = { ...initialSelectionState("advanced"), coveredTopics: new Set(["governor_limits"]) };
  const picked = pickNextQuestion(pool, TOPICS, advancedState, 900);
  assert.equal(picked?.id, "adv", "with coverage equal, difficulty match should decide it");
});
