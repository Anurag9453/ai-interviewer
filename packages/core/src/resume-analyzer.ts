/**
 * Phase 1 of the resume pipeline: extracted resume text -> ResumeProfile.
 *
 * Mirrors document-analyzer.ts exactly (one structured Claude call, schema
 * validated by generateStructured, zod failure throws rather than returning
 * malformed data). The profile is what the candidate reviews before any
 * question is generated.
 */
import type { LlmProvider, Usage } from "./providers/types.js";
import { ResumeProfileSchema, type ResumeProfile } from "./schema/resume-analysis.js";
import { buildResumeAnalysisPrompt, type ResumeAnalysisPromptInput } from "./prompts/resume-prompts.js";

export interface AnalyzeResumeResult {
  profile: ResumeProfile;
  usage: Usage;
}

export async function analyzeResume(
  provider: LlmProvider, input: ResumeAnalysisPromptInput,
): Promise<AnalyzeResumeResult> {
  const res = await provider.generateStructured({
    userPrompt: buildResumeAnalysisPrompt(input),
    schema: ResumeProfileSchema,
    quality: "thorough",
    maxOutputTokens: 8_000,
  });
  return { profile: res.value, usage: res.usage };
}
