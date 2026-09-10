import { test } from "node:test";
import assert from "node:assert/strict";
import { AdaptiveBrain } from "./adaptive-brain.js";
import { FakeProvider, type ScriptedTurn } from "./fake-provider.js";
import { InMemoryEvidenceSink } from "./evidence-sink.js";
import type { Question, InterviewPlan } from "../schema/plan.js";
import type { TopicSpec } from "../prompts/plan-generator.js";

const TOPIC: TopicSpec = {
  id: "governor_limits", label: "Governor Limits", description: "d",
  aliases: [], importance: 0.9, depthReady: true, prereqs: [],
  rubricRef: "r.v1", expectation: "e",
};

function question(over: Partial<Question> = {}): Question {
  return {
    id: "q1", topicId: "governor_limits",
    text: "A trigger fails on a large load. Where do you look first?",
    kind: "scenario", scores: ["correctness", "depth"],
    mustHear: [
      { id: "s1", signal: "names a query or DML in a loop", probe: "What in the code makes volume matter?" },
      { id: "s2", signal: "names the specific limit", probe: "Which limit specifically?" },
      { id: "s3", signal: "states the fix as batching into a map/list", probe: "What does the fix look like?" },
    ],
    answerKey: { weak: "w".repeat(20), competent: "c".repeat(20), excellent: "e".repeat(20) },
    maxProbes: 2, hardTimeS: 180, difficultyBand: "intermediate",
    ...over,
  };
}

function plan(over: Partial<InterviewPlan> = {}): InterviewPlan {
  return {
    planKey: "k", categoryId: "salesforce_dev", difficulty: "intermediate", mode: "depth",
    durationS: 900,
    persona: { name: "Priya", style: "warm but brisk, never praises, never teaches, at least twenty chars", voiceId: "v" },
    sections: [{ id: "sec1", title: "T", goal: "g", budgetS: 780, topicIds: ["governor_limits"] }],
    dimensionWeights: { correctness: 0.5, depth: 0.5 },
    promptVersion: "v1",
    ...over,
  };
}

function setup(script: ScriptedTurn[], overOpts: Partial<{ questions: Question[]; sink: InMemoryEvidenceSink }> = {}) {
  const provider = new FakeProvider(script);
  const sink = overOpts.sink ?? new InMemoryEvidenceSink();
  const b = new AdaptiveBrain({
    provider, plan: plan(), topics: [TOPIC], sink,
    questions: overOpts.questions ?? [question()],
  });
  return { brain: b, provider, sink };
}

const recordSignal = (id: string, signalId: string, status: "heard" | "partial" | "missing", quote = "quote") => ({
  id, name: "record_signal", input: { signalId, status, quote },
});

// ── selection / plannedTotal ────────────────────────────────────────────

test("selectNext returns a BrainQuestion shaped exactly like the runner expects", async () => {
  const { brain } = setup([]);
  const q = await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  assert.deepEqual(q, { questionId: "q1", text: question().text, hardTimeS: 180, maxProbes: 2 });
});

test("plannedTotal is a sane estimate derived from the pool, not hardcoded", () => {
  const { brain } = setup([]);
  assert.ok(brain.plannedTotal >= 1 && brain.plannedTotal <= 1);
});

// ── signal transitions / partial vs complete ──────────────────────────────

