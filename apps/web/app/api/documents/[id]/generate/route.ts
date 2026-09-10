import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createProvider, generateDocumentPlan, DocumentBlueprintSchema, ResumeProfileSchema,
  ResumeEmphasisSchema, DifficultySchema, resumeProfileToBlueprint,
  DIMENSIONS, type DocumentBlueprint,
} from "@ai/core";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { MAX_QUESTION_POOL_SIZE, MIN_QUESTION_POOL_SIZE } from "@/lib/document-limits";

/**
 * Vercel's default serverless timeout is far shorter than a "thorough" Claude
 * call, and a platform-level kill skips the catch block entirely — so the
 * compensating cleanup below never runs and rows are left orphaned. 60s is the
 * ceiling on Vercel's Hobby plan; on Pro this can go to 300, which this route likely needs — it makes TWO thorough calls (4k + 16k output tokens).
 */
export const maxDuration = 60;

const RETRYABLE_FROM = new Set(["analyzed", "generation_failed"]);
const DEFAULT_DURATION_S = 900;
const CLOSING_RESERVE_S = 120;

/**
 * Configuration the candidate chooses before generation. All optional so the
 * M7 material flow, which posts no body at all, keeps working unchanged.
 */
const ConfigSchema = z.object({
  difficulty: DifficultySchema.optional(),
  durationS: z.union([z.literal(600), z.literal(900), z.literal(1200), z.literal(1800)]).optional(),
  emphasis: ResumeEmphasisSchema.optional(),
});

