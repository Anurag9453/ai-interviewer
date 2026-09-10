import { z } from "zod";

export const DifficultySchema = z.enum(["beginner", "intermediate", "advanced"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const ModeSchema = z.enum(["breadth", "depth"]);
export type Mode = z.infer<typeof ModeSchema>;

export const QuestionKindSchema = z.enum([
  "definition",
  "scenario",
  "tradeoff",
  "debug",
  "code_reasoning",
]);

/**
 * A must_hear signal is something an observer can VERIFY WAS SAID — never a
 * quality judgement. Its paired probe fires only when the signal is missing,
 * and must not contain the answer.
 */
export const MustHearSignalSchema = z.object({
  id: z.string().min(1),
  signal: z.string().min(10),
  probe: z.string().min(5),
});
export type MustHearSignal = z.infer<typeof MustHearSignalSchema>;

/**
 * Calibration reference for the question. Signal design is checked against
 * it: the highest must_hear signal must be something `excellent` volunteers
 * and `competent` does not. Also feeds the report's stronger-answer example.
 */
export const AnswerKeySchema = z.object({
  weak: z.string().min(20),
  competent: z.string().min(20),
  excellent: z.string().min(20),
});
export type AnswerKey = z.infer<typeof AnswerKeySchema>;

export const QuestionSchema = z.object({
  id: z.string().min(1),
  topicId: z.string().min(1),
  text: z.string().min(10),
  kind: QuestionKindSchema,
  /** Dimension ids this question feeds. */
  scores: z.array(z.string().min(1)).min(1),
  mustHear: z.array(MustHearSignalSchema).min(3).max(4),
  answerKey: AnswerKeySchema,
  maxProbes: z.number().int().min(0).max(4),
  hardTimeS: z.number().int().min(30).max(600),
  difficultyBand: DifficultySchema,
});
export type Question = z.infer<typeof QuestionSchema>;

export const SectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  goal: z.string().min(1),
  budgetS: z.number().int().min(30),
  topicIds: z.array(z.string().min(1)).min(1),
});
export type Section = z.infer<typeof SectionSchema>;

export const PersonaSchema = z.object({
  name: z.string().min(1),
  style: z.string().min(20),
  voiceId: z.string().min(1),
});
export type Persona = z.infer<typeof PersonaSchema>;

export const InterviewPlanSchema = z.object({
  planKey: z.string().min(1),
  categoryId: z.string().min(1),
  difficulty: DifficultySchema,
  mode: ModeSchema,
  durationS: z.number().int().min(300),
  persona: PersonaSchema,
  sections: z.array(SectionSchema).min(1),
  /** Dimension id → weight. Must sum to 1.0. */
  dimensionWeights: z.record(z.string(), z.number().min(0).max(1)),
  promptVersion: z.string().min(1),
});
export type InterviewPlan = z.infer<typeof InterviewPlanSchema>;

/** What the plan generator returns: the plan plus its question pool. */
export const GeneratedPlanSchema = z.object({
  plan: InterviewPlanSchema,
  questions: z.array(QuestionSchema).min(3),
});
export type GeneratedPlan = z.infer<typeof GeneratedPlanSchema>;
