import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeResume } from "./resume-analyzer.js";
import { resumeProfileToBlueprint } from "./resume-blueprint.js";
import { generateDocumentPlan } from "./document-plan-generator.js";
import { FakeStructuredProvider } from "./state/fake-provider.js";
import { buildResumeAnalysisPrompt } from "./prompts/resume-prompts.js";
import type { ResumeProfile } from "./schema/resume-analysis.js";

function profile(over: Partial<ResumeProfile> = {}): ResumeProfile {
  return {
    headline: "Backend engineer",
    domain: "backend engineering",
    totalExperienceLabel: "5 years",
    seniority: "senior",
    roles: [{
      title: "Senior Engineer", organization: "Stripe-like Co", durationLabel: "2020–2025",
      isCurrent: true,
      responsibilities: ["Owned the payments ledger"],
      achievements: ["Removed double-charge incidents entirely"],
      technologies: ["Go", "Postgres"],
    }],
    projects: [{
      name: "Idempotent payments",
      summary: "Made the charge endpoint safe to retry.",
      technologies: ["Postgres"],
      claims: ["Zero double charges in 18 months"],
    }],
    skills: ["Distributed systems"],
    technologies: ["Go", "Postgres", "Kafka"],
    education: [],
    certifications: [],
    notableClaims: ["Handled 4k requests per second"],
    followUpAreas: [{ area: "Idempotency keys", rationale: "Claims zero double charges without explaining how." }],
    thinAreas: [],
    suggestedDifficulty: "advanced",
    difficultyRationale: "Senior scope with concrete distributed-systems detail.",
    ...over,
  };
}

test("analyzeResume returns the provider's structured profile and usage", async () => {
  const p = profile();
  const provider = new FakeStructuredProvider([{ value: p }]);

  const result = await analyzeResume(provider, { text: "extracted resume text", filename: "cv.pdf" });

  assert.deepEqual(result.profile, p);
  assert.equal(result.usage.costCents, 0.1);
});

test("analyzeResume's prompt includes the filename and the extracted text", async () => {
  const provider = new FakeStructuredProvider([{ value: profile() }]);
  await analyzeResume(provider, { text: "UNIQUE_RESUME_MARKER", filename: "anon-cv.pdf" });

  const prompt = provider.calls[0]!.userPrompt;
  assert.ok(prompt.includes("anon-cv.pdf"));
  assert.ok(prompt.includes("UNIQUE_RESUME_MARKER"));
});

test("analyzeResume propagates a provider failure rather than swallowing it", async () => {
  const provider = new FakeStructuredProvider([{ error: new Error("model unavailable") }]);
  await assert.rejects(
    () => analyzeResume(provider, { text: "x", filename: "cv.pdf" }),
    /model unavailable/,
  );
});

test("the resume prompt forbids personal identifying information explicitly", () => {
  // The schema drops PII structurally, but the model shouldn't be asked to
  // produce it in the first place — cheaper and less likely to leak into
  // free-text fields like headline.
  const prompt = buildResumeAnalysisPrompt({ text: "t", filename: "f.pdf" });
  assert.match(prompt, /PRIVACY/);
  assert.match(prompt, /Do NOT output the candidate's name/);
  assert.match(prompt, /phone number/);
});

test("a resume-derived blueprint runs through the EXISTING document plan generator unchanged", async () => {
  // End-to-end proof of the reuse claim: analysis -> profile -> blueprint ->
  // the same generateDocumentPlan/validatePlan path the M7 material pipeline
  // uses. If this passes, a resume interview is runnable with no new engine.
  const analysisProvider = new FakeStructuredProvider([{ value: profile() }]);
  const { profile: analysed } = await analyzeResume(analysisProvider, { text: "resume text", filename: "cv.pdf" });

  const mapped = resumeProfileToBlueprint(analysed, { emphasis: "technical_depth" });
  assert.equal(mapped.ok, true);
  if (!mapped.ok) throw new Error("unreachable");

  const skeleton = {
    sections: [{
      id: "core",
      title: "Experience",
      goal: "Probe the ledger work the resume claims.",
      budgetS: 780,
      topicIds: ["cv__role-1"],
    }],
    dimensionWeights: [
      { dimension: "correctness" as const, weight: 0.5 },
      { dimension: "depth" as const, weight: 0.5 },
    ],
  };
  const questions = {
    questions: Array.from({ length: 4 }, (_, i) => ({
      id: `q${i + 1}`,
      topicId: "cv__role-1",
      text: `Scenario ${i + 1}: you owned the payments ledger and a client retries the same charge request twice. Walk me through what happens end to end.`,
      kind: "scenario" as const,
      scores: ["correctness" as const, "depth" as const],
      mustHear: [
        { id: "dedupe", signal: "names a deduplication mechanism keyed on a client-supplied request identifier", probe: "How does the second attempt get recognised?" },
        { id: "duplicate", signal: "explains the stored outcome is replayed rather than the charge repeating", probe: "What does the caller receive that time?" },
        { id: "retention", signal: "addresses how long those identifiers are kept before expiry", probe: "How long does that record live?" },
      ],
      answerKey: {
        weak: "Says retries are handled without describing any mechanism or what the caller sees.",
        competent: "Describes request-identifier deduplication and replaying the stored outcome for duplicates.",
        excellent: "Also covers identifier retention, concurrent in-flight duplicates, and recovery from partial failure.",
      },
      maxProbes: 2,
      hardTimeS: 180,
      difficultyBand: "advanced" as const,
    })),
  };

  const genProvider = new FakeStructuredProvider([{ value: skeleton }, { value: questions }]);
  const result = await generateDocumentPlan({
    provider: genProvider,
    // The generator reads difficulty from the blueprint, so a candidate's
    // chosen difficulty is applied by overriding suggestedDifficulty before
    // generation — there is no separate difficulty input.
    blueprint: { ...mapped.blueprint, suggestedDifficulty: "advanced" },
    categoryId: "cv",
    planKey: "resume_test_plan",
    durationS: 900,
    closingReserveS: 120,
    dimensions: ["correctness", "depth"],
    poolSize: 4,
    promptVersion: "resume-test-v1",
  });

  assert.equal(
    result.issues.filter((i) => i.severity === "error").length,
    0,
    `validatePlan reported errors: ${JSON.stringify(result.issues)}`,
  );
  assert.equal(result.generated.questions.length, 4);
  assert.equal(result.generated.plan.persona.name, "Priya");
});
