import { test } from "node:test";
import assert from "node:assert/strict";
import { extractText, ExtractionError } from "./document-extraction.js";

test("extractText reads a TXT file as UTF-8 and normalizes it", async () => {
  const buffer = Buffer.from("Hello   world.\n\n\n\nSecond paragraph.", "utf-8");
  const result = await extractText(buffer, "txt");
  assert.equal(result.text, "Hello world.\n\nSecond paragraph.");
  assert.equal(result.truncated, false);
});

test("extractText on an empty TXT file returns zero-length text, not an error", async () => {
  const result = await extractText(Buffer.from("", "utf-8"), "txt");
  assert.equal(result.charCount, 0);
});

test("extractText raises ExtractionError for a corrupt/non-PDF buffer claiming to be a PDF", async () => {
  const garbage = Buffer.from("this is not a real PDF file at all", "utf-8");
  await assert.rejects(
    () => extractText(garbage, "pdf"),
    (err: unknown) => err instanceof ExtractionError,
  );
});

test("extractText raises ExtractionError for a corrupt/non-DOCX buffer claiming to be a DOCX", async () => {
  const garbage = Buffer.from("this is not a real DOCX file at all", "utf-8");
  await assert.rejects(
    () => extractText(garbage, "docx"),
    (err: unknown) => err instanceof ExtractionError,
  );
});
