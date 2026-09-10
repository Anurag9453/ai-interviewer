/**
 * Prompt builders for M7's two-phase custom-document pipeline:
 *   1. analysis: extracted text -> DocumentBlueprint (candidate reviews this)
 *   2. generation: DocumentBlueprint -> plan skeleton + question batch,
 *      reusing the EXACT rule blocks (SIGNAL_RULES, QUESTION_RULES, etc.)
 *      the seeded M1 content is generated and validated against, so a
 *      custom pool is held to the identical bar, not a separate/looser one.
 *
 * Pure string builders — no I/O, no provider calls. See document-to-plan.ts
 * for the code that actually calls generateStructured() with these.
 */
import type { DocumentBlueprint } from "../schema/document-analysis.js";
import {
  ANSWER_KEY_RULES, DIMENSION_RULES, PROBE_RULES, QUESTION_RULES, SIGNAL_RULES,
} from "./plan-generator.js";

export interface AnalysisPromptInput {
  /** Already extracted, normalized, and length-capped — see document-extraction.ts. */
  text: string;
  filename: string;
}

export function buildDocumentAnalysisPrompt(input: AnalysisPromptInput): string {
  return `You are analyzing a document a candidate uploaded so a mock interview can be
built around it. You are not writing questions yet — only understanding the
material well enough that a later step can.

## DOCUMENT
filename: ${input.filename}

## TEXT
${input.text}

## TASK
Identify:
- subject: what this document is fundamentally about, one line.
- domain: the professional/technical domain (e.g. "backend engineering",
  "product management", "constitutional law").
- topics: 1-12 distinct topics genuinely covered with enough substance to
  interview on. Each needs a short label, a description of AT MOST 2-3
  sentences (under roughly 400 characters — this is a summary for a review
  screen, not the full analysis), up to 8 notable subtopics/entities, and an
  importance score (0-1) reflecting how central it is to the document.
- concepts: named concepts/entities not already captured as a topic.
- importantSections: section or heading titles worth asking about.
- candidateFacts: specific, verifiable facts or claims a question could
  probe for — not summaries, actual checkable statements from the text.
- suggestedAngles: short phrases naming a productive interview angle (a
  tradeoff, a design decision, a consequence) genuinely supported by the
  document's content.
- suggestedDifficulty (beginner/intermediate/advanced) and a one-line
  difficultyRationale, judged from how the document itself treats the
  material (introductory vs. assumes deep prior expertise).

Ground every field in what the text actually says. Do not invent topics,
facts, or angles the document does not support — an empty or thin document
should produce a thin blueprint, not a padded one.`;
}

export interface DocumentPlanContext {
  durationS: number;
  closingReserveS: number;
  dimensions: string[];
}

export function buildDocumentPlanSkeletonPrompt(
  blueprint: DocumentBlueprint, ctx: DocumentPlanContext,
): string {
  const topicBlock = blueprint.topics
    .map((t) => `- id: ${t.id}\n  label: ${t.label}\n  importance: ${t.importance}`)
    .join("\n");

  return `You are structuring a mock interview built from a candidate-uploaded document.

## SUBJECT
${blueprint.subject} (${blueprint.domain})

## TOPICS TO GROUP
${topicBlock}

## TASK
Group these topic ids into 1-6 sections, ordered easiest to hardest, whose
budgetS values sum to EXACTLY ${ctx.durationS - ctx.closingReserveS} seconds
(the interview is ${ctx.durationS}s total, ${ctx.closingReserveS}s reserved
for intro/closing). Every topic id listed above must appear in exactly one
section's topicIds.

Then set dimensionWeights: a list of {dimension, weight} entries, one entry
per dimension you are weighting, using ONLY these exact dimension names
(never invent, rename, or merge one):
${ctx.dimensions.join(", ")}
Weights must sum to exactly 1.0 across the entries, biased toward whichever
dimensions the document's content actually supports testing. You do not need
an entry for every dimension listed above — omit ones the document cannot
support — but you MUST include at least one entry; an empty list is invalid.

Return only the sections and dimensionWeights conforming to the schema.`;
}

export function buildDocumentQuestionPrompt(
  blueprint: DocumentBlueprint, ctx: DocumentPlanContext & { poolSize: number },
): string {
  const topicBlock = blueprint.topics
    .map((t) =>
      `- id: ${t.id}\n  label: ${t.label}\n  about: ${t.description}\n` +
      `  subtopics: ${t.subtopics.join(", ") || "none"}`,
    )
    .join("\n");
  const factsBlock = blueprint.candidateFacts.map((f) => `- ${f}`).join("\n");
  const anglesBlock = blueprint.suggestedAngles.map((a) => `- ${a}`).join("\n");

  return `You are writing the question pool for a mock interview built from a
candidate-uploaded document. A live voice AI will execute these verbatim —
you are writing the script and the scoring instrument, not conducting the
interview yourself.

## SUBJECT
${blueprint.subject} (${blueprint.domain}), difficulty: ${blueprint.suggestedDifficulty}

## TOPICS
${topicBlock}

## FACTS FROM THE DOCUMENT (ground signals in these, do not invent new ones)
${factsBlock || "(none extracted)"}

## SUGGESTED ANGLES
${anglesBlock || "(none extracted)"}

## TASK
Generate a pool of ${ctx.poolSize} questions total, spread across the topics
above in proportion to their importance. Every question's topicId must be one
of the topic ids listed above. Every entry in a question's \`scores\` array
must be exactly one of these dimension names — never a different or
invented name, even a plausible-sounding one like "communication":
${ctx.dimensions.join(", ")}
${QUESTION_RULES}${SIGNAL_RULES}${DIMENSION_RULES}${ANSWER_KEY_RULES}${PROBE_RULES}
Signals and probes must be grounded in what the document actually says — a
signal a candidate could satisfy without having read this specific document
is a bad signal for this interview.

Return only the questions conforming to the schema.`;
}
