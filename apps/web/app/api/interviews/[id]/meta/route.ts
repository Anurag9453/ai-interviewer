import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { describeInterview } from "@/lib/interview-display";

/**
 * Server-authoritative display metadata for one interview.
 *
 * The room used to hardcode "Salesforce Developer / Intermediate / P", which
 * was wrong for every custom interview and actively misleading for a resume
 * one. This is the single source of that display: the room renders what this
 * returns and stores nothing of its own, so the header can never drift from
 * what the interview actually is.
 *
 * Ownership is checked explicitly (same reasoning as the token route): the
 * lookups below need the service-role client, so the user_id match IS the
 * authorization gate — a guessed interview id must reveal nothing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id: interviewId } = await params;
  const service = createServiceClient();

  const { data: interview, error } = await service
    .from("interviews")
    .select("id, user_id, plan_id, category_id, difficulty, duration_s, status")
    .eq("id", interviewId)
    .single();
  if (error || !interview) {
    return NextResponse.json({ error: "interview_not_found" }, { status: 404 });
  }
  if (interview.user_id !== userId) {
    return NextResponse.json({ error: "not_your_interview" }, { status: 403 });
  }

  // Both lookups need the service client: a custom/resume category row is
  // active=false (invisible to the `categories: read active` policy), and
  // interview_plans has no client policy at all.
  const [{ data: category }, { data: document }, { data: plan }] = await Promise.all([
    service.from("categories").select("label").eq("id", interview.category_id).maybeSingle(),
    service
      .from("custom_documents")
      .select("document_type, filename")
      .eq("generated_plan_id", interview.plan_id)
      .maybeSingle(),
    service.from("interview_plans").select("plan").eq("id", interview.plan_id).maybeSingle(),
  ]);

  const descriptor = describeInterview({
    categoryId: interview.category_id,
    categoryLabel: category?.label ?? null,
    documentType: (document?.document_type as "resume" | "material" | undefined) ?? null,
    documentFilename: document?.filename ?? null,
  });

  // The persona is part of the plan jsonb the interviewer actually runs with,
  // so the room shows the real interviewer rather than a hardcoded initial.
  const persona = (plan?.plan as { persona?: { name?: string } } | null)?.persona;
  const personaName = persona?.name?.trim() || "Interviewer";

  return NextResponse.json({
    interviewId: interview.id,
    kind: descriptor.kind,
    title: descriptor.title,
    detail: descriptor.detail ?? null,
    difficulty: interview.difficulty,
    durationS: interview.duration_s,
    status: interview.status,
    personaName,
    personaInitial: personaName.charAt(0).toUpperCase(),
  });
}
