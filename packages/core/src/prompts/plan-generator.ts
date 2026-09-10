import type { Difficulty, Mode } from "../schema/plan.js";
import type { RubricAnchor } from "../schema/evaluation.js";

export const PLAN_PROMPT_VERSION = "planner/2026-09-09.1";

export interface TopicSpec {
  id: string;
  label: string;
  description: string;
  aliases: string[];
  importance: number;
  depthReady: boolean;
  prereqs: string[];
  rubricRef: string;
  /** What a competent candidate at this level should know. */
  expectation: string;
}

export interface PlanPromptInput {
  categoryLabel: string;
  topics: TopicSpec[];
  difficulty: Difficulty;
  mode: Mode;
  durationS: number;
  dimensions: string[];
  anchors: RubricAnchor[];
  poolPerTopic: number;
}

const MODE_SHAPE: Record<Mode, string> = {
  breadth:
    "8-10 questions across the interview, one per topic, maxProbes 1, " +
    "hardTimeS 120, sections of about 180s. Tests coverage.",
  depth:
    "3-4 questions across the interview, maxProbes 3, hardTimeS 240, " +
    "sections of about 420s. Tests understanding and tradeoff reasoning.",
};

/**
 * The single hardest constraint in this system: a `must_hear` signal is the
 * grading instrument. A badly designed signal silently mis-scores every
 * interview that draws on it, so the rules below are stated as prohibitions.
 */
export const SIGNAL_RULES = `
## MUST_HEAR SIGNALS — the grading instrument

A signal is something an observer can VERIFY WAS SAID. Never a quality
judgement.
    not a signal:  "explains it clearly"
    not a signal:  "demonstrates good understanding"
    a signal:      "states that the query must move outside the loop and the
                    results be joined in memory"

Rules:
1. Three or four signals per question, ordered basic to advanced.
2. No signal may be satisfied by restating the question or expanding an
   acronym.
3. Signals must be independently checkable. If satisfying s2 automatically
   satisfies s3, merge them.
4. The HIGHEST signal must be something a strong candidate VOLUNTEERS
   UNPROMPTED — a tradeoff, a failure mode, an operational cost, a boundary
   condition. It must NOT be obscure trivia. Test it against this question:
   "would a good engineer who has actually done this work say this without
   being asked?" If the answer is no, the signal is wrong.

## BANNED SIGNAL CONTENT — these mis-grade and are non-negotiable

5. NEVER make an exact numeric value a signal. Not limit integers, not batch
   sizes, not heap sizes, not timeouts, not version numbers. These change
   between releases and are edition-dependent. A signal may reference WHICH
   limit applies and its DIRECTION ("async gets a higher ceiling than sync"),
   never a number. A candidate saying "about a hundred queries" must be able
   to fully satisfy any limit-related signal.
6. NEVER make a feature's GA / beta / pilot status a signal. It changes every
   release.
7. NEVER make a signal depend on a platform default that varies by API
   version. Phrase such signals so that a candidate who says "it depends on
   the API version" or "it depends how the class is declared" FULLY SATISFIES
   the signal — that is the better answer, not a worse one.
8. NEVER require a specific named framework. Trigger frameworks (fflib,
   Trigger Actions, homegrown handlers) are all legitimate. The signal is the
   architectural property ("logic delegated out of the trigger body"), never
   a product name.
9. NEVER require one specific mechanism where several are legitimate. For
   field-level security, ANY of user-mode operations, stripInaccessible, or
   security-enforced querying must satisfy the signal. Write the signal as the
   OUTCOME ("names a concrete mechanism that enforces field-level access"),
   and list the accepted forms in the signal text.
10. NEVER treat a legacy-but-valid choice as wrong. Orgs standardise on older
    constructs for real reasons. Signals ask whether the candidate can name a
    concrete DIFFERENCE between options, never which option they prefer.
`;

export const DIMENSION_RULES = `
## DIMENSION MAPPING

Map each question to 2-3 dimensions via \`scores\`. Only list dimensions the
question can actually measure — a pure definition question cannot measure
problem_solving, and listing it there produces a meaningless score.

correctness and technical_accuracy are DELIBERATELY SEPARATE and must not
both be charged for one mistake:
  * correctness        = whether the claim itself is true
  * technical_accuracy = precision of API names, signatures, terminology, and
                         approximate or current numeric values

NEVER list both correctness and technical_accuracy on the same question. A
question's signal ratio is applied to every dimension it declares, so listing
both charges one mistake twice. Choose the one the question actually tests:
claim truth, or naming precision. This is validated and will reject the pool.

relevance means one narrow thing: whether the candidate addressed the question
asked rather than drifting into adjacent material. It is NOT a general
"good answer" score. Never list it alongside correctness — under uniform ratio
scoring the two would be identical. This is validated.

A wrong API name for a correct idea is a technical_accuracy miss ONLY.
A correct name attached to a false claim is a correctness miss ONLY.
When designing signals, do not write two signals that would both fail on the
same single mistake.
`;

export const QUESTION_RULES = `
## QUESTION RULES

1. Spoken register. Contractions. No semicolons, no lists, no parentheticals.
   Under 35 words. A text-to-speech engine reads it aloud.
2. Exactly one question per question. No "and also".
3. No transition preamble. The live interviewer handles transitions.
4. EVALUATE ENGINEERING REASONING, NOT MEMORISATION. Strongly prefer
   scenario, debug, and tradeoff questions over definitions:
     weak:   "What is bulkification?"
     strong: "A trigger passes in your sandbox and fails on a five thousand
              row load. Where do you look first?"
   At most ONE definition-kind question may appear in a topic's pool, and only
   where the concept genuinely has no scenario form.
5. Prefer "why" and "what would you do" over "what is". A question whose full
   answer could be copied from documentation is a bad question.
6. Calibrate to the difficulty level given, using the supplied rubric anchors
   as the reference for what a 5 versus a 9 sounds like at this level.
`;

