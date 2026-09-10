/**
 * M1 plan + question-pool generator.
 *
 * Generates, validates, writes JSON to content/generated/, and prints a
 * review summary. It NEVER touches the database — seeding is a separate,
 * explicitly-invoked step that runs only after a human approves the summary.
 *
 *   ANTHROPIC_API_KEY=... pnpm --filter @ai/content generate
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  InterviewPlanSchema,
  QuestionSchema,
  buildPlanPrompt,
  buildQuestionPoolPrompt,
  createProvider,
  validatePlan,
  ZERO_USAGE,
  addUsage,
  PLAN_PROMPT_VERSION,
  type GeneratedPlan,
  type Question,
  type Usage,
} from "@ai/core";
import { SALESFORCE_DEV_TOPICS } from "../salesforce-dev/taxonomy.js";
import { BASE_REF, resolveAnchors } from "../salesforce-dev/anchors.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// MVP scope: Salesforce Developer / Intermediate / 15 minutes.
const CATEGORY_ID = "salesforce_dev";
const CATEGORY_LABEL = "Salesforce Developer";
const DIFFICULTY = "intermediate" as const;
const MODE = "depth" as const;
const DURATION_S = 900;
const CLOSING_RESERVE_S = 120;
const POOL_PER_TOPIC = 5;

// Six highest-importance depth-ready topics. A 15-minute depth interview asks
// 3-4 questions, so this gives the selection policy real choice across repeat
// sessions without generating a pool nobody reaches.
const TOPIC_IDS = [
  "sfdev.governor_limits",
  "sfdev.bulkification",
  "sfdev.async_apex",
  "sfdev.soql_relationships",
  "sfdev.testing",
  "sfdev.security_sharing",
];

const DIMENSIONS = [
  "correctness", "relevance", "depth", "clarity", "technical_accuracy", "problem_solving",
];

const QuestionBatchSchema = z.object({ questions: z.array(QuestionSchema).min(1) });

async function main() {
  const topics = TOPIC_IDS.map((id) => {
    const t = SALESFORCE_DEV_TOPICS.find((x) => x.id === id);
    if (!t) throw new Error(`topic "${id}" not in taxonomy`);
    return t;
  });
  const anchors = resolveAnchors(BASE_REF, DIFFICULTY);
  if (anchors.length !== DIMENSIONS.length) {
    throw new Error(`expected ${DIMENSIONS.length} anchor rows, got ${anchors.length}`);
  }

  // --print-prompt renders the prompts and exits, so the instrument can be
  // reviewed without spending a model call.
  const printOnly = process.argv.includes("--print-prompt");
  const shared = {
    categoryLabel: CATEGORY_LABEL, difficulty: DIFFICULTY, mode: MODE,
    durationS: DURATION_S, dimensions: DIMENSIONS, anchors, poolPerTopic: POOL_PER_TOPIC,
  };
  if (printOnly) {
    console.log(buildPlanPrompt({ ...shared, topics }));
    console.log(`\n${"=".repeat(72)}\n`);
    console.log(buildQuestionPoolPrompt(topics[1]!, shared));
    return;
  }

  const provider = createProvider();
  let usage: Usage = ZERO_USAGE;

  // ── phase A: plan skeleton ──────────────────────────────────────────
  console.log(`▸ plan skeleton (${topics.length} topics)`);
  const planRes = await provider.generateStructured({
    userPrompt: buildPlanPrompt({ ...shared, topics }),
    schema: InterviewPlanSchema,
    quality: "thorough",
    maxOutputTokens: 16_000,
  });
  usage = addUsage(usage, planRes.usage);

  // ── phase B: one call per topic, retried once ───────────────────────
  const questions: Question[] = [];
  const failed: string[] = [];
  for (const topic of topics) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await provider.generateStructured({
          userPrompt: buildQuestionPoolPrompt(topic, shared),
          schema: QuestionBatchSchema,
          quality: "thorough",
          maxOutputTokens: 16_000,
        });
        usage = addUsage(usage, res.usage);
        questions.push(...res.value.questions);
        console.log(`  ✓ ${topic.id} — ${res.value.questions.length} questions`);
        break;
      } catch (err) {
        if (attempt === 2) {
          failed.push(topic.id);
          console.error(`  ✗ ${topic.id} — ${String(err)}`);
        }
      }
    }
  }

  const generated: GeneratedPlan = {
    plan: { ...planRes.value, planKey: planKeyFor(), promptVersion: PLAN_PROMPT_VERSION },
    questions,
  };

  // ── validate ────────────────────────────────────────────────────────
  const issues = validatePlan(generated, {
    topics, dimensions: DIMENSIONS, durationS: DURATION_S,
    poolPerTopic: POOL_PER_TOPIC, closingReserveS: CLOSING_RESERVE_S,
  });
  const errors = issues.filter((i) => i.severity === "error");
  const warns = issues.filter((i) => i.severity === "warn");

  const outDir = resolve(HERE, "..", "generated");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `${CATEGORY_ID}.${DIFFICULTY}.${DURATION_S}.json`);
  writeFileSync(outFile, JSON.stringify({ generated, issues, usage }, null, 2));

  printSummary(generated, errors, warns, usage, failed, outFile);
  process.exit(errors.length > 0 || failed.length > 0 ? 1 : 0);
}

function planKeyFor(): string {
  return [CATEGORY_ID, DIFFICULTY, MODE, DURATION_S, TOPIC_IDS.join("+"), PLAN_PROMPT_VERSION].join("|");
}

function printSummary(
  g: GeneratedPlan,
  errors: ReturnType<typeof validatePlan>,
  warns: ReturnType<typeof validatePlan>,
  usage: Usage,
  failed: string[],
  outFile: string,
) {
  const kinds = new Map<string, number>();
  for (const q of g.questions) kinds.set(q.kind, (kinds.get(q.kind) ?? 0) + 1);
  const reasoning = g.questions.filter((q) =>
    ["scenario", "tradeoff", "debug", "code_reasoning"].includes(q.kind),
  ).length;

  console.log(`\n${"─".repeat(64)}`);
  console.log(`PLAN SUMMARY — NOT SEEDED`);
  console.log(`${"─".repeat(64)}`);
  console.log(`persona          ${g.plan.persona.name} — ${g.plan.persona.style.slice(0, 48)}…`);
  console.log(`sections         ${g.plan.sections.length} · budgets ${g.plan.sections.map((s) => `${s.budgetS}s`).join(" + ")}`);
  console.log(`questions        ${g.questions.length}`);
  console.log(`kinds            ${[...kinds].map(([k, n]) => `${k}:${n}`).join("  ")}`);
  console.log(`reasoning share  ${Math.round((reasoning / g.questions.length) * 100)}% (require ≥70%)`);
  console.log(`signals/question ${(g.questions.reduce((s, q) => s + q.mustHear.length, 0) / g.questions.length).toFixed(1)}`);
  console.log(`dimension weights`);
  for (const [d, w] of Object.entries(g.plan.dimensionWeights)) {
    console.log(`                 ${d.padEnd(20)} ${w.toFixed(2)}`);
  }
  console.log(`cost             $${(usage.costCents / 100).toFixed(3)} (${usage.inputTokens} in / ${usage.outputTokens} out)`);
  if (failed.length) console.log(`FAILED TOPICS    ${failed.join(", ")}`);
  console.log(`\nvalidation       ${errors.length} error(s), ${warns.length} warning(s)`);
  for (const i of [...errors, ...warns].slice(0, 30)) {
    console.log(`  ${i.severity === "error" ? "✗" : "!"} [${i.rule}] ${i.where}: ${i.detail}`);
  }
  console.log(`\nwritten to       ${outFile}`);
  console.log(errors.length || failed.length
    ? `\nNOT READY TO SEED — fix errors and regenerate.`
    : `\nReady for review. Seeding is a separate, explicitly-invoked step.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
