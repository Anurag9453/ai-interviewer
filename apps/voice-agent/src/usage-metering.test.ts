import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCostCents, newUsageAccumulator } from "./usage-metering.js";

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
