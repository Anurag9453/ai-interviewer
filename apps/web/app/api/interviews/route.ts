import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { mintInterviewToken } from "@/lib/livekit-token";

/**
 * M10: was pinned to the single seeded combination
 * (salesforce_dev/intermediate/15) with z.literal. The plan lookup below
 * already resolves any (category, difficulty, duration) generically, so the
 * literals were the only thing preventing a second category or difficulty
 * from working. Now the seeded content itself is the constraint: a
 * combination with no interview_plans row is rejected as unavailable, and the
 * candidate UI only ever offers combinations that exist.
 */
const BuiltinBodySchema = z.object({
  categoryId: z.string().min(1),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  durationMin: z.number().int().min(5).max(60),
});
/** M7: a candidate's own generated custom-document interview, selected by document id rather than the fixed catalogue combo. */
const CustomBodySchema = z.object({
  documentId: z.string().uuid(),
});
const BodySchema = z.union([BuiltinBodySchema, CustomBodySchema]);

/**
 * Creates an interview and mints a room-scoped LiveKit token.
 *
 * The token is minted server-side, scoped to one room, and short-lived. The
 * browser never holds a LiveKit API secret.
 *
 * Credit consumption and interview creation are two different systems
 * (Postgres and LiveKit) that cannot share one transaction, so this follows
 * the standard reserve-then-compensate pattern: consume the credit first
 * (atomic, race-safe — see the consume_interview_credit migration), and if
 * anything after that fails, refund it. A credit is only ever truly spent
 * once an interview row actually exists.
 */
export async function POST(request: Request) {
  const missing = (
    ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "NEXT_PUBLIC_LIVEKIT_URL"] as const
  ).filter((k) => !process.env[k]);
  if (missing.length > 0) {
    // Explicit, not a fabricated success. The mock path is /interview?mock=1.
    return NextResponse.json(
      { error: "livekit_not_configured", missingEnv: missing }, { status: 503 },
    );
  }

  // Regular, cookie-scoped client — required so auth.uid() resolves inside
  // the RPC. The service-role client below has no user context at all.
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { data: credit, error: creditError } = await supabase
    .rpc("consume_interview_credit")
    .single<{ allowed: boolean; remaining: number }>();
  if (creditError) {
    return NextResponse.json({ error: "credit_check_failed" }, { status: 500 });
  }
  if (!credit.allowed) {
    return NextResponse.json({ error: "no_credits_remaining", remaining: 0 }, { status: 402 });
  }

  const interviewId = crypto.randomUUID();
  const roomName = `iv_${interviewId}`;
  let plan: { id: string; category_id: string; difficulty: string; duration_s: number };

  try {
    // question_pool/interview_plans have no client policy at all (M1 —
    // they hold the grading signals), so every lookup here and the
    // interviews insert both need the service-role client.
    const service = createServiceClient();

    if ("documentId" in parsed.data) {
      // Custom-document interview (M7). Ownership is checked explicitly —
      // the same pattern /api/interviews/[id]/token uses for a table with
      // no client policy — never relying on RLS alone for a service-role read.
      const { data: doc, error: docError } = await service
        .from("custom_documents")
        .select("user_id, status, generated_plan_id")
        .eq("id", parsed.data.documentId)
        .single();
      if (docError || !doc) throw new Error(`no custom_documents row for id=${parsed.data.documentId}`);
      if (doc.user_id !== userId) {
        await supabase.rpc("refund_interview_credit");
        return NextResponse.json({ error: "not_your_document" }, { status: 403 });
      }
      if (doc.status !== "generated" || !doc.generated_plan_id) {
        await supabase.rpc("refund_interview_credit");
        return NextResponse.json({ error: "document_not_ready" }, { status: 409 });
      }
      const { data: planRow, error: planError } = await service
        .from("interview_plans")
        .select("id, category_id, difficulty, duration_s")
        .eq("id", doc.generated_plan_id)
        .single();
      if (planError || !planRow) throw new Error(`no interview_plans row for generated_plan_id=${doc.generated_plan_id}`);
      plan = planRow;
    } else {
      const { data: planRow, error: planError } = await service
        .from("interview_plans")
        .select("id, category_id, difficulty, duration_s")
        .eq("category_id", parsed.data.categoryId)
        .eq("difficulty", parsed.data.difficulty)
        .eq("duration_s", parsed.data.durationMin * 60)
        .single();
      if (planError || !planRow) {
        // An unavailable combination is a normal client-side outcome, not a
        // server fault — refund the reserved credit and say so plainly
        // instead of surfacing a 500.
        await supabase.rpc("refund_interview_credit");
        return NextResponse.json({
          error: "configuration_unavailable",
          message: "That combination isn't available yet.",
        }, { status: 409 });
      }
      plan = planRow;
    }

    const { error: insertError } = await service.from("interviews").insert({
      id: interviewId,
      user_id: userId,
      plan_id: plan.id,
      category_id: plan.category_id,
      difficulty: plan.difficulty,
      duration_s: plan.duration_s,
      status: "configuring",
      room_name: roomName,
    });
    if (insertError) throw insertError;
  } catch (err) {
    await supabase.rpc("refund_interview_credit");
    console.error("interview creation failed after credit consumption; refunded", err);
    return NextResponse.json({ error: "interview_creation_failed" }, { status: 500 });
  }

  // Token minting sits OUTSIDE the block above, so it needs its own
  // compensation: the credit is already consumed and the interviews row
  // already inserted by this point. A throw here (a rotated or malformed
  // LIVEKIT_API_SECRET is the realistic cause) previously escaped as an
  // unhandled 500 and silently burned the candidate's credit with no refund.
  let token: string;
  try {
    token = await mintInterviewToken({
      userId, interviewId, roomName,
      categoryId: plan.category_id, difficulty: plan.difficulty, durationS: plan.duration_s,
    });
  } catch (err) {
    await supabase.rpc("refund_interview_credit");
    // Remove the unusable interview too — without a token it can never be
    // joined, so leaving it would show the candidate a dead row.
    await createServiceClient().from("interviews").delete().eq("id", interviewId);
    console.error("token minting failed after credit consumption; refunded and removed interview", err);
    return NextResponse.json({ error: "interview_creation_failed" }, { status: 500 });
  }

  return NextResponse.json({
    interviewId,
    roomName,
    remainingCredits: credit.remaining,
    livekitUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL,
    token,
  });
}
