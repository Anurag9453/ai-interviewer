/**
 * Phase 1 of the custom-document pipeline: extracted text -> DocumentBlueprint.
 * One structured Claude call, schema-validated by generateStructured itself
 * (zod parse failure throws rather than returning malformed data) — the
 * blueprint is what the candidate reviews before any question gets written.
 */
import type { LlmProvider } from "./providers/types.js";
import type { Usage } from "./providers/types.js";
import { DocumentBlueprintSchema, type DocumentBlueprint } from "./schema/document-analysis.js";
import { buildDocumentAnalysisPrompt, type AnalysisPromptInput } from "./prompts/document-prompts.js";

export interface AnalyzeDocumentResult {
  blueprint: DocumentBlueprint;
  usage: Usage;
}

export async function analyzeDocument(
  provider: LlmProvider, input: AnalysisPromptInput,
): Promise<AnalyzeDocumentResult> {
  const res = await provider.generateStructured({
    userPrompt: buildDocumentAnalysisPrompt(input),
    schema: DocumentBlueprintSchema,
    quality: "thorough",
    maxOutputTokens: 8_000,
  });
  return { blueprint: res.value, usage: res.usage };
}
