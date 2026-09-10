/**
 * Seeds the validated artifact into Postgres.
 *
 * DRY RUN IS THE DEFAULT. Nothing is written without --confirm, so this
 * cannot seed by accident.
 *
 *   pnpm --filter @ai/content seed              # report only, no writes
 *   pnpm --filter @ai/content seed -- --confirm # write, in one transaction
 *
 * Requires DATABASE_URL. Runs as the owning role because it writes reference
 * tables that are deliberately unreachable from any client.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { GeneratedPlanSchema, validatePlan, type Issue } from "@ai/core";
import { SALESFORCE_DEV_TOPICS } from "../salesforce-dev/taxonomy.js";
import { BASE_REF, INTERMEDIATE_ANCHORS } from "../salesforce-dev/anchors.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = resolve(HERE, "..", "generated", "salesforce_dev.intermediate.900.json");
const CONFIRM = process.argv.includes("--confirm");

const DIMENSIONS = [
  "correctness", "relevance", "depth", "clarity", "technical_accuracy", "problem_solving",
];

async function main() {
  // ── 1. load and re-validate. The artifact is the source of truth, and it
  //       is re-checked here so a hand-edited file cannot reach the database.
  const raw = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  const parsed = GeneratedPlanSchema.safeParse({ plan: raw.plan, questions: raw.questions });
  if (!parsed.success) {
    fail(`artifact failed schema validation:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  const generated = parsed.data;

  const topicIds = [...new Set(generated.questions.map((q) => q.topicId))];
  const topics = SALESFORCE_DEV_TOPICS.filter((t) => topicIds.includes(t.id));

  const issues: Issue[] = validatePlan(generated, {
    topics, dimensions: DIMENSIONS, durationS: generated.plan.durationS,
    poolPerTopic: 5, closingReserveS: 120,
  });
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    fail(`artifact has ${errors.length} validation error(s) — refusing to seed:\n` +
      errors.map((e) => `  ✗ [${e.rule}] ${e.where}: ${e.detail}`).join("\n"));
  }

  const anchors = INTERMEDIATE_ANCHORS.filter((a) => a.rubricRef === BASE_REF);

  console.log("would seed:");
  console.log(`  topics            ${SALESFORCE_DEV_TOPICS.length}  (full taxonomy)`);
  console.log(`  rubric_anchors    ${anchors.length}  (intermediate, 1/3/5/7/9)`);
  console.log(`  interview_plans   1  (${generated.plan.planKey})`);
  console.log(`  question_pool     ${generated.questions.length}`);

  if (!CONFIRM) {
    console.log("\nDRY RUN — nothing written. Re-run with --confirm to seed.");
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    // One transaction: either the whole content set lands or none of it does.
    // A half-seeded plan whose pool is missing would produce interviews that
    // silently run out of questions.
    await sql.begin(async (tx) => {
      for (const t of SALESFORCE_DEV_TOPICS) {
        await tx`
          insert into public.topics
            (id, category_id, label, importance, depth_ready, difficulties, prereqs, aliases, rubric_ref)
          values (${t.id}, ${"salesforce_dev"}, ${t.label}, ${t.importance}, ${t.depthReady},
                  ${sql.array(["beginner", "intermediate", "advanced"])},
                  ${sql.array(t.prereqs)}, ${sql.array(t.aliases)}, ${BASE_REF})
          on conflict (id) do update set
            label = excluded.label, importance = excluded.importance,
            depth_ready = excluded.depth_ready, prereqs = excluded.prereqs,
            aliases = excluded.aliases, rubric_ref = excluded.rubric_ref`;
      }

      for (const a of anchors) {
        await tx`
          insert into public.rubric_anchors
            (rubric_ref, difficulty, dimension, anchor_1, anchor_3, anchor_5, anchor_7, anchor_9)
          values (${a.rubricRef}, ${a.difficulty}, ${a.dimension},
                  ${a.anchor1}, ${a.anchor3}, ${a.anchor5}, ${a.anchor7}, ${a.anchor9})
          on conflict (rubric_ref, difficulty, dimension) do update set
            anchor_1 = excluded.anchor_1, anchor_3 = excluded.anchor_3,
            anchor_5 = excluded.anchor_5, anchor_7 = excluded.anchor_7,
            anchor_9 = excluded.anchor_9`;
      }

      const p = generated.plan;
      const [planRow] = await tx<{ id: string }[]>`
        insert into public.interview_plans
          (plan_key, category_id, difficulty, mode, duration_s, plan, prompt_version, validated_at)
        values (${p.planKey}, ${p.categoryId}, ${p.difficulty}, ${p.mode}, ${p.durationS},
                ${tx.json({ persona: p.persona, sections: p.sections, dimensionWeights: p.dimensionWeights })},
                ${p.promptVersion}, now())
        on conflict (plan_key) do update set
          plan = excluded.plan, prompt_version = excluded.prompt_version,
          duration_s = excluded.duration_s, validated_at = now()
        returning id`;
      if (!planRow) throw new Error("plan upsert returned no row");

      for (const q of generated.questions) {
        // Upsert on external_id so uuids — and therefore seen_questions —
        // survive a reseed.
        await tx`
          insert into public.question_pool
            (plan_id, external_id, topic_id, text, kind, scores, must_hear,
             answer_key, max_probes, hard_time_s, difficulty_band)
          values (${planRow.id}, ${q.id}, ${q.topicId}, ${q.text}, ${q.kind},
                  ${sql.array(q.scores)}, ${tx.json(q.mustHear)}, ${tx.json(q.answerKey)},
                  ${q.maxProbes}, ${q.hardTimeS}, ${q.difficultyBand})
          on conflict (plan_id, external_id) do update set
            text = excluded.text, kind = excluded.kind, scores = excluded.scores,
            must_hear = excluded.must_hear, answer_key = excluded.answer_key,
            max_probes = excluded.max_probes, hard_time_s = excluded.hard_time_s,
            difficulty_band = excluded.difficulty_band`;
      }

      const counted = await tx<{ count: string }[]>`
        select count(*)::text from public.question_pool where plan_id = ${planRow.id}`;
      const count = counted[0]?.count ?? "0";
      console.log(`\nseeded. plan ${planRow.id} now has ${count} questions.`);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