export const ANSWER_KEY_RULES = `
## ANSWER KEY — required on every question

Write three concrete answers in the candidate's voice, not descriptions of
answers:

  weak       What someone who has read about this but not done it says.
             Typically label-level, or one keyword offered as a whole answer.
  competent  What a solid practitioner at this level says. Correct and
             useful, but stops at the mechanism and does not volunteer the
             tradeoff or failure mode.
  excellent  What a strong candidate says, INCLUDING the thing the highest
             signal is looking for, volunteered without being asked.

The gap between competent and excellent must be exactly the highest signal.
If \`excellent\` and \`competent\` differ only in wording, the signal set is
wrong — fix the signals, not the key.
`;

export const PROBE_RULES = `
## PROBES

Each signal carries one probe, fired only when that signal is missing.
* The probe MUST NOT contain the answer.
      leaks:   "Did you consider that moving the query out of the loop fixes it?"
      correct: "What in that code makes the record count matter?"
* Spoken, under 15 words where possible.
* Write only the FIRST attempt, phrased openly. The live interviewer narrows
  it itself on a second attempt.
* If the candidate has only restated the term, the probe must push toward
  substance rather than repeat the question.
`;

export function buildPlanPrompt(input: PlanPromptInput): string {
  const anchorBlock = input.anchors
    .map(
      (a) =>
        `### ${a.dimension} (${a.difficulty})\n` +
        `  1: ${a.anchor1}\n  3: ${a.anchor3}\n  5: ${a.anchor5}\n` +
        `  7: ${a.anchor7}\n  9: ${a.anchor9}`,
    )
    .join("\n");

  const topicBlock = input.topics
    .map(
      (t) =>
        `- id: ${t.id}\n  label: ${t.label}\n  description: ${t.description}\n` +
        `  competent candidate knows: ${t.expectation}\n` +
        `  importance: ${t.importance}  depthReady: ${t.depthReady}\n` +
        `  prereqs: [${t.prereqs.join(", ") || "none"}]\n` +
        `  rubricRef: ${t.rubricRef}`,
    )
    .join("\n");

  return `You generate interview plans that a live voice AI executes verbatim.
You are not conducting the interview. You are writing the script and the
scoring instrument, and both must work without you present.

## CONTEXT
category:   ${input.categoryLabel}
difficulty: ${input.difficulty}
mode:       ${input.mode}
duration:   ${input.durationS}s
dimensions: ${input.dimensions.join(", ")}

## MODE SHAPE
${MODE_SHAPE[input.mode]}

Generate a POOL of ${input.poolPerTopic} questions per topic. The runtime
samples from the pool and excludes questions a user has already seen, so every
question must stand alone — no cross-references between questions.
${QUESTION_RULES}${SIGNAL_RULES}${DIMENSION_RULES}${ANSWER_KEY_RULES}${PROBE_RULES}
## SECTIONS
Group topics into sections whose budgets sum to ${input.durationS - 120}s
(120s is reserved: 45s intro, 75s closing). Order easiest to hardest. Never
place a topic before its prerequisite. Only topics with depthReady true may
anchor a depth-mode section.

## DIMENSION WEIGHTS
Weight the dimensions so they sum to exactly 1.0, biased toward the dimensions
the selected topics actually exercise.

## RUBRIC ANCHORS — reference, reuse verbatim, do not rewrite
${anchorBlock}

## TOPICS
${topicBlock}

Return only the plan and question pool conforming to the provided schema.`;
}

/**
 * Per-topic question pool prompt. Reuses the same rule blocks as the plan
 * prompt so the two phases cannot drift apart.
 */
export function buildQuestionPoolPrompt(
  topic: TopicSpec,
  input: Omit<PlanPromptInput, "topics">,
): string {
  const anchorBlock = input.anchors
    .map(
      (a) =>
        `### ${a.dimension}\n  1: ${a.anchor1}\n  3: ${a.anchor3}\n` +
        `  5: ${a.anchor5}\n  7: ${a.anchor7}\n  9: ${a.anchor9}`,
    )
    .join("\n");

  return `You are writing the question pool for ONE topic in a spoken technical
interview. A live voice AI will execute these verbatim.

## CONTEXT
category:   ${input.categoryLabel}
difficulty: ${input.difficulty}
mode:       ${input.mode}
dimensions: ${input.dimensions.join(", ")}

## TOPIC
id:          ${topic.id}
label:       ${topic.label}
description: ${topic.description}
a competent candidate at this level knows: ${topic.expectation}

Write exactly ${input.poolPerTopic} questions for this topic. Every question
must stand alone — the runtime samples from the pool, so no question may refer
to another. Set topicId to "${topic.id}" on every question, maxProbes to
${input.mode === "depth" ? 3 : 1}, and hardTimeS to ${input.mode === "depth" ? 240 : 120}.
${QUESTION_RULES}${SIGNAL_RULES}${DIMENSION_RULES}${ANSWER_KEY_RULES}${PROBE_RULES}
## RUBRIC ANCHORS — the reference for what a 5 versus a 9 sounds like
${anchorBlock}

Return only the questions, conforming to the provided schema.`;
}
