import type { RubricAnchor } from "@ai/core";

/**
 * Base anchors, authored per difficulty and shared across topics. Every topic
 * currently resolves here; `resolveAnchors` allows a topic-specific override
 * later without rewriting the taxonomy.
 *
 * Anchors describe WHAT WAS SAID. No quality adjectives, no numeric values.
 * correctness and technical_accuracy are scoped so that one factual mistake
 * cannot be charged to both.
 */
export const BASE_REF = "sfdev.base.v1";

export const INTERMEDIATE_ANCHORS: RubricAnchor[] = [
  {
    rubricRef: BASE_REF, difficulty: "intermediate", dimension: "correctness",
    anchor1: "Claims are wrong in ways that would break production. A core concept is inverted.",
    anchor3: "Broadly the right direction, but contains a material factual error they do not notice or correct.",
    anchor5: "The main claim is true. Imprecision on secondary points that does not change the conclusion.",
    anchor7: "True throughout, including secondary details. Self-corrects when they misspeak.",
    anchor9: "True throughout, and explicitly bounds their own certainty — separates what they know from what they would verify.",
  },
  {
    rubricRef: BASE_REF, difficulty: "intermediate", dimension: "relevance",
    anchor1: "Answers a different question. Recites a rehearsed adjacent topic.",
    anchor3: "Starts on topic, drifts away, and does not come back.",
    anchor5: "Answers the question, after padding or a detour.",
    anchor7: "Answers directly, stays in scope, and returns to the question after any necessary aside.",
    anchor9: "Identifies which part of the question is load-bearing, then answers that part.",
  },
  {
    rubricRef: BASE_REF, difficulty: "intermediate", dimension: "depth",
    anchor1: "Names the thing with no mechanism at all. Label-level restatement of the term.",
    anchor3: "Describes what happens but not why. Mechanism appears only when explicitly probed.",
    anchor5: "Explains the mechanism when prompted, and hand-waves at least one layer below it.",
    anchor7: "Volunteers the mechanism unprompted, naming concrete components and how they interact.",
    anchor9: "Volunteers the mechanism and names the boundary condition or failure mode without being asked.",
  },
  {
    rubricRef: BASE_REF, difficulty: "intermediate", dimension: "clarity",
    anchor1: "Rambling or fragmentary. Cannot be followed without reconstruction.",
    anchor3: "Followable but disorganised. The conclusion arrives before its support, or never arrives.",
    anchor5: "Lands, but with circling and filler along the way.",
    anchor7: "States the answer, then supports it. Terminology used precisely.",
    anchor9: "Structured and economical. Signposts the shape of the answer and defines any term the listener may not share.",
  },
  {
    rubricRef: BASE_REF, difficulty: "intermediate", dimension: "technical_accuracy",
    anchor1: "Invents interface names, or attributes behaviour to the wrong platform feature.",
    anchor3: "Right concept attached to the wrong name. No sense of the magnitude of any limit involved.",
    anchor5: "Correct names for everyday constructs; approximate on less common interfaces.",
    anchor7: "Precise names and signatures for constructs they use routinely, and magnitudes right even when exact values are not offered.",
    anchor9: "Precise on names and signatures, and flags where a value or default is version-dependent rather than stating it as fixed.",
  },
  {
    rubricRef: BASE_REF, difficulty: "intermediate", dimension: "problem_solving",
    anchor1: "No approach offered. Guesses, or asks to be given the answer.",
    anchor3: "Jumps to one solution without examining constraints or alternatives.",
    anchor5: "Reaches a workable solution. Considers alternatives only when prompted.",
    anchor7: "Clarifies the constraints first, proposes a solution, and names one tradeoff unprompted.",
    anchor9: "Clarifies constraints, compares options against them, names the failure mode of the option chosen, and says what they would measure to confirm it worked.",
  },
];

/** Topic-specific anchors override the base set; none exist yet. */
const OVERRIDES: RubricAnchor[] = [];

export function resolveAnchors(rubricRef: string, difficulty: string): RubricAnchor[] {
  const specific = OVERRIDES.filter(
    (a) => a.rubricRef === rubricRef && a.difficulty === difficulty,
  );
  if (specific.length > 0) return specific;
  return INTERMEDIATE_ANCHORS.filter(
    (a) => a.rubricRef === BASE_REF && a.difficulty === difficulty,
  );
}