/**
 * Converts a reviewed blueprint into a real, persisted interview_plans +
 * question_pool set AdaptiveBrain can run against unchanged — see
 * document-plan-generator.ts for why this reuses the exact seeded-content
 * schema and validator rather than a separate "custom" content model.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const { data: doc, error: fetchError } = await supabase
    .from("custom_documents")
    .select("id, filename, status, document_type, analysis")
    .eq("id", id)
    .single();
  if (fetchError || !doc) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!RETRYABLE_FROM.has(doc.status)) {
    return NextResponse.json({ error: "wrong_status", status: doc.status }, { status: 409 });
  }

  const config = ConfigSchema.safeParse(await request.json().catch(() => ({})));
  if (!config.success) {
    return NextResponse.json({ error: "invalid_config" }, { status: 400 });
  }
  const durationS = config.data.durationS ?? DEFAULT_DURATION_S;

  // Resume and material diverge only here, in how a stored analysis becomes a
  // blueprint. Everything below is the shared M7 path.
  let blueprint: DocumentBlueprint;
  if (doc.document_type === "resume") {
    const profileParse = ResumeProfileSchema.safeParse(doc.analysis);
    if (!profileParse.success) {
      return NextResponse.json({ error: "no_valid_analysis" }, { status: 409 });
    }
    const mapped = resumeProfileToBlueprint(profileParse.data, {
      emphasis: config.data.emphasis ?? "mixed",
    });
    if (!mapped.ok) {
      // A resume with nothing concrete in it can't ground real questions.
      // Saying so beats generating plausible questions about nothing.
      await createServiceClient().from("custom_documents").update({
        status: "generation_failed", error_message: mapped.detail,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      return NextResponse.json(
        { documentId: id, status: "generation_failed", error: mapped.reason, message: mapped.detail },
        { status: 409 },
      );
    }
    blueprint = mapped.blueprint;
  } else {
    const blueprintParse = DocumentBlueprintSchema.safeParse(doc.analysis);
    if (!blueprintParse.success) {
      return NextResponse.json({ error: "no_valid_analysis" }, { status: 409 });
    }
    blueprint = blueprintParse.data;
  }

  // generateDocumentPlan reads difficulty off the blueprint, so a candidate's
  // choice is applied by overriding the model's suggestion — there is no
  // separate difficulty input to pass.
  if (config.data.difficulty) {
    blueprint = { ...blueprint, suggestedDifficulty: config.data.difficulty };
  }

  const service = createServiceClient();
  const categoryId = `custom_${id.replace(/-/g, "").slice(0, 12)}`;
  const poolSize = Math.min(
    MAX_QUESTION_POOL_SIZE,
    Math.max(MIN_QUESTION_POOL_SIZE, blueprint.topics.length * 2),
  );

  // Declared outside the try block so the catch block's compensating
  // cleanup can see exactly how far the (non-transactional) writes below
  // got, regardless of which one threw.
  let categoryCreated = false;
  let planId: string | null = null;

  try {
    const provider = createProvider();
    const result = await generateDocumentPlan({
      provider, blueprint, categoryId,
      planKey: `${categoryId}.${blueprint.suggestedDifficulty}.${durationS}`,
      durationS, closingReserveS: CLOSING_RESERVE_S,
      dimensions: [...DIMENSIONS], poolSize, promptVersion: "document-v1",
    });

    const errors = result.issues.filter((i) => i.severity === "error");
    if (errors.length > 0) {
      // The validator's rule names and details are internal diagnostics
      // ("signal-has-number", "unknown-topic", …) — useful in a log, meaningless
      // and slightly alarming to a candidate. Both the persisted column (which
      // the documents GET returns) and the response body now carry a plain
      // explanation; the full issue list goes to the server log.
      console.error("document plan generation failed validation", {
        documentId: id, issueCount: errors.length, issues: result.issues,
      });
      const userMessage =
        "The questions generated from this document didn't meet our quality bar. Please try again.";
      await service.from("custom_documents").update({
        status: "generation_failed", error_message: userMessage,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      return NextResponse.json(
        { documentId: id, status: "generation_failed", message: userMessage }, { status: 502 },
      );
    }

    // categories/topics/interview_plans/question_pool are 4 separate
    // PostgREST requests, not one transaction — there is no single ROLLBACK
    // spanning them, so a failure partway through is a real possibility, not
    // a hypothetical. `categoryCreated`/`planId` (declared above the try
    // block) track how far we got so the catch block below can compensate
    // rather than leave orphaned rows: deleting the category cascades to
    // topics (on delete cascade), and deleting the plan cascades to
    // question_pool — both already defined that way in the M0 schema — so
    // cleanup here only ever needs at most those two deletes.

    // Category is created inactive — it never appears in the public
    // "browse categories" query (`categories: read active` / active=true),
    // the only route to it is custom_documents.generated_plan_id, which is
    // itself RLS-scoped to this document's owner.
    const { error: categoryError } = await service.from("categories").insert({
      id: categoryId, label: blueprint.subject.slice(0, 100),
      dimensions: DIMENSIONS, active: false, sort: 0,
    });
    if (categoryError) throw categoryError;
    categoryCreated = true;

    const { error: topicsError } = await service.from("topics").insert(
      result.topics.map((t) => ({
        id: t.id, category_id: categoryId, label: t.label, importance: t.importance,
        depth_ready: t.depthReady, prereqs: t.prereqs, aliases: t.aliases, rubric_ref: t.rubricRef,
      })),
    );
    if (topicsError) throw topicsError;

    const { data: planRow, error: planError } = await service.from("interview_plans").insert({
      plan_key: result.generated.plan.planKey, category_id: categoryId,
      difficulty: result.generated.plan.difficulty, mode: result.generated.plan.mode,
      duration_s: result.generated.plan.durationS,
      plan: {
        persona: result.generated.plan.persona, sections: result.generated.plan.sections,
        dimensionWeights: result.generated.plan.dimensionWeights,
      },
      prompt_version: result.generated.plan.promptVersion, validated_at: new Date().toISOString(),
    }).select("id").single();
    if (planError || !planRow) throw planError ?? new Error("interview_plans insert returned no row");
    planId = planRow.id;

    const { error: poolError } = await service.from("question_pool").insert(
      result.generated.questions.map((q) => ({
        plan_id: planRow.id, external_id: q.id, topic_id: q.topicId, text: q.text, kind: q.kind,
        scores: q.scores, must_hear: q.mustHear, answer_key: q.answerKey,
        max_probes: q.maxProbes, hard_time_s: q.hardTimeS, difficulty_band: q.difficultyBand,
      })),
    );
    if (poolError) throw poolError;

    await service.from("custom_documents").update({
      status: "generated", category_id: categoryId, generated_plan_id: planRow.id,
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    console.log(JSON.stringify({
      event: "document_plan_generated", documentId: id, categoryId, planId: planRow.id,
      questionCount: result.generated.questions.length, costCents: result.usage.costCents,
    }));

    return NextResponse.json({
      documentId: id, status: "generated", categoryId, planId: planRow.id,
      questionCount: result.generated.questions.length,
    });
  } catch (err) {
    // Same reasoning as the analyze route: never hand raw provider or
    // Postgres text to the candidate, and never persist it into the
    // client-readable error_message column.
    const message = "We couldn't build an interview from this document. Please try again.";
    await compensateFailedGeneration(service, { categoryId, planId, categoryCreated });
    await service.from("custom_documents").update({
      status: "generation_failed", error_message: message, updated_at: new Date().toISOString(),
    }).eq("id", id);
    console.error("document plan generation failed", err);
    return NextResponse.json({ documentId: id, status: "generation_failed", message }, { status: 502 });
  }
}

async function compensateFailedGeneration(
  service: ReturnType<typeof createServiceClient>,
  state: { categoryId: string; planId: string | null; categoryCreated: boolean },
): Promise<void> {
  try {
    // Deleting the plan first: if it's already gone (never got created),
    // this is a harmless no-op match-zero-rows delete.
    if (state.planId) await service.from("interview_plans").delete().eq("id", state.planId);
    if (state.categoryCreated) await service.from("categories").delete().eq("id", state.categoryId);
  } catch (err) {
    // Best-effort compensation — logged, not thrown, so a cleanup failure
    // never masks the original generation error the caller already has.
    console.error("compensating cleanup after failed generation also failed — manual cleanup may be needed", {
      categoryId: state.categoryId, planId: state.planId, err,
    });
  }
}
