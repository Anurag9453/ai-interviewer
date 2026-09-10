import { z } from "zod";
import { DifficultySchema, QuestionSchema, SectionSchema } from "./plan.js";
import { DIMENSIONS } from "./evaluation.js";

/**
 * What Claude's document-analysis pass produces — reviewed by the candidate
 * before any question gets generated (the "Review extracted content" step),
 * and the ONLY thing question generation (document-to-plan.ts) is allowed
 * to read. Structured and validated so arbitrary model prose never directly
 * drives runtime behavior — every field here is a bounded, typed value, not
 * free text the app blindly trusts.
 */
export const BlueprintTopicSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80),
  // Real Claude output ran ~20% over a 400-char cap on a genuine test
  // document (verified live, not assumed) — 700 gives real slack for a
  // multi-sentence description while the prompt still asks for "a
  // paragraph", not an essay.
  description: z.string().min(1).max(700),
  /** Notable subtopics or entities under this topic, for the review UI. */
  subtopics: z.array(z.string().min(1).max(120)).max(8),
  /** 0-1, how central this topic is to the document. */
  importance: z.number().min(0).max(1),
});
export type BlueprintTopic = z.infer<typeof BlueprintTopicSchema>;

export const DocumentBlueprintSchema = z.object({
  subject: z.string().min(1).max(200),
  domain: z.string().min(1).max(120),
  topics: z.array(BlueprintTopicSchema).min(1).max(12),
  /** Notable concepts/entities not already captured as a topic. */
  concepts: z.array(z.string().min(1).max(120)).max(20),
  /** Section titles/headings judged worth asking about. */
  importantSections: z.array(z.string().min(1).max(160)).max(20),
  /** Specific, verifiable facts from the document a question could probe for. */
  candidateFacts: z.array(z.string().min(1).max(300)).max(30),
  /** Short phrases describing possible interview angles, e.g. "tradeoffs between X and Y". */
  suggestedAngles: z.array(z.string().min(1).max(200)).max(10),
  suggestedDifficulty: DifficultySchema,
  difficultyRationale: z.string().min(1).max(300),
});
export type DocumentBlueprint = z.infer<typeof DocumentBlueprintSchema>;

/**
 * Phase 2 of custom-plan generation: the CONTENT structure only (which
 * topics group into which timed sections, how dimensions are weighted).
 * Identity fields (persona, category id, difficulty, duration, planKey) are
 * NOT model-generated — those are product/brand decisions, set
 * deterministically by document-to-plan.ts, not improvised per upload.
 */
/**
 * `dimensionWeights` as an array of {dimension, weight} pairs, not a
 * record — verified live, twice, that a dynamic-keyed record is unreliable
 * for Claude's forced structured output to populate (it returned a
 * genuinely EMPTY object on real test runs even under an explicit
 * "must not be empty" instruction). An array of fixed-shape objects is the
 * well-established more-reliable structured-output pattern; converted to
 * the internal Record<Dimension, number> shape by document-plan-generator.ts
 * before it ever reaches InterviewPlanSchema, so nothing downstream changes.
 */
export const DimensionWeightSchema = z.object({
  dimension: z.enum(DIMENSIONS),
  weight: z.number().min(0).max(1),
});
export type DimensionWeightEntry = z.infer<typeof DimensionWeightSchema>;

export const DocumentPlanSkeletonSchema = z.object({
  sections: z.array(SectionSchema).min(1).max(6),
  dimensionWeights: z.array(DimensionWeightSchema).min(1).max(DIMENSIONS.length)
    .refine(
      (entries) => new Set(entries.map((e) => e.dimension)).size === entries.length,
      "dimensionWeights must not repeat the same dimension twice",
    ),
});
export type DocumentPlanSkeleton = z.infer<typeof DocumentPlanSkeletonSchema>;

/**
 * Reuses the exact Question schema the seeded M1 content pool is validated
 * against, plus one extra guard QuestionSchema itself doesn't enforce (and
 * shouldn't gain just for this path): every `scores` entry must be a real
 * dimension. Real Claude output invented "communication" on a genuine test
 * run (verified live) — validatePlan already catches this too, but at that
 * point a full question batch has already been generated and paid for, so
 * catching it here first is strictly better economics for a bad response.
 */
export const DocumentQuestionBatchSchema = z.object({
  questions: z.array(QuestionSchema).min(3).max(12),
}).refine(
  (batch) => batch.questions.every((q) => q.scores.every((s) => (DIMENSIONS as readonly string[]).includes(s))),
  { message: `every question's scores must be one of: ${DIMENSIONS.join(", ")}` },
);
export type DocumentQuestionBatch = z.infer<typeof DocumentQuestionBatchSchema>;