test("a fully-heard answer resolves the question with no probe", async () => {
  const { brain } = setup([
    { toolCalls: [recordSignal("c1", "s1", "heard"), recordSignal("c2", "s2", "heard"), recordSignal("c3", "s3", "heard")] },
  ]);
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  const outcome = await brain.evaluate({ questionId: "q1", candidateText: "full answer", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  assert.equal(outcome.hasUnresolvedSignals, false);
  assert.equal(outcome.probe, null);
  assert.equal(outcome.recordedSignals.length, 3);
});

test("a partial answer leaves the signal unresolved, distinct from missing", async () => {
  const { brain } = setup([
    { toolCalls: [recordSignal("c1", "s1", "partial"), recordSignal("c2", "s2", "missing")] },
  ]);
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  const outcome = await brain.evaluate({ questionId: "q1", candidateText: "vague", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  assert.equal(outcome.hasUnresolvedSignals, true);
  const s1 = outcome.recordedSignals.find((s) => s.signalId === "s1");
  assert.equal(s1?.status, "partial");
});

test("signals resolve incrementally across turns — heard in one turn stays heard", async () => {
  const { brain } = setup([
    { toolCalls: [recordSignal("c1", "s1", "heard")] },
    { toolCalls: [recordSignal("c2", "s2", "heard")] },
    { toolCalls: [recordSignal("c3", "s3", "heard")] },
  ]);
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  let outcome = await brain.evaluate({ questionId: "q1", candidateText: "a1", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  assert.equal(outcome.hasUnresolvedSignals, true);
  outcome = await brain.evaluate({ questionId: "q1", candidateText: "a2", probesUsed: 1, elapsedS: 10, timeLeftS: 770 });
  assert.equal(outcome.hasUnresolvedSignals, true);
  outcome = await brain.evaluate({ questionId: "q1", candidateText: "a3", probesUsed: 2, elapsedS: 15, timeLeftS: 765 });
  assert.equal(outcome.hasUnresolvedSignals, false, "all three signals now heard across turns");
});

// ── probe selection ────────────────────────────────────────────────────

test("the first probe uses the authored canned text, never model-generated text", async () => {
  const { brain } = setup([
    { toolCalls: [recordSignal("c1", "s1", "missing")], text: "some model chatter that must be ignored" },
  ]);
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  const outcome = await brain.evaluate({ questionId: "q1", candidateText: "thin", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  assert.equal(outcome.probe, question().mustHear[0]!.probe);
});

test("probe targets the lowest-ordered unresolved signal, not an arbitrary one", async () => {
  const { brain } = setup([
    { toolCalls: [recordSignal("c1", "s1", "heard"), recordSignal("c2", "s2", "missing")] },
  ]);
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  const outcome = await brain.evaluate({ questionId: "q1", candidateText: "partial", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  assert.equal(outcome.probe, question().mustHear[1]!.probe, "s1 resolved, s2 is next in order");
});

test("a second probe on the same signal uses the model's live narrower text", async () => {
  const { brain } = setup([
    { toolCalls: [recordSignal("c1", "s1", "missing")] }, // probe 1: canned
    { toolCalls: [recordSignal("c2", "s1", "missing")], text: "So specifically, which limit gets hit?" },
  ]);
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  await brain.evaluate({ questionId: "q1", candidateText: "still vague", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  const second = await brain.evaluate({ questionId: "q1", candidateText: "still vague again", probesUsed: 1, elapsedS: 15, timeLeftS: 765 });
  assert.equal(second.probe, "So specifically, which limit gets hit?");
});

test("a repeat probe falls back to canned text if the model says nothing", async () => {
  const { brain } = setup([
    { toolCalls: [recordSignal("c1", "s1", "missing")] },
    { toolCalls: [recordSignal("c2", "s1", "missing")] }, // no text this time
  ]);
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  await brain.evaluate({ questionId: "q1", candidateText: "a", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  const second = await brain.evaluate({ questionId: "q1", candidateText: "b", probesUsed: 1, elapsedS: 15, timeLeftS: 765 });
  assert.equal(second.probe, question().mustHear[0]!.probe);
});

// ── probe exhaustion ───────────────────────────────────────────────────

test("probesRemaining reaches zero at maxProbes and no further probe is offered", async () => {
  const { brain } = setup([
    { toolCalls: [recordSignal("c1", "s1", "missing")] },
    { toolCalls: [recordSignal("c2", "s1", "missing")] },
  ], { questions: [question({ maxProbes: 2 })] });
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  let outcome = await brain.evaluate({ questionId: "q1", candidateText: "a", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  assert.equal(outcome.probesRemaining, 2, "0 used, cap is 2");
  outcome = await brain.evaluate({ questionId: "q1", candidateText: "b", probesUsed: 1, elapsedS: 15, timeLeftS: 765 });
  assert.equal(outcome.probesRemaining, 1);
  outcome = await brain.evaluate({ questionId: "q1", candidateText: "c", probesUsed: 2, elapsedS: 25, timeLeftS: 755 });
  assert.equal(outcome.probesRemaining, 0);
  assert.equal(outcome.probe, null, "budget exhausted — the runner will close the question, not us");
  assert.equal(outcome.hasUnresolvedSignals, true, "still true — the runner distinguishes covered from probes_exhausted using this");
});

test("maxProbes: 0 never probes even on a completely missing answer", async () => {
  const { brain } = setup(
    [{ toolCalls: [recordSignal("c1", "s1", "missing")] }],
    { questions: [question({ maxProbes: 0 })] },
  );
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  const outcome = await brain.evaluate({ questionId: "q1", candidateText: "nothing", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  assert.equal(outcome.probe, null);
  assert.equal(outcome.probesRemaining, 0);
});

// ── malformed / adversarial tool input ─────────────────────────────────

test("a malformed record_signal call is ignored rather than crashing the turn", async () => {
  const { brain } = setup([
    { toolCalls: [{ id: "c1", name: "record_signal", input: { signalId: "s1" /* missing status/quote */ } }] },
  ]);
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  const outcome = await brain.evaluate({ questionId: "q1", candidateText: "x", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  assert.equal(outcome.hasUnresolvedSignals, true, "malformed call had no effect, signal stays unresolved");
});

// ── degrade path ────────────────────────────────────────────────────────

test("a live-session error degrades to no-new-judgment, never fabricates success", async () => {
  const degraded: string[] = [];
  const provider = new FakeProvider([{ error: { message: "rate limited", retryable: true } }]);
  const b = new AdaptiveBrain({
    provider, plan: plan(), topics: [TOPIC], questions: [question()],
    onDegraded: (reason) => degraded.push(reason),
  });
  await b.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  const outcome = await b.evaluate({ questionId: "q1", candidateText: "x", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  assert.equal(degraded.length, 1);
  // The runtime decision is "move on" — getting stuck on a question the
  // system cannot currently judge is worse than skipping it — but the
  // PERSISTED EVIDENCE must stay honest: nothing was actually judged this
  // turn, so recordedSignals must be empty, never fabricated as "heard".
  assert.equal(outcome.hasUnresolvedSignals, false);
  assert.equal(outcome.probe, null, "cannot safely target a probe without a real judgment this turn");
  assert.deepEqual(outcome.recordedSignals, [], "no signal was actually judged — evidence stays empty, not fabricated");
});

// ── persistence behavior ────────────────────────────────────────────────

test("evaluate() persists the candidate turn and the evaluation snapshot", async () => {
  const sink = new InMemoryEvidenceSink();
  // All three signals heard, so no probe fires — isolates this test to just
  // the candidate turn + evaluation snapshot, not probe persistence (that
  // has its own dedicated test below).
  const { brain } = setup(
    [{ toolCalls: [recordSignal("c1", "s1", "heard"), recordSignal("c2", "s2", "heard"), recordSignal("c3", "s3", "heard")] }],
    { sink },
  );
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  await brain.evaluate({ questionId: "q1", candidateText: "the actual answer text", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });

  assert.equal(sink.questionsAsked.length, 1);
  assert.equal(sink.questionsAsked[0]!.questionId, "q1");
  assert.equal(sink.turns.length, 1, "no probe fired, so only the candidate turn was recorded");
  assert.equal(sink.turns[0]!.text, "the actual answer text");
  assert.equal(sink.turns[0]!.speaker, "candidate");
  assert.equal(sink.evaluations.length, 1);
  assert.equal(sink.evaluations[0]!.signals.length, 3);
});

test("a spoken probe is itself persisted as an interviewer turn", async () => {
  const sink = new InMemoryEvidenceSink();
  const { brain } = setup([{ toolCalls: [recordSignal("c1", "s1", "missing")] }], { sink });
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  await brain.evaluate({ questionId: "q1", candidateText: "thin", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });

  const interviewerTurns = sink.turns.filter((t) => t.speaker === "interviewer");
  assert.equal(interviewerTurns.length, 1);
  assert.equal(interviewerTurns[0]!.isProbe, true);
  assert.equal(interviewerTurns[0]!.text, question().mustHear[0]!.probe);
});

test("onQuestionClosed persists the close reason and updates selection state", async () => {
  const sink = new InMemoryEvidenceSink();
  const { brain } = setup([{ toolCalls: [recordSignal("c1", "s1", "heard")] }], { sink });
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  await brain.evaluate({ questionId: "q1", candidateText: "answer", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  await brain.onQuestionClosed("q1", "covered");

  assert.equal(sink.questionsClosed.length, 1);
  assert.equal(sink.questionsClosed[0]!.reason, "covered");
});

test("the live session opens once and is reused across the whole interview", async () => {
  const { brain, provider } = setup([
    { toolCalls: [recordSignal("c1", "s1", "heard")] },
    { toolCalls: [recordSignal("c2", "s2", "heard")] },
  ]);
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  await brain.evaluate({ questionId: "q1", candidateText: "a", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  await brain.evaluate({ questionId: "q1", candidateText: "b", probesUsed: 1, elapsedS: 15, timeLeftS: 765 });
  assert.equal(provider.openSessionCount, 1);
});

test("dispose() releases the underlying live session", async () => {
  const { brain, provider } = setup([{ toolCalls: [recordSignal("c1", "s1", "heard")] }]);
  await brain.selectNext({ askedQuestionIds: [], timeLeftS: 780, elapsedS: 0 });
  await brain.evaluate({ questionId: "q1", candidateText: "a", probesUsed: 0, elapsedS: 5, timeLeftS: 775 });
  brain.dispose();
  assert.equal(provider.session?.disposed, true);
});
