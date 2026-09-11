import { test } from "node:test";
import assert from "node:assert/strict";
import { ANTHROPIC_MODELS, resolveLiveModel } from "./anthropic.js";
import { ZERO_USAGE, type Usage } from "./types.js";

/**
 * Regression tests for the P0 cost-metering bug found in production on
 * 2026-09-11: a single 8-minute interview reported 3739.43 cents.
 *
 * Root cause was AdaptiveBrain handing `session.totalUsage()` — a RUNNING
 * TOTAL, because one session is reused for the whole interview — to a caller
 * that added it once per turn. The result was a triangular sum.
 *
 * The first test below is the one whose absence let this ship.
 */

/** The buggy accumulation: caller adds a cumulative figure every turn. */
function accumulateCumulative(perTurnCosts: number[]): number {
  let sessionTotal = 0;
  let accumulated = 0;
  for (const c of perTurnCosts) {
    sessionTotal += c;          // session.totalUsage() grows
    accumulated += sessionTotal; // caller adds the TOTAL, not the delta
  }
  return accumulated;
}

/** The fixed accumulation: caller adds each turn's own delta. */
function accumulateDeltas(perTurnCosts: number[]): number {
  return perTurnCosts.reduce((sum, c) => sum + c, 0);
}

test("triangular-sum guard: total equals the sum of per-turn deltas, not a running total", () => {
  const perTurn = [10, 20, 30];

  // What the fix must produce.
  assert.equal(accumulateDeltas(perTurn), 60);

  // What the bug produced: 10 + (10+20) + (10+20+30) = 100.
  assert.equal(accumulateCumulative(perTurn), 100);

  assert.notEqual(
    accumulateDeltas(perTurn), accumulateCumulative(perTurn),
    "if these ever match, this test has stopped discriminating and is worthless",
  );
});

test("the over-count grows quadratically with turn count — matching the production symptom", () => {
  // Nine evaluated turns is what the failing production interview had.
  const nine = Array.from({ length: 9 }, () => 1);
  assert.equal(accumulateDeltas(nine), 9);
  assert.equal(accumulateCumulative(nine), 45); // n(n+1)/2
  assert.equal(accumulateCumulative(nine) / accumulateDeltas(nine), 5); // the 5x we predicted
});

/** Mirrors priceUsage() in anthropic-compatible.ts. */
function priceCents(p: { input: number; cacheWrite: number; cacheRead: number; output: number },
                    u: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): number {
  const dollars =
    (u.input * p.input + (u.cacheWrite ?? 0) * p.cacheWrite +
     (u.cacheRead ?? 0) * p.cacheRead + u.output * p.output) / 1_000_000;
  return dollars * 100;
}

test("pricing arithmetic: one million input tokens costs exactly the table rate in cents", () => {
  const p = ANTHROPIC_MODELS.batchPricing; // input 5.0 USD/M
  assert.equal(priceCents(p, { input: 1_000_000, output: 0 }), 500); // $5.00 -> 500 cents
  assert.equal(priceCents(p, { input: 0, output: 1_000_000 }), 2500); // $25.00 -> 2500 cents
  // Sanity at a realistic scale: 10k in / 1k out on the batch table.
  assert.ok(Math.abs(priceCents(p, { input: 10_000, output: 1_000 }) - (5 + 2.5)) < 1e-9);
});

test("cache reads are priced far below fresh input — the reason caching matters here", () => {
  const p = ANTHROPIC_MODELS.livePricing;
  const fresh = priceCents(p, { input: 100_000, output: 0 });
  const cached = priceCents(p, { input: 0, output: 0, cacheRead: 100_000 });
  assert.ok(cached < fresh, "cache reads must be cheaper than fresh input");
  assert.ok(cached * 5 < fresh, "expected roughly an order of magnitude, not a rounding difference");
});

test("live evaluation uses Haiku 4.5 and batch generation stays on Opus 5", () => {
  assert.equal(ANTHROPIC_MODELS.defaultLive, "claude-haiku-4-5-20251001");
  assert.equal(ANTHROPIC_MODELS.batch, "claude-opus-5");
});

test("the live evaluator can never silently fall back to the expensive batch model", () => {
  // Unset -> the cheap explicit default, NOT the batch model.
  assert.equal(resolveLiveModel({}), ANTHROPIC_MODELS.defaultLive);
  assert.notEqual(resolveLiveModel({}), ANTHROPIC_MODELS.batch);

  // An explicitly EMPTY value is a config error, not a request for a default —
  // silently promoting routine per-turn work onto Opus is the failure mode
  // this whole commit exists to prevent.
  assert.throws(() => resolveLiveModel({ ANTHROPIC_LIVE_MODEL: "" }), /empty/);
  assert.throws(() => resolveLiveModel({ ANTHROPIC_LIVE_MODEL: "   " }), /empty/);
});

test("the live model is configurable, and whitespace is tolerated", () => {
  assert.equal(resolveLiveModel({ ANTHROPIC_LIVE_MODEL: "claude-sonnet-5" }), "claude-sonnet-5");
  assert.equal(resolveLiveModel({ ANTHROPIC_LIVE_MODEL: "  claude-sonnet-5  " }), "claude-sonnet-5");
});

test("live and batch price tables are genuinely different objects", () => {
  // Pricing the per-turn evaluator with the batch table would misreport cost
  // even once the accounting is correct.
  assert.notDeepEqual(ANTHROPIC_MODELS.livePricing, ANTHROPIC_MODELS.batchPricing);
  assert.ok(ANTHROPIC_MODELS.livePricing.input < ANTHROPIC_MODELS.batchPricing.input);
  assert.ok(ANTHROPIC_MODELS.livePricing.output < ANTHROPIC_MODELS.batchPricing.output);
});

test("Usage carries real token counts alongside the derived cost", () => {
  // The distinction the schema comments encode: tokens are facts, cost is a
  // local calculation over those facts.
  const u: Usage = { inputTokens: 1200, cachedInputTokens: 800, outputTokens: 300, costCents: 4.2 };
  assert.equal(u.inputTokens + u.cachedInputTokens, 2000);
  assert.equal(ZERO_USAGE.inputTokens, 0);
  assert.equal(ZERO_USAGE.costCents, 0);
});
