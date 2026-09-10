import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeDocument } from "./document-analyzer.js";
import { FakeStructuredProvider } from "./state/fake-provider.js";
import type { DocumentBlueprint } from "./schema/document-analysis.js";

function validBlueprint(over: Partial<DocumentBlueprint> = {}): DocumentBlueprint {
  return {
    subject: "REST API design for a payments service",
    domain: "backend engineering",
    topics: [
      { id: "idempotency", label: "Idempotency", description: "How the API avoids double-charging on retry.", subtopics: ["idempotency keys"], importance: 0.9 },
    ],
    concepts: ["idempotency key", "at-least-once delivery"],
    importantSections: ["Retry semantics"],
    candidateFacts: ["Idempotency keys are stored for 24 hours."],
    suggestedAngles: ["tradeoff between at-least-once and exactly-once delivery"],
    suggestedDifficulty: "intermediate",
    difficultyRationale: "Assumes familiarity with distributed systems basics.",
    ...over,
  };
}

test("analyzeDocument returns the provider's structured blueprint and usage", async () => {
  const blueprint = validBlueprint();
  const provider = new FakeStructuredProvider([{ value: blueprint }]);

  const result = await analyzeDocument(provider, { text: "some extracted text", filename: "spec.pdf" });

  assert.deepEqual(result.blueprint, blueprint);
  assert.equal(result.usage.costCents, 0.1);
});

test("analyzeDocument's prompt includes the filename and the extracted text", async () => {
  const provider = new FakeStructuredProvider([{ value: validBlueprint() }]);
  await analyzeDocument(provider, { text: "UNIQUE_MARKER_TEXT", filename: "resume.docx" });

  assert.equal(provider.calls.length, 1);
  const prompt = provider.calls[0]!.userPrompt;
  assert.ok(prompt.includes("resume.docx"));
  assert.ok(prompt.includes("UNIQUE_MARKER_TEXT"));
});

test("analyzeDocument propagates a provider failure rather than swallowing it", async () => {
  const provider = new FakeStructuredProvider([{ error: new Error("model unavailable") }]);
  await assert.rejects(
    () => analyzeDocument(provider, { text: "x", filename: "f.txt" }),
    /model unavailable/,
  );
});
