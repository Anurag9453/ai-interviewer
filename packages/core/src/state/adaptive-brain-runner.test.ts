/**
 * State-machine integration: the real InterviewRunner driving a real
 * AdaptiveBrain through a real (small, synthetic) multi-topic pool, using
 * FakeProvider so the whole thing is deterministic. This is the "integration
 * with the existing InterviewRunner and InterviewBrain" requirement —
 * AdaptiveBrain plugs into the exact same runner M2-A/M2-B proved, with zero
 * changes to interview-machine.ts, silence-ladder.ts, or runner.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { InterviewRunner, type RunnerOptions, type VoiceIO } from "./runner.js";
import { AdaptiveBrain } from "./adaptive-brain.js";
import { FakeProvider, type ScriptedTurn } from "./fake-provider.js";
import { InMemoryEvidenceSink } from "./evidence-sink.js";
import { DEFAULT_LADDER } from "./silence-ladder.js";
import type { UiEvent } from "./ui-events.js";
import type { Question, InterviewPlan } from "../schema/plan.js";
import type { TopicSpec } from "../prompts/plan-generator.js";

class MockIO implements VoiceIO {
  t = 0;
  spoken: string[] = [];
  ui: UiEvent[] = [];

  now() { return this.t; }
  async speak(text: string) { this.spoken.push(text); this.t += 500; }
  interrupt() {}
  publishUi(e: UiEvent) { this.ui.push(e); }
  advance(ms: number) { this.t += ms; }
}

const TOPICS: TopicSpec[] = [
  { id: "governor_limits", label: "Governor Limits", description: "d", aliases: [], importance: 0.9, depthReady: true, prereqs: [], rubricRef: "r.v1", expectation: "e" },
  { id: "bulkification", label: "Bulkification", description: "d", aliases: [], importance: 0.9, depthReady: true, prereqs: ["governor_limits"], rubricRef: "r.v1", expectation: "e" },
];

function question(over: Partial<Question> = {}): Question {
  return {
    id: "gl1", topicId: "governor_limits",
    text: "A trigger fails on a large load. Where do you look first?",
    kind: "scenario", scores: ["correctness"],
    mustHear: [
      { id: "s1", signal: "names a query in a loop", probe: "What makes volume matter here?" },
      { id: "s2", signal: "names the limit", probe: "Which limit specifically?" },
      { id: "s3", signal: "states the fix", probe: "What does the fix look like?" },
    ],
    answerKey: { weak: "w".repeat(20), competent: "c".repeat(20), excellent: "e".repeat(20) },
    maxProbes: 1, hardTimeS: 120, difficultyBand: "intermediate",
    ...over,
  };
}

const POOL: Question[] = [
  question({ id: "gl1", topicId: "governor_limits" }),
  question({
    id: "bulk1", topicId: "bulkification",
    text: "You inherit a method that queries inside a loop. Walk me through the fix.",
    mustHear: [
      { id: "b1", signal: "gathers ids first", probe: "What happens before the query?" },
      { id: "b2", signal: "uses a map keyed on id", probe: "How do you match records back up?" },
    ],
    maxProbes: 1, hardTimeS: 120,
  }),
];

function plan(): InterviewPlan {
  return {
    planKey: "k", categoryId: "salesforce_dev", difficulty: "intermediate", mode: "depth",
    durationS: 900,
    persona: { name: "Priya", style: "warm but brisk, never praises, never teaches, twenty chars min", voiceId: "v" },
    sections: [{ id: "sec1", title: "T", goal: "g", budgetS: 780, topicIds: ["governor_limits", "bulkification"] }],
    dimensionWeights: { correctness: 1 },
    promptVersion: "v1",
  };
}

const heard = (id: string, signalId: string) => ({ id, name: "record_signal", input: { signalId, status: "heard", quote: "q" } });

function harness(script: ScriptedTurn[], opts: Partial<RunnerOptions & { questions: Question[] }> = {}) {
  const io = new MockIO();
  const sink = new InMemoryEvidenceSink();
  const provider = new FakeProvider(script);
  const brain = new AdaptiveBrain({
    provider, plan: plan(), topics: TOPICS, sink,
    questions: opts.questions ?? POOL,
  });
  const runner = new InterviewRunner(brain, io, {
    durationS: opts.durationS ?? 900,
    closingReserveS: opts.closingReserveS ?? 120,
    ladder: DEFAULT_LADDER,
  });
  return { io, sink, brain, runner };
}

test("a full two-question interview through the real state machine reaches COMPLETE", async () => {
  const { io, runner, sink } = harness([
    { toolCalls: [heard("c1", "s1"), heard("c2", "s2"), heard("c3", "s3")] }, // gl1 fully resolved
    { toolCalls: [heard("c4", "b1"), heard("c5", "b2")] },                    // bulk1 fully resolved
  ]);
  await runner.start();
  await runner.onUtteranceFinal("first answer");
  await runner.onUtteranceFinal("second answer");

  assert.equal(runner.phase, "COMPLETE");
  assert.equal(runner.endReason, "completed");
  assert.deepEqual(runner.askedQuestionIds, ["gl1", "bulk1"]);
  assert.equal(sink.questionsClosed.length, 2);
  assert.ok(sink.questionsClosed.every((q) => q.reason === "covered"));
  assert.ok(io.spoken.some((s) => s.includes("large load")));
  assert.ok(io.spoken.some((s) => s.includes("inherit a method")));
});

test("prerequisite ordering is honoured through the real runner, not just the pure selector", async () => {
  // bulkification's prereq (governor_limits) must be asked first even
  // though both questions are in the pool from turn one.
  const { runner } = harness([
    { toolCalls: [heard("c1", "s1"), heard("c2", "s2"), heard("c3", "s3")] },
    { toolCalls: [heard("c4", "b1"), heard("c5", "b2")] },
  ]);
  await runner.start();
  assert.equal(runner.askedQuestionIds[0], "gl1", "prereq-free topic goes first");
  await runner.onUtteranceFinal("answer");
  assert.equal(runner.askedQuestionIds[1], "bulk1", "now unlocked");
});

test("an unresolved signal with probe budget produces a real probe, then closes on the second pass", async () => {
  const { runner, io, sink } = harness([
    { toolCalls: [heard("c1", "s1")] },                          // s2, s3 still missing -> probe
    { toolCalls: [heard("c2", "s2"), heard("c3", "s3")] },       // now resolved -> covered
    { toolCalls: [heard("c4", "b1"), heard("c5", "b2")] },
  ]);
  await runner.start();
  await runner.onUtteranceFinal("thin answer");
  assert.equal(runner.phase, "LISTEN", "still on gl1, waiting for the probe response");
  assert.ok(io.spoken.includes("Which limit specifically?"), "probe target was s2, the lowest unresolved");

  await runner.onUtteranceFinal("better answer");
  assert.equal(sink.questionsClosed[0]?.reason, "covered");
  assert.equal(sink.questionsClosed[0]?.probesUsed, 1);
});

test("probe exhaustion closes the question as probes_exhausted, not covered", async () => {
  const { runner, sink } = harness(
    [
      { toolCalls: [] }, // nothing resolved, maxProbes:1 -> one probe fires
      { toolCalls: [] }, // still nothing resolved, budget now exhausted
    ],
    { questions: [question({ maxProbes: 1 })] },
  );
  await runner.start();
  await runner.onUtteranceFinal("i don't know");
  await runner.onUtteranceFinal("still don't know");
  assert.equal(sink.questionsClosed[0]?.reason, "probes_exhausted");
});

test("time exhaustion ends the interview via CLOSING rather than asking past the clock", async () => {
  // Each question needs 120s; leave only enough time for one.
  const { runner, io } = harness(
    [{ toolCalls: [heard("c1", "s1"), heard("c2", "s2"), heard("c3", "s3")] }],
    { durationS: 260, closingReserveS: 120 }, // 140s usable
  );
  await runner.start();
  // Simulate the candidate actually taking real time to answer — the mock's
  // speak() only advances 500ms regardless of content length, so without
  // this the clock barely moves and a 120s question always "fits" no matter
  // how little time is nominally left.
  io.advance(30_000);
  await runner.onUtteranceFinal("answer");
  assert.equal(runner.phase, "COMPLETE");
  assert.equal(runner.askedQuestionIds.length, 1, "second question does not fit the remaining clock");
  assert.ok(io.spoken.some((s) => s.includes("That's all my questions")));
});

test("no eligible question at all sends the interview straight to closing", async () => {
  const { runner, io } = harness([], { questions: [] });
  await runner.start();
  assert.equal(runner.phase, "COMPLETE");
  assert.equal(runner.endReason, "completed");
  assert.ok(io.spoken.some((s) => s.includes("That's all my questions")));
});

test("evidence for the whole interview is queryable afterward from the sink alone", async () => {
  const { runner, sink } = harness([
    { toolCalls: [heard("c1", "s1"), heard("c2", "s2"), heard("c3", "s3")] },
    { toolCalls: [heard("c4", "b1"), heard("c5", "b2")] },
  ]);
  await runner.start();
  await runner.onUtteranceFinal("a1");
  await runner.onUtteranceFinal("a2");

  assert.equal(sink.questionsAsked.length, 2);
  assert.equal(sink.turns.filter((t) => t.speaker === "candidate").length, 2);
  assert.equal(sink.evaluations.length, 2);
  assert.ok(sink.evaluations.every((e) => e.signals.length > 0));
});
