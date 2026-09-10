import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEffectivelyEmpty, MAX_FILE_SIZE_BYTES, MIN_EXTRACTED_CHARS,
  normalizeAndCapText, validateUpload,
} from "./document-limits.js";

test("validateUpload accepts a PDF whose MIME type and extension agree", () => {
  const result = validateUpload({ filename: "resume.pdf", size: 1024, mimeType: "application/pdf" });
  assert.deepEqual(result, { ok: true, fileType: "pdf" });
});

test("validateUpload accepts a DOCX and a TXT file", () => {
  assert.equal(
    validateUpload({ filename: "notes.docx", size: 1024, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }).ok,
    true,
  );
  assert.equal(validateUpload({ filename: "notes.txt", size: 1024, mimeType: "text/plain" }).ok, true);
});

test("validateUpload rejects an unsupported extension even with no MIME type", () => {
  const result = validateUpload({ filename: "archive.zip", size: 1024, mimeType: "" });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "unsupported_type");
});

test("validateUpload rejects when the declared MIME type and the extension disagree", () => {
  // A .txt file whose browser-declared MIME type claims it's a PDF.
  const result = validateUpload({ filename: "notes.txt", size: 1024, mimeType: "application/pdf" });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "unsupported_type");
});

test("validateUpload rejects a file over the size limit", () => {
  const result = validateUpload({ filename: "big.pdf", size: MAX_FILE_SIZE_BYTES + 1, mimeType: "application/pdf" });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "too_large");
});

test("validateUpload accepts a file at exactly the size limit", () => {
  const result = validateUpload({ filename: "exact.pdf", size: MAX_FILE_SIZE_BYTES, mimeType: "application/pdf" });
  assert.equal(result.ok, true);
});

test("validateUpload rejects an empty (zero-byte) file", () => {
  const result = validateUpload({ filename: "empty.pdf", size: 0, mimeType: "application/pdf" });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "empty_file");
});

test("normalizeAndCapText collapses runs of whitespace and blank lines", () => {
  const result = normalizeAndCapText("Hello   world.\n\n\n\nNext paragraph.");
  assert.equal(result.text, "Hello world.\n\nNext paragraph.");
  assert.equal(result.truncated, false);
});

test("normalizeAndCapText truncates deterministically at the given character cap", () => {
  const raw = "a".repeat(1000);
  const result = normalizeAndCapText(raw, 100);
  assert.equal(result.text.length, 100);
  assert.equal(result.charCount, 100);
  assert.equal(result.truncated, true);
});

test("normalizeAndCapText does not mark an under-the-limit document as truncated", () => {
  const result = normalizeAndCapText("short document", 100);
  assert.equal(result.truncated, false);
});

test("isEffectivelyEmpty flags text under the minimum character threshold", () => {
  assert.equal(isEffectivelyEmpty(normalizeAndCapText("too short")), true);
  assert.equal(isEffectivelyEmpty(normalizeAndCapText("x".repeat(MIN_EXTRACTED_CHARS))), false);
});
