/**
 * Validates the hand-authored question pool against the same rules the
 * generator output would face. Never touches the database.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePlan, type GeneratedPlan, type Question, type Issue } from "@ai/core";
import { SALESFORCE_DEV_TOPICS } from "../salesforce-dev/taxonomy.js";
import { POOL, PLAN } from "../salesforce-dev/pool/index.js";

const DIMENSIONS = [
  "correctness", "relevance", "depth", "clarity", "technical_accuracy", "problem_solving",
];
const DURATION_S = 900;
const CLOSING_RESERVE_S = 120;
const POOL_PER_TOPIC = 5;

const topicIds = [...new Set(POOL.map((q: Question) => q.topicId))];
const topics = SALESFORCE_DEV_TOPICS.filter((t) => topicIds.includes(t.id));

const generated: GeneratedPlan = { plan: PLAN, questions: POOL };

const issues: Issue[] = validatePlan(generated, {
  topics, dimensions: DIMENSIONS, durationS: DURATION_S,
  poolPerTopic: POOL_PER_TOPIC, closingReserveS: CLOSING_RESERVE_S,
});
const errors = issues.filter((i) => i.severity === "error");
const warns = issues.filter((i) => i.severity === "warn");

const kinds = new Map<string, number>();
for (const q of POOL) kinds.set(q.kind, (kinds.get(q.kind) ?? 0) + 1);
const reasoning = POOL.filter((q) =>
  ["scenario", "tradeoff", "debug", "code_reasoning"].includes(q.kind)).length;

console.log(`topics          ${topics.length}`);
console.log(`questions       ${POOL.length}`);
console.log(`kinds           ${[...kinds].map(([k, n]) => `${k}:${n}`).join("  ")}`);
console.log(`reasoning share ${Math.round((reasoning / POOL.length) * 100)}% (require >=70%)`);
console.log(`signals/q       ${(POOL.reduce((s, q) => s + q.mustHear.length, 0) / POOL.length).toFixed(1)}`);
console.log(`\n${errors.length} error(s), ${warns.length} warning(s)`);
for (const i of [...errors, ...warns]) {
  console.log(`  ${i.severity === "error" ? "✗" : "!"} [${i.rule}] ${i.where}: ${i.detail}`);
}
// Only validated content is exported. A failing pool leaves no artifact,
// so nothing downstream can pick up content that did not pass the gate.
if (errors.length === 0) {
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "generated");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, "salesforce_dev.intermediate.900.json");
  writeFileSync(
    outFile,
    JSON.stringify(
      { plan: PLAN, questions: POOL, source: "hand-authored", authoredAt: "2026-09-09" },
      null, 2,
    ),
  );
  console.log(`\nartifact  ${outFile}`);
  console.log(`NOT SEEDED — review, then seeding is a separate explicit step.`);
}

process.exit(errors.length > 0 ? 1 : 0);
