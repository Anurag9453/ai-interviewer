/**
 * Manual verification script for the M7 document pipeline — real Claude
 * calls (analysis + plan/question generation), no DB writes, no HTTP, no
 * auth. Costs a small real amount (~35-40 cents per run) but touches
 * nothing credit-gated. Not part of the app; run manually when changing
 * document-analyzer.ts / document-plan-generator.ts / document-prompts.ts,
 * mirroring apps/voice-agent/src/_verify-*.ts's role for the voice path.
 *
 *   pnpm --filter @ai/web exec tsx _verify-doc-pipeline.ts
 */
import { readFileSync } from "node:fs";
import {
  analyzeDocument, generateDocumentPlan, createProvider, DIMENSIONS,
} from "@ai/core";
import { normalizeAndCapText } from "./lib/document-limits";

function loadDotEnv(path: string) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    process.env[k] = v;
  }
}

async function main() {
  loadDotEnv("../../.env");

  const sampleDoc = `
Idempotent Payment Processing — Engineering Design Note

Our payments service must guarantee that a client retrying a charge request
after a network timeout never results in the customer being charged twice.

Approach: every charge request carries a client-generated Idempotency-Key
header. On first receipt, the server executes the charge and stores the
result keyed by (merchant_id, idempotency_key) with a 24-hour expiry. If the
same key arrives again within that window, the server returns the stored
result without re-executing the charge.

A subtlety: the key must be scoped per-merchant, not globally, because two
different merchants could independently generate the same key value. Another
subtlety: if a request with a given key is still IN FLIGHT when a duplicate
arrives, the duplicate must wait for the first to finish rather than racing
it — otherwise both could execute the charge before either result is stored.

We considered using the raw request body hash as an implicit idempotency key
instead of a client-supplied header, but rejected it: a client that legitimately
wants to charge the same amount twice (e.g. two separate purchases of the same
price) would be incorrectly deduplicated.
`.trim();

  const normalized = normalizeAndCapText(sampleDoc);
  console.log("=== extraction ===");
  console.log("charCount:", normalized.charCount, "truncated:", normalized.truncated);

  const provider = createProvider();

  console.log("\n=== phase 1: analysis (REAL Claude call) ===");
  const { blueprint, usage: analysisUsage } = await analyzeDocument(provider, {
    text: normalized.text, filename: "idempotent-payments.txt",
  });
  console.log("subject:", blueprint.subject);
  console.log("domain:", blueprint.domain);
  console.log("topics:", blueprint.topics.map((t) => t.label));
  console.log("suggestedDifficulty:", blueprint.suggestedDifficulty);
  console.log("candidateFacts:", blueprint.candidateFacts.length);
  console.log("analysis cost (cents):", analysisUsage.costCents);

  console.log("\n=== phase 2: plan + question generation (REAL Claude calls) ===");
  const categoryId = "custom_verify" + Date.now().toString(36).slice(-6);
  const result = await generateDocumentPlan({
    provider, blueprint, categoryId,
    planKey: `${categoryId}.${blueprint.suggestedDifficulty}.900`,
    durationS: 900, closingReserveS: 120,
    dimensions: [...DIMENSIONS], poolSize: 4, promptVersion: "document-v1-verify",
  });

  console.log("questions generated:", result.generated.questions.length);
  for (const q of result.generated.questions) {
    console.log(`  - [${q.kind}] ${q.text}`);
    console.log(`    scores: ${q.scores.join(", ")}  mustHear: ${q.mustHear.length}`);
  }
  console.log("dimensionWeights:", result.generated.plan.dimensionWeights);
  console.log("sections:", result.generated.plan.sections.map((s) => `${s.title} (${s.budgetS}s)`));

  const errors = result.issues.filter((i) => i.severity === "error");
  const warnings = result.issues.filter((i) => i.severity === "warn");
  console.log("\n=== validatePlan result ===");
  console.log("errors:", errors.length, JSON.stringify(errors, null, 2));
  console.log("warnings:", warnings.length, JSON.stringify(warnings, null, 2));
  console.log("generation cost (cents):", result.usage.costCents);

  console.log("\n=== TOTAL COST (cents):", analysisUsage.costCents + result.usage.costCents, "===");
}

main().catch((err) => { console.error("VERIFICATION FAILED:", err); process.exitCode = 1; });
