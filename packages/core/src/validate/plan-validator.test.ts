import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlan, type ValidateContext } from "./plan-validator.js";
import type { GeneratedPlan, Question } from "../schema/plan.js";
import type { TopicSpec } from "../prompts/plan-generator.js";

const DIMENSIONS = [
  "correctness", "relevance", "depth", "clarity", "technical_accuracy", "problem_solving",
];

const topic = (over: Partial<TopicSpec> = {}): TopicSpec => ({
  id: "sfdev.bulkification", label: "Bulkification", description: "d",
  aliases: [], importance: 0.9, depthReady: true, prereqs: [],
  rubricRef: "r.v1", expectation: "e", ...over,
});

const question = (over: Partial<Question> = {}): Question => ({
  id: "q1",
  topicId: "sfdev.bulkification",
  text: "A trigger passes in your sandbox and fails on a large data load. Where do you look first?",
  kind: "scenario",
  scores: ["correctness", "depth"],
  mustHear: [
    { id: "s1", signal: "identifies a query or DML statement placed inside a loop", probe: "What in that code makes record count matter?" },
    { id: "s2", signal: "names which governor limit the symptom points to", probe: "Which limit specifically?" },
    { id: "s3", signal: "states the fix as querying once into a map and doing one DML on a list", probe: "What does the restructured code look like?" },
  ],
  answerKey: {
    weak: "I would open the debug logs and look for the error message there.",
    competent: "There is probably a query inside a loop, so you have to bulkify it properly.",
    excellent: "A query in a loop, so I would move it out into a map keyed on id, and note the trigger fires repeatedly in chunks which is why low volume passed.",
  },
  maxProbes: 3,
  hardTimeS: 240,
  difficultyBand: "intermediate",
  ...over,
});

const plan = (over: Partial<GeneratedPlan> = {}): GeneratedPlan => ({
  plan: {
    planKey: "k", categoryId: "salesforce_dev", difficulty: "intermediate",
    mode: "depth", durationS: 900,
    persona: { name: "Priya", style: "Senior engineer, warm but brisk, never praises an answer.", voiceId: "v" },
    sections: [{ id: "sec1", title: "T", goal: "g", budgetS: 780, topicIds: ["sfdev.bulkification"] }],
    dimensionWeights: { correctness: 0.2, relevance: 0.1, depth: 0.25, clarity: 0.15, technical_accuracy: 0.1, problem_solving: 0.2 },
    promptVersion: "v",
  },
  questions: [question({ id: "q1" }), question({ id: "q2", text: "Walk me through why moving that query out of the loop changes the outcome at volume." }), question({ id: "q3", text: "Your handler runs twice on one save. How do you find out why?", kind: "debug" })],
  ...over,
});

const ctx: ValidateContext = {
  topics: [topic()], dimensions: DIMENSIONS, durationS: 900,
  poolPerTopic: 3, closingReserveS: 120,
};

const errors = (g: GeneratedPlan, c: ValidateContext = ctx) =>
  validatePlan(g, c).filter((i) => i.severity === "error");

test("a well-formed plan produces no errors", () => {
  assert.deepEqual(errors(plan()), []);
});

test("rejects a numeric value inside a signal", () => {
  const g = plan();
  g.questions[0]!.mustHear[1]!.signal = "states that the SOQL limit is 100 queries per transaction";
  assert.ok(errors(g).some((i) => i.rule === "signal-has-number"));
});

test("rejects a quality adjective posing as a signal", () => {
  const g = plan();
  g.questions[0]!.mustHear[0]!.signal = "clearly demonstrates a good understanding of bulkification";
  assert.ok(errors(g).some((i) => i.rule === "signal-is-judgement"));
});

test("rejects a signal requiring a named framework", () => {
  const g = plan();
  g.questions[0]!.mustHear[0]!.signal = "states that the logic belongs in an fflib domain class";
  assert.ok(errors(g).some((i) => i.rule === "signal-names-framework"));
});

test("rejects a signal gated on release or version status", () => {
  const g = plan();
  g.questions[0]!.mustHear[0]!.signal = "states that user mode is generally available in this API version";
  assert.ok(errors(g).some((i) => i.rule === "signal-release-dependent"));
});

test("rejects an answer key whose competent and excellent are identical", () => {
  const g = plan();
  g.questions[0]!.answerKey.excellent = g.questions[0]!.answerKey.competent;
  assert.ok(errors(g).some((i) => i.rule === "answer-key-flat"));
});

test("rejects a trivia-heavy pool", () => {
  const g = plan();
  for (const q of g.questions) q.kind = "definition";
  const e = errors(g);
  assert.ok(e.some((i) => i.rule === "trivia-heavy"));
  assert.ok(e.some((i) => i.rule === "too-many-definitions"));
});

test("rejects a definition question claiming to measure problem_solving", () => {
  const g = plan();
  g.questions[0]!.kind = "definition";
  g.questions[0]!.scores = ["correctness", "problem_solving"];
  assert.ok(errors(g).some((i) => i.rule === "dimension-mismatch"));
});

test("rejects dimension weights that do not sum to one", () => {
  const g = plan();
  g.plan.dimensionWeights.depth = 0.9;
  assert.ok(errors(g).some((i) => i.rule === "weights-sum"));
});

test("rejects a topic placed before its prerequisite", () => {
  const g = plan();
  g.plan.sections = [
    { id: "s1", title: "T", goal: "g", budgetS: 390, topicIds: ["sfdev.bulkification"] },
    { id: "s2", title: "T", goal: "g", budgetS: 390, topicIds: ["sfdev.governor_limits"] },
  ];
  const c: ValidateContext = {
    ...ctx,
    topics: [topic({ prereqs: ["sfdev.governor_limits"] }), topic({ id: "sfdev.governor_limits" })],
  };
  assert.ok(errors(g, c).some((i) => i.rule === "prereq-order"));
});

test("rejects a question too long to speak aloud", () => {
  const g = plan();
  g.questions[0]!.text = Array(40).fill("word").join(" ");
  assert.ok(errors(g).some((i) => i.rule === "question-length"));
});

test("rejects duplicate questions within a pool", () => {
  const g = plan();
  g.questions[1]!.text = g.questions[0]!.text;
  assert.ok(errors(g).some((i) => i.rule === "duplicate-question"));
});

test("does not reject the ordinary conjunction \"as well as\"", () => {
  const g = plan();
  g.questions[0]!.mustHear[0]!.signal =
    "volunteers testing the unsuccessful response as well as the successful one";
  assert.deepEqual(
    errors(g).filter((i) => i.rule === "signal-is-judgement"),
    [],
  );
});

test("still rejects \"well\" used as a judgement", () => {
  const g = plan();
  g.questions[0]!.mustHear[0]!.signal = "explains the mechanism well when asked";
  assert.ok(errors(g).some((i) => i.rule === "signal-is-judgement"));
});

test("rejects a question charging both correctness and technical_accuracy", () => {
  const g = plan();
  g.questions[0]!.scores = ["correctness", "technical_accuracy"];
  assert.ok(errors(g).some((i) => i.rule === "correctness-accuracy-overlap"));
});

test("rejects a question charging both relevance and correctness", () => {
  const g = plan();
  g.questions[0]!.scores = ["relevance", "correctness"];
  assert.ok(errors(g).some((i) => i.rule === "relevance-correctness-overlap"));
});
