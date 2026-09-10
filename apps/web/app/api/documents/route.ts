import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { uploadDocumentBytes, documentStoragePath } from "@/lib/supabase/storage";
import { validateUpload, MIN_EXTRACTED_CHARS } from "@/lib/document-limits";
import { resolveDocumentType, checkDocumentFileType, isTooEmptyToAnalyze } from "@/lib/document-upload-policy";
import { extractText, ExtractionError } from "@/lib/document-extraction";

/** GET: the caller's own upload history — RLS ("custom_documents: select own") does the scoping. */
export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("custom_documents")
    .select("id, filename, file_type, document_type, status, error_message, extracted_char_count, truncated, category_id, generated_plan_id, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "list_failed" }, { status: 500 });
  return NextResponse.json({ documents: data });
}

/**
 * POST: upload + extract in one request. A <=10MB document extracts fast
 * enough that doing this synchronously is simpler and more honest than a
 * fake "processing" polling state for work that's actually done in a
 * second — the client still sees an explicit uploading state of its own
 * while the request is in flight either way.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  const validation = validateUpload({ filename: file.name, size: file.size, mimeType: file.type });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.code, message: validation.message }, { status: 400 });
  }

  const documentType = resolveDocumentType(form?.get("documentType"));
  const typePolicy = checkDocumentFileType(documentType, validation.fileType);
  if (!typePolicy.ok) {
    return NextResponse.json({ error: typePolicy.code, message: typePolicy.message }, { status: 400 });
  }

  const documentId = crypto.randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = documentStoragePath(userId, documentId, file.name);
  const service = createServiceClient();

  const { error: insertError } = await service.from("custom_documents").insert({
    id: documentId, user_id: userId, filename: file.name, file_type: validation.fileType,
    document_type: documentType,
    size_bytes: file.size, storage_path: storagePath, status: "uploaded",
  });
  if (insertError) return NextResponse.json({ error: "upload_failed" }, { status: 500 });

  try {
    await uploadDocumentBytes(storagePath, buffer, file.type || "application/octet-stream");
  } catch (err) {
    await service.from("custom_documents").update({
      status: "extraction_failed", error_message: "Couldn't store the file.",
    }).eq("id", documentId);
    console.error("document storage upload failed", err);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }

  try {
    const result = await extractText(buffer, validation.fileType);
    const isEmpty = isTooEmptyToAnalyze(result.charCount, MIN_EXTRACTED_CHARS);
    await service.from("custom_documents").update({
      status: isEmpty ? "empty" : "extracted",
      extracted_text: isEmpty ? null : result.text,
      extracted_char_count: result.charCount,
      truncated: result.truncated,
      updated_at: new Date().toISOString(),
    }).eq("id", documentId);

    return NextResponse.json({
      documentId, documentType, status: isEmpty ? "empty" : "extracted",
      extractedCharCount: result.charCount, truncated: result.truncated,
    });
  } catch (err) {
    const message = err instanceof ExtractionError ? err.message : "Couldn't read this file.";
    await service.from("custom_documents").update({
      status: "extraction_failed", error_message: message, updated_at: new Date().toISOString(),
    }).eq("id", documentId);
    return NextResponse.json({ documentId, status: "extraction_failed", message });
  }
}
