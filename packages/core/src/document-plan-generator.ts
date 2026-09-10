/**
 * Converts a reviewed DocumentBlueprint into the EXACT same content model
 * the seeded M1 Salesforce pool uses — a GeneratedPlan (InterviewPlan +
 * Question[]) — validated with the identical `validatePlan()` the seeded
 * content is held to. This is the whole point: a custom document does not
 * get a second, looser interview engine. AdaptiveBrain, plan-loader.ts,
 * the report pipeline, and every RLS rule already proven for Salesforce
 * content apply unchanged to whatever this produces.
 *
 * Two Claude calls (mirroring content/scripts/generate-plan.ts's own
 * two-phase shape): a plan-skeleton call for sections/dimensionWeights, and
 * a question-batch call for the pool. Identity fields (persona, category id,
 * mode, difficulty, duration, planKey) are NOT model output — set here,
 * deterministically, so "arbitrary model prose" never reaches runtime
 * behavior; only the schema-validated structured fields do.
 */
import type { LlmProvider } from "./providers/types.js";
import { addUsage, ZERO_USAGE, type Usage } from "./providers/types.js";
import type { DocumentBlueprint } from "./schema/document-analysis.js";
import { DocumentPlanSkeletonSchema, DocumentQuestionBatchSchema } from "./schema/document-analysis.js";
import type { GeneratedPlan, Persona } from "./schema/plan.js";
import { buildDocumentPlanSkeletonPrompt, buildDocumentQuestionPrompt } from "./prompts/document-prompts.js";
import { validatePlan, type Issue } from "./validate/plan-validator.js";
import type { TopicSpec } from "./prompts/plan-generator.js";

const DEFAULT_PERSONA: Persona = {
  name: "Priya",
  style: "warm but brisk, never praises, never teaches, never summarises the candidate's answer",
  voiceId: "priya-default",
};

/**
 * Blueprint topic ids come from the model and are not guaranteed globally
 * unique — `topics.id` is a single global primary key shared with the
 * seeded taxonomy, so an id like "governor_limits" picked by chance would
 * collide. Namespacing under the category id, decided BEFORE any prompt
 * that echoes ids back, makes collision structurally impossible rather
 * than something the model needs to avoid on its own.
 */
export function namespaceBlueprintTopicIds(blueprint: DocumentBlueprint, categoryId: string): DocumentBlueprint {
  return {
    ...blueprint,
    topics: blueprint.topics.map((t) => ({ ...t, id: `${categoryId}__${slugify(t.id)}` })),
  };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "topic";
}

/** {dimension, weight}[] (the reliable model-facing shape) -> Record<Dimension, number> (InterviewPlanSchema's shape). */
export function dimensionWeightsToRecord(entries: ReadonlyArray<{ dimension: string; weight: number }>): Record<string, number> {
  return Object.fromEntries(entries.map((e) => [e.dimension, e.weight]));
}

export function blueprintTopicsToSpecs(blueprint: DocumentBlueprint): TopicSpec[] {
  return blueprint.topics.map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    aliases: [],
    importance: t.importance,
    // Every custom topic is a leaf — no cross-document prerequisite chain a
    // model could infer reliably from one upload, and depth mode requires
    // depthReady=true to anchor a section, which every custom topic must be
    // able to do since there's no shallower alternative pool for it.
    depthReady: true,
    prereqs: [],
    rubricRef: "custom",
    expectation: t.description,
  }));
}

export interface GenerateDocumentPlanInput {
  provider: LlmProvider;
  blueprint: DocumentBlueprint;
  categoryId: string;
  planKey: string;
  durationS: number;
  closingReserveS: number;
  dimensions: string[];
  poolSize: number;
  promptVersion: string;
  persona?: Persona;
}

export interface GenerateDocumentPlanResult {
  generated: GeneratedPlan;
  topics: TopicSpec[];
  issues: Issue[];
  usage: Usage;
}

export async function generateDocumentPlan(input: GenerateDocumentPlanInput): Promise<GenerateDocumentPlanResult> {
  // Namespaced up front — every downstream prompt and every DB row uses
  // these ids, never the model's originals.
  const blueprint = namespaceBlueprintTopicIds(input.blueprint, input.categoryId);
  const topics = blueprintTopicsToSpecs(blueprint);
  const ctx = { durationS: input.durationS, closingReserveS: input.closingReserveS, dimensions: input.dimensions };

  let usage: Usage = ZERO_USAGE;

  const skeletonRes = await input.provider.generateStructured({
    userPrompt: buildDocumentPlanSkeletonPrompt(blueprint, ctx),
    schema: DocumentPlanSkeletonSchema,
    quality: "thorough",
    maxOutputTokens: 4_000,
  });
  usage = addUsage(usage, skeletonRes.usage);

  const questionsRes = await input.provider.generateStructured({
    userPrompt: buildDocumentQuestionPrompt(blueprint, { ...ctx, poolSize: input.poolSize }),
    schema: DocumentQuestionBatchSchema,
    quality: "thorough",
    maxOutputTokens: 16_000,
  });
  usage = addUsage(usage, questionsRes.usage);

  const generated: GeneratedPlan = {
    plan: {
      planKey: input.planKey,
      categoryId: input.categoryId,
      difficulty: blueprint.suggestedDifficulty,
      mode: "depth",
      durationS: input.durationS,
      persona: input.persona ?? DEFAULT_PERSONA,
      sections: skeletonRes.value.sections,
      dimensionWeights: dimensionWeightsToRecord(skeletonRes.value.dimensionWeights),
      promptVersion: input.promptVersion,
    },
    questions: questionsRes.value.questions,
  };

  const poolPerTopic = Math.max(1, Math.round(input.poolSize / Math.max(1, topics.length)));
  const issues = validatePlan(generated, {
    topics, dimensions: input.dimensions, durationS: input.durationS,
    poolPerTopic, closingReserveS: input.closingReserveS,
  });

  return { generated, topics, issues, usage };
}
