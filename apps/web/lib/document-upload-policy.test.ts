import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYZABLE_STATUSES, GENERATABLE_STATUSES, checkDocumentFileType, isTooEmptyToAnalyze,
  ownsDocument, resolveDocumentType,
} from "./document-upload-policy.js";
import { MAX_FILE_SIZE_BYTES, MIN_EXTRACTED_CHARS, validateUpload } from "./document-limits.js";
import { extractText, ExtractionError } from "./document-extraction.js";

test("only the exact string 'resume' produces a resume — everything else is material", () => {
  assert.equal(resolveDocumentType("resume"), "resume");
  // Fails closed: a typo, casing difference, missing field or hostile value
  // must not become a resume, since resumes take a different analysis prompt.
  assert.equal(resolveDocumentType("Resume"), "material");
  assert.equal(resolveDocumentType("resumé"), "material");
  assert.equal(resolveDocumentType("resume "), "material");
  assert.equal(resolveDocumentType(null), "material");
  assert.equal(resolveDocumentType(undefined), "material");
  assert.equal(resolveDocumentType(""), "material");
  assert.equal(resolveDocumentType(42), "material");
  assert.equal(resolveDocumentType({ toString: () => "resume" }), "material");
});

test("a resume must be a PDF, while material may be any supported type", () => {
  assert.equal(checkDocumentFileType("resume", "pdf").ok, true);

  const docx = checkDocumentFileType("resume", "docx");
  assert.equal(docx.ok, false);
  if (docx.ok) throw new Error("unreachable");
  assert.equal(docx.code, "resume_must_be_pdf");
  assert.match(docx.message, /PDF/);

  assert.equal(checkDocumentFileType("resume", "txt").ok, false);
  // The restriction is resume-specific, not a global narrowing.
  assert.equal(checkDocumentFileType("material", "docx").ok, true);
  assert.equal(checkDocumentFileType("material", "txt").ok, true);
  assert.equal(checkDocumentFileType("material", "pdf").ok, true);
});

test("ownership treats a missing row and someone else's row identically", () => {
  const mine = "32756d8c-2016-4fb2-8ea3-a6d0ab85aa49";
  const theirs = "0e5bc1be-7882-44e9-9221-460491c82389";
  assert.equal(ownsDocument({ user_id: mine }, mine), true);
  assert.equal(ownsDocument({ user_id: theirs }, mine), false);
  assert.equal(ownsDocument(null, mine), false);
  assert.equal(ownsDocument(undefined, mine), false);
});

test("an oversized upload is rejected through the real validation path", () => {
  const over = validateUpload({
    filename: "resume.pdf",
    size: MAX_FILE_SIZE_BYTES + 1,
    mimeType: "application/pdf",
  });
  assert.equal(over.ok, false);
  if (over.ok) throw new Error("unreachable");
  assert.equal(over.code, "too_large");

  // Exactly at the limit is allowed — an off-by-one here would reject valid files.
  const at = validateUpload({ filename: "resume.pdf", size: MAX_FILE_SIZE_BYTES, mimeType: "application/pdf" });
  assert.equal(at.ok, true);
});

test("a zero-byte resume is rejected before anything is stored", () => {
  const empty = validateUpload({ filename: "resume.pdf", size: 0, mimeType: "application/pdf" });
  assert.equal(empty.ok, false);
  if (empty.ok) throw new Error("unreachable");
  assert.equal(empty.code, "empty_file");
});

test("a resume whose MIME type contradicts its extension is rejected", () => {
  const lying = validateUpload({ filename: "resume.pdf", size: 1000, mimeType: "text/plain" });
  assert.equal(lying.ok, false);
  if (lying.ok) throw new Error("unreachable");
  assert.equal(lying.code, "unsupported_type");
});

test("a malformed PDF fails extraction with ExtractionError, not a silent empty document", async () => {
  // The bytes a real upload would carry: something claiming to be a PDF that
  // isn't. This is the same call the upload route makes.
  const notAPdf = Buffer.from("%PDF-1.4 this is not actually a valid pdf body");
  await assert.rejects(() => extractText(notAPdf, "pdf"), ExtractionError);
});

test("a scanned/imageless PDF that yields too little text is classed as empty, not analysed", () => {
  // Guards the threshold the upload route applies to decide status 'empty'.
  assert.equal(isTooEmptyToAnalyze(0, MIN_EXTRACTED_CHARS), true);
  assert.equal(isTooEmptyToAnalyze(MIN_EXTRACTED_CHARS - 1, MIN_EXTRACTED_CHARS), true);
  assert.equal(isTooEmptyToAnalyze(MIN_EXTRACTED_CHARS, MIN_EXTRACTED_CHARS), false);
  assert.equal(isTooEmptyToAnalyze(5000, MIN_EXTRACTED_CHARS), false);
});

test("analyze and generate only run from their own valid statuses", () => {
  // Analysis must not run on an un-extracted or already-generated document,
  // and generation must not run before analysis has produced a profile.
  assert.equal(ANALYZABLE_STATUSES.has("extracted"), true);
  assert.equal(ANALYZABLE_STATUSES.has("analysis_failed"), true, "a failed analysis is retryable");
  assert.equal(ANALYZABLE_STATUSES.has("uploaded"), false);
  assert.equal(ANALYZABLE_STATUSES.has("empty"), false);
  assert.equal(ANALYZABLE_STATUSES.has("generated"), false);

  assert.equal(GENERATABLE_STATUSES.has("analyzed"), true);
  assert.equal(GENERATABLE_STATUSES.has("generation_failed"), true, "a failed generation is retryable");
  assert.equal(GENERATABLE_STATUSES.has("extracted"), false, "cannot generate before analysis");
  assert.equal(GENERATABLE_STATUSES.has("generated"), false, "cannot regenerate a finished document");
});
