import { test } from "node:test";
import assert from "node:assert/strict";
import { toInterviewPlan, toQuestion, toTopicSpec, type InterviewPlanRow, type QuestionPoolRow, type TopicRow } from "./plan-loader.js";

test("toQuestion maps question_pool's snake_case columns onto the Question type, using external_id as the content id", () => {
  const row: QuestionPoolRow = {
    external_id: "gl.sandbox-to-load",
    topic_id: "governor_limits",
    text: "A trigger fails on a large load. Where do you look first?",
    kind: "scenario",
    scores: ["correctness", "technical_accuracy"],
    must_hear: [{ id: "s1", signal: "names a query in a loop", probe: "What makes volume matter here?" }],
    answer_key: { weak: "w".repeat(20), competent: "c".repeat(20), excellent: "e".repeat(20) },
    max_probes: 2,
    hard_time_s: 180,
    difficulty_band: "intermediate",
  };

  const q = toQuestion(row);

  assert.equal(q.id, "gl.sandbox-to-load", "Question.id must be the content id, never question_pool's uuid");
  assert.equal(q.topicId, "governor_limits");
  assert.equal(q.kind, "scenario");
  assert.deepEqual(q.scores, ["correctness", "technical_accuracy"]);
  assert.equal(q.mustHear.length, 1);
  assert.equal(q.maxProbes, 2);
  assert.equal(q.hardTimeS, 180);
  assert.equal(q.difficultyBand, "intermediate");
});

test("toTopicSpec maps the topics table's columns and leaves the authoring-only fields empty rather than fabricated", () => {
  const row: TopicRow = {
    id: "bulkification", label: "Bulkification", importance: 0.9,
    depth_ready: true, prereqs: ["governor_limits"], aliases: ["bulk apex"], rubric_ref: "r.v1",
  };

  const spec = toTopicSpec(row);

  assert.equal(spec.id, "bulkification");
  assert.equal(spec.label, "Bulkification");
  assert.equal(spec.importance, 0.9);
  assert.equal(spec.depthReady, true);
  assert.deepEqual(spec.prereqs, ["governor_limits"]);
  assert.deepEqual(spec.aliases, ["bulk apex"]);
  assert.equal(spec.rubricRef, "r.v1");
  assert.equal(spec.description, "");
  assert.equal(spec.expectation, "");
});

test("toTopicSpec defaults null prereqs/aliases to empty arrays", () => {
  const row: TopicRow = {
    id: "t", label: "T", importance: 0.5, depth_ready: false, prereqs: null, aliases: null, rubric_ref: "r",
  };
  const spec = toTopicSpec(row);
  assert.deepEqual(spec.prereqs, []);
  assert.deepEqual(spec.aliases, []);
});

test("toInterviewPlan combines interview_plans' top-level columns with the nested plan jsonb", () => {
  const row: InterviewPlanRow = {
    plan_key: "salesforce_dev.intermediate.900",
    category_id: "salesforce_dev",
    difficulty: "intermediate",
    mode: "depth",
    duration_s: 900,
    prompt_version: "v1",
    plan: {
      persona: { name: "Priya", style: "warm but brisk, never praises, never teaches, min chars here", voiceId: "v1" },
      sections: [{ id: "sec1", title: "T", goal: "g", budgetS: 780, topicIds: ["governor_limits"] }],
      dimensionWeights: { correctness: 1 },
    },
  };

  const plan = toInterviewPlan(row);

  assert.equal(plan.planKey, "salesforce_dev.intermediate.900");
  assert.equal(plan.categoryId, "salesforce_dev");
  assert.equal(plan.difficulty, "intermediate");
  assert.equal(plan.mode, "depth");
  assert.equal(plan.durationS, 900);
  assert.equal(plan.promptVersion, "v1");
  assert.equal(plan.persona.name, "Priya");
  assert.equal(plan.sections.length, 1);
  assert.deepEqual(plan.dimensionWeights, { correctness: 1 });
});
