import { test } from "node:test";
import assert from "node:assert/strict";
import { ClaudeEvaluationBrain } from "./claude-evaluation-brain.js";
import { SCRIPT } from "./scripted-brain.js";
import { ProviderError, type LlmProvider, type StructuredResult } from "../providers/types.js";

/** Fake provider — no network, no credentials, fully deterministic. */
function fakeProvider(
  respond: (userPrompt: string) => { shouldProbe: boolean; probe: string } | Error,
): LlmProvider {
  return {
    id: "fake",
    liveModel: "fake-live",
    batchModel: "fake-batch",
    openLiveSession() {
      throw new Error("not used by ClaudeEvaluationBrain");
    },
    async generateStructured<T>(req: { userPrompt: string }): Promise<StructuredResult<T>> {
      const out = respond(req.userPrompt);
      if (out instanceof Error) throw out;
      return {
        value: out as T,
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, costCents: 0.01 },
      };
    },
  };
}

test("a shallow answer produces a probe from the real evaluation call", async () => {
  const provider = fakeProvider(() => ({ shouldProbe: true, probe: "What specifically fails?" }));
  const brain = new ClaudeEvaluationBrain({ provider });
  const out = await brain.evaluate({
    questionId: SCRIPT[0]!.questionId, candidateText: "Bulkify it.",
    probesUsed: 0, elapsedS: 5, timeLeftS: 800,
  });
  assert.equal(out.probe, "What specifically fails?");
  assert.equal(out.hasUnresolvedSignals, true);
  assert.equal(out.probesRemaining, 1);
});

test("a solid answer does not probe", async () => {
  const provider = fakeProvider(() => ({ shouldProbe: false, probe: "" }));
  const brain = new ClaudeEvaluationBrain({ provider });
  const out = await brain.evaluate({
    questionId: SCRIPT[0]!.questionId,
    candidateText: "There's a query inside the loop, I'd move it out and query once into a map.",
    probesUsed: 0, elapsedS: 5, timeLeftS: 800,
  });
  assert.equal(out.probe, null);
  assert.equal(out.hasUnresolvedSignals, false);
});

test("a second probe attempt is refused even if the model says to probe again", async () => {
  const provider = fakeProvider(() => ({ shouldProbe: true, probe: "Dig deeper." }));
  const brain = new ClaudeEvaluationBrain({ provider });
  const out = await brain.evaluate({
    questionId: SCRIPT[0]!.questionId, candidateText: "still thin",
    probesUsed: 1, elapsedS: 40, timeLeftS: 760,
  });
  assert.equal(out.probesRemaining, 0);
  assert.equal(out.probe, null, "no probe budget left, regardless of model output");
});

// ── the requirement that matters most: never fabricate success ────────────
test("a provider failure degrades to move-on and calls onDegraded — never silently 'fine'", async () => {
  const provider = fakeProvider(() => new ProviderError("rate limited", true));
  const degraded: Array<{ reason: string }> = [];
  const brain = new ClaudeEvaluationBrain({
    provider,
    onDegraded: (reason) => degraded.push({ reason }),
  });
  const out = await brain.evaluate({
    questionId: SCRIPT[0]!.questionId, candidateText: "an answer",
    probesUsed: 0, elapsedS: 5, timeLeftS: 800,
  });
  assert.equal(degraded.length, 1, "the failure must be observable, not swallowed");
  assert.equal(out.probe, null);
  assert.equal(out.hasUnresolvedSignals, false);
  assert.equal(out.probesRemaining, 0);
});

test("onEvaluated fires only on the success path, with real usage", async () => {
  const provider = fakeProvider(() => ({ shouldProbe: false, probe: "" }));
  const calls: Array<{ costCents: number }> = [];
  const brain = new ClaudeEvaluationBrain({ provider, onEvaluated: (i) => calls.push(i) });
  await brain.evaluate({
    questionId: SCRIPT[0]!.questionId, candidateText: "fine",
    probesUsed: 0, elapsedS: 5, timeLeftS: 800,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.costCents, 0.01);
});

test("onEvaluated does not fire on failure", async () => {
  const provider = fakeProvider(() => new Error("boom"));
  const calls: unknown[] = [];
  const brain = new ClaudeEvaluationBrain({ provider, onEvaluated: (i) => calls.push(i) });
  await brain.evaluate({
    questionId: SCRIPT[0]!.questionId, candidateText: "x",
    probesUsed: 0, elapsedS: 5, timeLeftS: 800,
  });
  assert.equal(calls.length, 0);
});

test("selectNext, intro, and closing match ScriptedBrain's fixed script", async () => {
  const provider = fakeProvider(() => ({ shouldProbe: false, probe: "" }));
  const brain = new ClaudeEvaluationBrain({ provider });
  assert.equal(brain.plannedTotal, 3);
  assert.match(await brain.intro(), /Thanks for making the time/);
  const q1 = await brain.selectNext({ askedQuestionIds: [], timeLeftS: 900, elapsedS: 0 });
  assert.equal(q1?.questionId, "m2.q1");
  const q2 = await brain.selectNext({ askedQuestionIds: ["m2.q1"], timeLeftS: 700, elapsedS: 200 });
  assert.equal(q2?.questionId, "m2.q2");
  const none = await brain.selectNext({ askedQuestionIds: ["m2.q1", "m2.q2", "m2.q3"], timeLeftS: 500, elapsedS: 400 });
  assert.equal(none, null);
});

test("selectNext returns null when the remaining time cannot fit another question", async () => {
  const provider = fakeProvider(() => ({ shouldProbe: false, probe: "" }));
  const brain = new ClaudeEvaluationBrain({ provider });
  const out = await brain.selectNext({ askedQuestionIds: [], timeLeftS: 60, elapsedS: 840 });
  assert.equal(out, null);
});

test("onQuestionClosed records the reason for later inspection", async () => {
  const provider = fakeProvider(() => ({ shouldProbe: false, probe: "" }));
  const brain = new ClaudeEvaluationBrain({ provider });
  await brain.onQuestionClosed("m2.q1", "covered");
  await brain.onQuestionClosed("m2.q2", "candidate_stuck");
  assert.deepEqual(
    [...brain.closedQuestions],
    [{ questionId: "m2.q1", reason: "covered" }, { questionId: "m2.q2", reason: "candidate_stuck" }],
  );
});
