import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { normalizeAndCapText, type CustomFileType, type NormalizedText } from "./document-limits";

// No `import "server-only"` guard: that package only resolves inside
// Next.js's own build/dev pipeline, not under the plain Node test runner
// this project's `pnpm test` uses — importing it here would make this file
// untestable. pdf-parse/mammoth are Node-only regardless (they pull in
// filesystem and Buffer-heavy dependencies), so a "use client" component
// trying to import this module would already fail Next's browser bundle,
// same as the SDK-splitting pattern @ai/core/browser uses.

export class ExtractionError extends Error {
  constructor(message: string, readonly cause_?: unknown) {
    super(message);
    this.name = "ExtractionError";
  }
}

/**
 * Raw bytes -> normalized, length-capped text. Any parser failure (a
 * corrupt PDF, an encrypted DOCX, a binary file with a misleading
 * extension) surfaces as ExtractionError — never a silent empty string,
 * which the caller would otherwise be unable to distinguish from a
 * genuinely blank document.
 */
export async function extractText(buffer: Buffer, fileType: CustomFileType): Promise<NormalizedText> {
  const raw = await extractRaw(buffer, fileType);
  return normalizeAndCapText(raw);
}

async function extractRaw(buffer: Buffer, fileType: CustomFileType): Promise<string> {
  try {
    switch (fileType) {
      case "txt":
        return buffer.toString("utf-8");
      case "pdf": {
        const parser = new PDFParse({ data: buffer });
        try {
          const result = await parser.getText();
          return result.text;
        } finally {
          await parser.destroy();
        }
      }
      case "docx": {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      }
    }
  } catch (err) {
    throw new ExtractionError(
      `failed to extract text from ${fileType} file: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}
