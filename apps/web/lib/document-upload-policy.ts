/**
 * The decisions the document routes make before touching storage or Claude.
 *
 * Pure and separate from the route so they're directly testable: the routes
 * themselves transitively import `server-only` (via the service client), which
 * doesn't resolve under a plain `node --test` runner. Keeping the rules here
 * means the rules get real unit coverage instead of only being exercised by a
 * manual click-through.
 */
import type { CustomFileType } from "./document-limits";

export type DocumentType = "material" | "resume";

/**
 * Anything that isn't the exact string "resume" is generic material.
 *
 * Fails closed on purpose: a typo, a missing field, or a hostile value must
 * never silently produce a resume, because resumes take a different analysis
 * prompt and are surfaced to the candidate as "we read your resume".
 */
export function resolveDocumentType(raw: unknown): DocumentType {
  return raw === "resume" ? "resume" : "material";
}

export type FileTypePolicyResult =
  | { ok: true }
  | { ok: false; code: "resume_must_be_pdf"; message: string };

/**
 * First release supports PDF resumes only. DOCX/TXT remain valid for generic
 * material — the restriction is specific to resumes, not a global narrowing.
 */
export function checkDocumentFileType(
  documentType: DocumentType, fileType: CustomFileType,
): FileTypePolicyResult {
  if (documentType === "resume" && fileType !== "pdf") {
    return {
      ok: false,
      code: "resume_must_be_pdf",
      message: "Please upload your resume as a PDF for now.",
    };
  }
  return { ok: true };
}

/**
 * Ownership gate for every document route.
 *
 * `custom_documents` has a select-own RLS policy, but the write paths use the
 * service-role client (which bypasses RLS entirely), so this comparison IS the
 * authorization check on those routes — not a formality. A missing row and
 * someone else's row are deliberately indistinguishable to the caller.
 */
export function ownsDocument(
  doc: { user_id: string } | null | undefined, userId: string,
): boolean {
  return Boolean(doc && doc.user_id === userId);
}

/** Statuses from which an analysis run is allowed (or retryable). */
export const ANALYZABLE_STATUSES = new Set(["extracted", "analysis_failed"]);
/** Statuses from which plan generation is allowed (or retryable). */
export const GENERATABLE_STATUSES = new Set(["analyzed", "generation_failed"]);

/**
 * Whether a freshly uploaded document is too empty to analyse. Mirrors the
 * route's own threshold via MIN_EXTRACTED_CHARS rather than a second literal —
 * a duplicated `< 200` in the route was exactly the kind of drift this avoids.
 */
export function isTooEmptyToAnalyze(charCount: number, minChars: number): boolean {
  return charCount < minChars;
}
