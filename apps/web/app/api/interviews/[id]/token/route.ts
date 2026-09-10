import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { mintInterviewToken } from "@/lib/livekit-token";

const TERMINAL_STATUSES = new Set(["complete", "abandoned"]);

/**
 * Reissues a LiveKit token for an EXISTING interview — used on first
 * connect and on any reconnect (browser refresh, brief network drop). Never
 * consumes a credit; that only happens once, at creation (POST /api/interviews).
 *
 * Ownership is checked explicitly rather than relying on RLS alone: this
 * route uses the service-role client (interviews has no client SELECT
 * policy gap here, but plan_id/category lookups do need it), so the
 * user_id match below IS the authorization check, not a formality.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const missing = (
    ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "NEXT_PUBLIC_LIVEKIT_URL"] as const
  ).filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return NextResponse.json({ error: "livekit_not_configured", missingEnv: missing }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id: interviewId } = await params;

  const service = createServiceClient();
  const { data: interview, error } = await service
    .from("interviews")
    .select("id, user_id, room_name, category_id, difficulty, duration_s, status")
    .eq("id", interviewId)
    .single();

  if (error || !interview) {
    return NextResponse.json({ error: "interview_not_found" }, { status: 404 });
  }
  // Ownership check — the actual authorization gate. A candidate reusing a
  // guessed or leaked interview id must never receive a token for it.
  if (interview.user_id !== userId) {
    return NextResponse.json({ error: "not_your_interview" }, { status: 403 });
  }
  if (TERMINAL_STATUSES.has(interview.status)) {
    return NextResponse.json({ error: "interview_already_ended", status: interview.status }, { status: 409 });
  }

  const token = await mintInterviewToken({
    userId,
    interviewId: interview.id,
    roomName: interview.room_name!,
    categoryId: interview.category_id,
    difficulty: interview.difficulty,
    durationS: interview.duration_s,
  });

  return NextResponse.json({
    interviewId: interview.id,
    roomName: interview.room_name,
    livekitUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL,
    token,
  });
}
