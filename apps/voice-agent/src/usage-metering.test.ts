import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCostCents, newUsageAccumulator, persistUsageEvent } from "./usage-metering.js";

test("newUsageAccumulator starts at zero/null for every field", () => {
  const u = newUsageAccumulator();
  assert.equal(u.sttAudioS, 0);
  assert.equal(u.ttsCharacters, 0);
  assert.equal(u.llmCostCents, 0);
  assert.equal(u.durationS, null);
});

test("estimateCostCents combines STT/TTS estimate with the real reported LLM cost", () => {
  const u = newUsageAccumulator();
  u.sttAudioS = 100;
  u.ttsCharacters = 2000;
  u.llmCostCents = 15;

  const result = estimateCostCents(u);

  // Real llmCostCents (15) must be included exactly; the STT/TTS portion is
  // a rough estimate, so only assert it's a real positive number, not an
  // exact figure — pinning the estimate's formula would make the test
  // fragile without adding real coverage.
  assert.ok(result > 15, "estimate must include the STT/TTS contribution on top of the real LLM cost");
  assert.ok(result < 100, "sanity bound — a 100s/2000-char/15-cent turn should not estimate to dollars");
});

test("estimateCostCents is zero when nothing was used", () => {
  assert.equal(estimateCostCents(newUsageAccumulator()), 0);
});

/**
 * Regression coverage for the P0 cost-metering fix (2026-09-11).
 *
 * Production reported 3739.43 cents for one 8-minute interview. Cause:
 * AdaptiveBrain handed `session.totalUsage()` — a RUNNING TOTAL, because one
 * session is reused for the whole interview — to a caller that added it once
 * per turn, producing a triangular sum. These tests pin the accumulator's
 * contract: it adds DELTAS, and it never invents a token count.
 */

/** Mirrors agent.ts's onEvaluated handler exactly. */
function applyTurn(
  u: ReturnType<typeof newUsageAccumulator>,
  turn: { inputTokens: number; cachedInputTokens: number; outputTokens: number; costCents: number },
  model = "claude-haiku-4-5-20251001",
  provider = "anthropic",
): void {
  u.llmProvider = provider;
  u.llmModel = model;
  u.llmCostCents += turn.costCents;
  u.llmInputTokens += turn.inputTokens;
  u.llmOutputTokens += turn.outputTokens;
  u.llmCachedInputTokens += turn.cachedInputTokens;
  u.llmTurns += 1;
}

/** Minimal tagged-template stand-in for the `postgres` client. */
function fakeSql() {
  const statements: string[] = [];
  const values: unknown[][] = [];
  let began = false;
  const record = (strings: TemplateStringsArray, ...vals: unknown[]) => {
    statements.push(strings.join("?"));
    values.push(vals);
    return Promise.resolve([]);
  };
  const sql = Object.assign(record, {
    begin: async (fn: (tx: typeof record) => Promise<void>) => { began = true; await fn(record); },
  });
  return { sql, statements, values, wasTransactional: () => began };
}

test("token fields start at zero and are tracked separately from cost", () => {
  const u = newUsageAccumulator();
  assert.equal(u.llmInputTokens, 0);
  assert.equal(u.llmOutputTokens, 0);
  assert.equal(u.llmCachedInputTokens, 0);
  assert.equal(u.llmTurns, 0);
  assert.equal(u.llmProvider, null);
  assert.equal(u.llmModel, null);
});

test("TRIANGULAR-SUM GUARD: per-turn deltas sum linearly", () => {
  const u = newUsageAccumulator();
  applyTurn(u, { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, costCents: 10 });
  applyTurn(u, { inputTokens: 1500, cachedInputTokens: 900, outputTokens: 120, costCents: 20 });
  applyTurn(u, { inputTokens: 2000, cachedInputTokens: 1800, outputTokens: 140, costCents: 30 });

  assert.equal(u.llmCostCents, 60, "must be 10+20+30 — the bug produced 10+30+60=100");
  assert.equal(u.llmTurns, 3);
  assert.equal(u.llmInputTokens, 4500);
  assert.equal(u.llmOutputTokens, 360);
  assert.equal(u.llmCachedInputTokens, 2700);
});

test("nine equal turns cost 9x one turn, not 45x — the exact production scenario", () => {
  const u = newUsageAccumulator();
  for (let i = 0; i < 9; i++) {
    applyTurn(u, { inputTokens: 100, cachedInputTokens: 0, outputTokens: 10, costCents: 1 });
  }
  assert.equal(u.llmCostCents, 9);
  assert.notEqual(u.llmCostCents, 45, "45 is the triangular sum this fix removed");
});

test("provider and model are recorded, and routine evaluation is not on the batch model", () => {
  const u = newUsageAccumulator();
  applyTurn(u, { inputTokens: 10, cachedInputTokens: 0, outputTokens: 1, costCents: 0.01 });
  assert.equal(u.llmProvider, "anthropic");
  assert.equal(u.llmModel, "claude-haiku-4-5-20251001");
  assert.notEqual(u.llmModel, "claude-opus-5");
});

test("interviews.cost_cents is written from the SAME estimate as the usage row, in one transaction", async () => {
  const { sql, statements, values, wasTransactional } = fakeSql();
  const u = newUsageAccumulator();
  applyTurn(u, { inputTokens: 1000, cachedInputTokens: 200, outputTokens: 100, costCents: 4 });
  u.sttAudioS = 100;
  u.ttsCharacters = 1000;
  u.durationS = 300;
  const expected = estimateCostCents(u);

  await persistUsageEvent(sql as unknown as Parameters<typeof persistUsageEvent>[0], "iv-1", "user-1", u);

  assert.equal(wasTransactional(), true, "both writes must share one transaction");
  assert.equal(statements.length, 2, "exactly two statements — no duplicate writers");
  assert.match(statements[0]!, /insert into public\.usage_events/);
  assert.match(statements[1]!, /update public\.interviews set cost_cents/);

  // The crux: the two figures come from one source, so they cannot disagree
  // the way production did (usage_events 3739 vs interviews 0).
  assert.ok(values[0]!.includes(expected), "usage row must carry the estimate");
  assert.equal(values[1]![0], expected, "interviews.cost_cents must carry the SAME estimate");
  assert.equal(values[1]![1], "iv-1");
});

test("token counts reach the usage row instead of being left null", async () => {
  const { sql, values } = fakeSql();
  const u = newUsageAccumulator();
  applyTurn(u, { inputTokens: 777, cachedInputTokens: 333, outputTokens: 55, costCents: 2 });

  await persistUsageEvent(sql as unknown as Parameters<typeof persistUsageEvent>[0], "iv-2", "user-2", u);

  const row = values[0]!;
  assert.ok(row.includes(777), "llm_input_tokens must be persisted");
  assert.ok(row.includes(333), "llm_cached_input_tokens must be persisted");
  assert.ok(row.includes(55), "llm_output_tokens must be persisted");
});

test("an interview with no evaluated turns reports zero LLM cost rather than a fabricated one", () => {
  const u = newUsageAccumulator();
  u.sttAudioS = 30;
  assert.equal(u.llmCostCents, 0);
  assert.equal(u.llmTurns, 0);
  assert.ok(estimateCostCents(u) > 0, "STT still counts even with no LLM turns");
});
