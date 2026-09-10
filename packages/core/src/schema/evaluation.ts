import { z } from "zod";

/** The six evaluation dimensions, scored 0-10. */
export const DIMENSIONS = [
  "correctness",
  "relevance",
  "depth",
  "clarity",
  "technical_accuracy",
  "problem_solving",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DimensionScoresSchema = z.object({
  correctness: z.number().min(0).max(10),
  relevance: z.number().min(0).max(10),
  depth: z.number().min(0).max(10),
  clarity: z.number().min(0).max(10),
  technical_accuracy: z.number().min(0).max(10),
  problem_solving: z.number().min(0).max(10),
});
export type DimensionScores = z.infer<typeof DimensionScoresSchema>;

/** Behavioural anchors at 1/3/5/7/9 on the 0-10 scale; even values interpolate. */
export const RubricAnchorSchema = z.object({
  rubricRef: z.string().min(1),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  dimension: z.string().min(1),
  anchor1: z.string().min(20),
  anchor3: z.string().min(20),
  anchor5: z.string().min(20),
  anchor7: z.string().min(20),
  anchor9: z.string().min(20),
});
export type RubricAnchor = z.infer<typeof RubricAnchorSchema>;

export const SignalStatusSchema = z.enum(["heard", "partial", "missing"]);
export type SignalStatus = z.infer<typeof SignalStatusSchema>;

export const SignalRecordSchema = z.object({
  signalId: z.string().min(1),
  status: SignalStatusSchema,
  evidenceTurnId: z.string().min(1),
  quote: z.string(),
});
export type SignalRecord = z.infer<typeof SignalRecordSchema>;

/**
 * The five report categories are compositions of the six dimensions. They do
 * not map 1:1, which is why the mapping is explicit and versioned here.
 */
export const REPORT_CATEGORIES = {
  technical_knowledge: { correctness: 0.6, technical_accuracy: 0.4 },
  problem_solving: { problem_solving: 1.0 },
  communication: { clarity: 0.7, relevance: 0.3 },
  answer_depth: { depth: 1.0 },
  technical_accuracy: { technical_accuracy: 1.0 },
} as const satisfies Record<string, Partial<Record<Dimension, number>>>;

export type ReportCategory = keyof typeof REPORT_CATEGORIES;

export const AnswerFeedbackSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  candidateAnswer: z.string(),
  whatWasGood: z.string(),
  whatWasMissing: z.string(),
  howToImprove: z.string(),
  strongerAnswer: z.string(),
});

export const ReportSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  band: z.string().min(1),
  categoryScores: z.record(z.string(), z.number().min(0).max(10)),
  strengths: z.array(z.object({ title: z.string(), detail: z.string(), quote: z.string().optional() })),
  weaknesses: z.array(z.object({ title: z.string(), detail: z.string(), quote: z.string().optional() })),
  answerFeedback: z.array(AnswerFeedbackSchema),
  narrative: z.string(),
});
export type Report = z.infer<typeof ReportSchema>;
