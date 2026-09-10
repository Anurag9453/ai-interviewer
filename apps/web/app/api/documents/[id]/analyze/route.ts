import { NextResponse } from "next/server";
import {
  analyzeDocument, analyzeResume, DocumentBlueprintSchema, ResumeProfileSchema, createProvider,
} from "@ai/core";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Vercel's default serverless timeout is far shorter than a "thorough" Claude
 * call, and a platform-level kill skips the catch block entirely — so the
 * compensating cleanup below never runs and rows are left orphaned. 60s is the
 * ceiling on Vercel's Hobby plan; on Pro this can go to 300, which is worth doing given this makes one 8k-output-token call.
 */
export const maxDuration = 60;

const RETRYABLE_FROM = new Set(["extracted", "analysis_failed"]);

/**
 * Runs the one Claude call that turns extracted text into a DocumentBlueprint
 * the candidate reviews before any question gets written — the step that
 * keeps this feature from generating a full question pool for a document
 * nobody has confirmed is even the right one.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Fail fast on missing provider config, matching the LiveKit and Razorpay
  // routes: a clear 503 naming only the variable, rather than letting the
  // Anthropic SDK throw "Could not resolve authentication method…" deep in
  // the call and persisting a failure state for what is a config problem.
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ai_not_configured", missingEnv: ["ANTHROPIC_API_KEY"] }, { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  // RLS ("custom_documents: select own") makes this read itself the
  // ownership check — a row belonging to someone else simply isn't returned.
  const { data: doc, error: fetchError } = await supabase
    .from("custom_documents")
    .select("id, filename, status, document_type, extracted_text")
    .eq("id", id)
    .single();
  if (fetchError || !doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!RETRYABLE_FROM.has(doc.status)) {
    return NextResponse.json({ error: "wrong_status", status: doc.status }, { status: 409 });
  }
  if (!doc.extracted_text) {
    return NextResponse.json({ error: "no_extracted_text" }, { status: 409 });
  }

  const service = createServiceClient();
  const isResume = doc.document_type === "resume";
  try {
    const provider = createProvider();

    // A resume gets its own analysis prompt and its own structured shape —
    // roles, projects, claims — because "what does this document teach" and
    // "what has this person done" are different questions. Everything AFTER
    // this point is shared: the profile is mapped to a DocumentBlueprint at
    // generation time, so there is still exactly one question generator.
    if (isResume) {
      const { profile, usage } = await analyzeResume(provider, {
        text: doc.extracted_text, filename: doc.filename,
      });
      const validated = ResumeProfileSchema.parse(profile);

      await service.from("custom_documents").update({
        status: "analyzed", analysis: validated, updated_at: new Date().toISOString(),
      }).eq("id", id);

      console.log(JSON.stringify({
        event: "resume_analyzed", documentId: id, costCents: usage.costCents,
        roles: validated.roles.length, projects: validated.projects.length,
        claims: validated.notableClaims.length,
      }));

      return NextResponse.json({
        documentId: id, status: "analyzed", documentType: "resume", profile: validated,
      });
    }

    const { blueprint, usage } = await analyzeDocument(provider, {
      text: doc.extracted_text, filename: doc.filename,
    });
    // Schema was already validated inside generateStructured(); this parse
    // is a second, cheap belt-and-suspenders check before writing — the
    // blueprint is what the candidate reviews next, so it must be trustworthy.
    const validated = DocumentBlueprintSchema.parse(blueprint);

    await service.from("custom_documents").update({
      status: "analyzed", analysis: validated, updated_at: new Date().toISOString(),
    }).eq("id", id);

    console.log(JSON.stringify({
      event: "document_analyzed", documentId: id,
      costCents: usage.costCents, topics: validated.topics.length,
    }));

    return NextResponse.json({
      documentId: id, status: "analyzed", documentType: "material", blueprint: validated,
    });
  } catch (err) {
    // Raw provider/DB text must not reach the candidate: a missing
    // ANTHROPIC_API_KEY surfaces as the SDK's "Could not resolve
    // authentication method…" string, and Postgres errors carry constraint
    // and column names. The column below is client-readable (documents GET
    // returns error_message), so the generic text is what gets persisted and
    // the real error goes to the server log only.
    const userMessage = isResume
      ? "We couldn't read that resume. Please try again."
      : "We couldn't analyse that document. Please try again.";
    await service.from("custom_documents").update({
      status: "analysis_failed", error_message: userMessage, updated_at: new Date().toISOString(),
    }).eq("id", id);
    console.error("document analysis failed", { documentId: id, isResume, err });
    return NextResponse.json(
      { documentId: id, status: "analysis_failed", message: userMessage }, { status: 502 },
    );
  }
}
