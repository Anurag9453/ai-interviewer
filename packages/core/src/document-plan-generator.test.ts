import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blueprintTopicsToSpecs, dimensionWeightsToRecord, generateDocumentPlan, namespaceBlueprintTopicIds,
} from "./document-plan-generator.js";
import { FakeStructuredProvider } from "./state/fake-provider.js";
import type { DocumentBlueprint, DocumentPlanSkeleton, DocumentQuestionBatch } from "./schema/document-analysis.js";
import type { Question } from "./schema/plan.js";

function blueprint(): DocumentBlueprint {
  return {
    subject: "REST API design for a payments service",
    domain: "backend engineering",
    topics: [
      { id: "idempotency", label: "Idempotency", description: "Avoiding double-charging on retry.", subtopics: [], importance: 0.9 },
    ],
    concepts: [], importantSections: [], candidateFacts: [], suggestedAngles: [],
    suggestedDifficulty: "intermediate",
    difficultyRationale: "assumes distributed systems basics",
  };
}

test("namespaceBlueprintTopicIds prefixes every topic id, so a model-picked id matching a real seeded topic cannot collide", () => {
  // "governor_limits" is a REAL id in the seeded Salesforce taxonomy
  // (content/salesforce-dev/taxonomy.ts) — topics.id is one global primary
  // key, so an unprefixed collision here would corrupt the seeded content.
  const collidingBlueprint: DocumentBlueprint = {
    ...blueprint(),
    topics: [{ id: "governor_limits", label: "Rate limits", description: "d", subtopics: [], importance: 0.5 }],
  };

  const result = namespaceBlueprintTopicIds(collidingBlueprint, "custom_abc123");

  assert.equal(result.topics.length, 1);
  assert.ok(result.topics[0]!.id.startsWith("custom_abc123__"));
  assert.notEqual(result.topics[0]!.id, "governor_limits");
});

test("dimensionWeightsToRecord converts the model-facing array shape into InterviewPlanSchema's record shape", () => {
  const record = dimensionWeightsToRecord([
    { dimension: "correctness", weight: 0.6 },
    { dimension: "depth", weight: 0.4 },
  ]);
  assert.deepEqual(record, { correctness: 0.6, depth: 0.4 });
});

test("blueprintTopicsToSpecs maps to TopicSpec with no prereqs and depthReady true, always", () => {
  const specs = blueprintTopicsToSpecs(blueprint());
  assert.equal(specs.length, 1);
  assert.equal(specs[0]!.depthReady, true);
  assert.deepEqual(specs[0]!.prereqs, []);
  assert.equal(specs[0]!.label, "Idempotency");
});

function validQuestion(topicId: string): Question {
  return {
    id: "q1", topicId,
    text: "Your payment API receives the same charge request twice due to a client retry. How do you avoid charging the customer twice?",
    kind: "scenario", scores: ["correctness"],
    mustHear: [
      { id: "s1", signal: "identifies that the client sends an idempotency key with the request", probe: "What would the client need to send?" },
      { id: "s2", signal: "states the server stores the key and returns the prior result on repeat", probe: "What does the server do the second time?" },
      { id: "s3", signal: "mentions the stored key needs a bounded window rather than living forever", probe: "Would you keep that record forever?" },
    ],
    answerKey: {
      weak: "You just check if it has already been charged somehow before doing it again.",
      competent: "The client sends an idempotency key, the server stores it with the result and returns the stored result on a repeat.",
      excellent: "The client sends an idempotency key, the server stores it with the result and returns the stored result on a repeat, and expires the record after a bounded window so storage does not grow forever.",
    },
    maxProbes: 1, hardTimeS: 180, difficultyBand: "intermediate",
  };
}

const BASE_INPUT = {
  categoryId: "custom_abc123", planKey: "custom_abc123.intermediate", durationS: 900,
  closingReserveS: 120, dimensions: ["correctness", "depth", "clarity", "relevance", "technical_accuracy", "problem_solving"],
  poolSize: 1, promptVersion: "custom-v1",
};

test("generateDocumentPlan assembles a plan that passes validatePlan when the model output is well-formed", async () => {
  const namespacedTopicId = "custom_abc123__idempotency";
  const skeleton: DocumentPlanSkeleton = {
    sections: [{ id: "sec1", title: "Idempotency", goal: "probe retry handling", budgetS: 780, topicIds: [namespacedTopicId] }],
    dimensionWeights: [{ dimension: "correctness", weight: 1 }],
  };
  const batch: DocumentQuestionBatch = { questions: [validQuestion(namespacedTopicId)] };
  const provider = new FakeStructuredProvider([{ value: skeleton }, { value: batch }]);

  const result = await generateDocumentPlan({ provider, blueprint: blueprint(), ...BASE_INPUT });

  assert.deepEqual(result.issues.filter((i) => i.severity === "error"), [], "a well-formed plan should have zero validation errors");
  assert.equal(result.generated.plan.categoryId, "custom_abc123");
  assert.equal(result.generated.questions.length, 1);
  assert.equal(result.generated.questions[0]!.topicId, namespacedTopicId, "the question must reference the SAME namespaced id the topics were built from");
  assert.equal(result.topics[0]!.id, namespacedTopicId);
});

test("generateDocumentPlan surfaces validatePlan's errors rather than silently persisting a bad pool", async () => {
  const namespacedTopicId = "custom_abc123__idempotency";
  const skeleton: DocumentPlanSkeleton = {
    sections: [{ id: "sec1", title: "Idempotency", goal: "probe retry handling", budgetS: 780, topicIds: [namespacedTopicId] }],
    dimensionWeights: [{ dimension: "correctness", weight: 1 }],
  };
  // Deliberately reuses both correctness AND technical_accuracy — the exact
  // double-charging rule plan-validator.ts exists to catch.
  const badQuestion: Question = { ...validQuestion(namespacedTopicId), scores: ["correctness", "technical_accuracy"] };
  const batch: DocumentQuestionBatch = { questions: [badQuestion] };
  const provider = new FakeStructuredProvider([{ value: skeleton }, { value: batch }]);

  const result = await generateDocumentPlan({ provider, blueprint: blueprint(), ...BASE_INPUT });

  const errors = result.issues.filter((i) => i.severity === "error");
  assert.ok(errors.some((i) => i.rule === "correctness-accuracy-overlap"), "the reused validator must reject this exactly as it would for seeded content");
});

test("generateDocumentPlan propagates a provider failure on the question-batch call", async () => {
  const skeleton: DocumentPlanSkeleton = {
    sections: [{ id: "sec1", title: "T", goal: "g", budgetS: 780, topicIds: ["custom_abc123__idempotency"] }],
    dimensionWeights: [{ dimension: "correctness", weight: 1 }],
  };
  const provider = new FakeStructuredProvider([{ value: skeleton }, { error: new Error("rate limited") }]);
  await assert.rejects(
    () => generateDocumentPlan({ provider, blueprint: blueprint(), ...BASE_INPUT }),
    /rate limited/,
  );
});
