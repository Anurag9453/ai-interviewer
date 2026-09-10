import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteDocumentBytes } from "@/lib/supabase/storage";

/** GET: poll status/blueprint while extraction/analysis/generation run. RLS scopes this to the caller's own row. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const { data, error } = await supabase
    .from("custom_documents")
    .select("id, filename, file_type, status, error_message, extracted_char_count, truncated, analysis, category_id, generated_plan_id, created_at")
    .eq("id", id)
    .single();
  if (error || !data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ document: data });
}

/** DELETE: cancel an upload, or clear a failed one so the candidate can retry with a fresh upload. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();
  // custom_documents has no client DELETE policy — ownership is checked
  // explicitly here, the same pattern the token-reissue route uses.
  const { data: doc, error: fetchError } = await service
    .from("custom_documents").select("user_id, storage_path").eq("id", id).single();
  if (fetchError || !doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (doc.user_id !== userId) return NextResponse.json({ error: "not_your_document" }, { status: 403 });

  await deleteDocumentBytes(doc.storage_path).catch((err) => {
    console.error("document storage delete failed (continuing to remove the DB row)", err);
  });
  const { error: deleteError } = await service.from("custom_documents").delete().eq("id", id);
  if (deleteError) return NextResponse.json({ error: "delete_failed" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
