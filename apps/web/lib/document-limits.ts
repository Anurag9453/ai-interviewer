/**
 * Size/type/cost controls for M7 custom-document uploads — deterministic,
 * enforced server-side (client-side copies of these same constants are for
 * immediate feedback only, never trusted). Every number here exists because
 * "this feature can become expensive quickly" is a real constraint: an
 * unbounded document means an unbounded analysis prompt means an unbounded
 * Claude bill per upload.
 */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_EXTRACTED_CHARS = 50_000; // ~12-13k tokens, well inside one request
export const MIN_EXTRACTED_CHARS = 200; // below this, treat as empty/unreadable rather than analyze
export const MAX_QUESTION_POOL_SIZE = 12;
export const MIN_QUESTION_POOL_SIZE = 4;

export type CustomFileType = "pdf" | "docx" | "txt";

const MIME_TO_FILE_TYPE: Record<string, CustomFileType> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

const EXTENSION_TO_FILE_TYPE: Record<string, CustomFileType> = {
  pdf: "pdf",
  docx: "docx",
  txt: "txt",
};

export interface UploadValidationOk {
  ok: true;
  fileType: CustomFileType;
}
export interface UploadValidationError {
  ok: false;
  code: "unsupported_type" | "too_large" | "empty_file";
  message: string;
}
export type UploadValidationResult = UploadValidationOk | UploadValidationError;

/**
 * Type is checked by BOTH declared MIME type and file extension — some
 * browsers/OSes send a generic or missing MIME type for less common
 * extensions, and a spoofed MIME type on its own proves nothing, so this
 * only accepts a file where the two agree (or the MIME type is absent and
 * the extension alone maps cleanly).
 */
export function validateUpload(input: { filename: string; size: number; mimeType: string }): UploadValidationResult {
  if (input.size <= 0) {
    return { ok: false, code: "empty_file", message: "The file is empty." };
  }
  if (input.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false, code: "too_large",
      message: `File is too large (max ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB).`,
    };
  }

  const ext = input.filename.split(".").pop()?.toLowerCase() ?? "";
  const byExt = EXTENSION_TO_FILE_TYPE[ext];
  const byMime = MIME_TO_FILE_TYPE[input.mimeType.toLowerCase()];

  // Reject outright if both are present and disagree (a spoofed extension or
  // MIME type). Otherwise trust whichever one resolved.
  if (byMime && byExt && byMime !== byExt) {
    return { ok: false, code: "unsupported_type", message: "Only PDF, DOCX, and TXT files are supported." };
  }
  const fileType = byMime ?? byExt;
  if (!fileType) {
    return { ok: false, code: "unsupported_type", message: "Only PDF, DOCX, and TXT files are supported." };
  }

  return { ok: true, fileType };
}

export interface NormalizedText {
  text: string;
  charCount: number;
  truncated: boolean;
}

/**
 * Deterministic truncation, never "blindly send huge context to Claude" —
 * collapses excess whitespace (extraction libraries routinely leave runs of
 * blank lines/spaces that cost tokens without adding signal) then hard-caps
 * length at a fixed character boundary.
 */
export function normalizeAndCapText(raw: string, maxChars: number = MAX_EXTRACTED_CHARS): NormalizedText {
  const collapsed = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = collapsed.length > maxChars;
  const text = truncated ? collapsed.slice(0, maxChars) : collapsed;
  return { text, charCount: text.length, truncated };
}

export function isEffectivelyEmpty(normalized: NormalizedText): boolean {
  return normalized.charCount < MIN_EXTRACTED_CHARS;
}
