/**
 * Proves the production wiring this milestone adds — AdaptiveBrain +
 * PostgresEvidenceSink-shaped evidence + interview-lifecycle persistence —
 * behaves correctly across every exit path, driven through the SAME real
 * InterviewRunner/state-machine/silence-ladder `adaptive-brain-runner.test.ts`
 * already proved for M3, plus the exact `onUiEventForLifecycle` hook agent.ts
 * installs (not a reimplementation of it). No @livekit/agents, no network,
 * no real Postgres — FakeProvider/InMemoryEvidenceSink/FakeLifecycleStore
 * make every path deterministic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InterviewRunner, AdaptiveBrain, FakeProvider, InMemoryEvidenceSink,
  DEFAULT_LADDER, type RunnerOptions, type VoiceIO, type UiEvent,
  type Question, type InterviewPlan,
} from "@ai/core";
import type { TopicSpec } from "@ai/core";
import { FakeLifecycleStore, onUiEventForLifecycle } from "./interview-lifecycle.js";

class MockIO implements VoiceIO {
  t = 0;
  spoken: string[] = [];
  ui: UiEvent[] = [];
  private listeners: Array<(e: UiEvent) => void> = [];

  now() { return this.t; }
  async speak(text: string) { this.spoken.push(text); this.t += 10; }
  interrupt() {}
  publishUi(e: UiEvent) {
    this.ui.push(e);
    for (const l of this.listeners) l(e);
  }
  onUi(l: (e: UiEvent) => void) { this.listeners.push(l); }
  advance(ms: number) { this.t += ms; }
}

const TOPICS: TopicSpec[] = [
  { id: "governor_limits", label: "Governor Limits", description: "", aliases: [], importance: 0.9, depthReady: true, prereqs: [], rubricRef: "r.v1", expectation: "" },
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
    maxProbes: 1, hardTimeS: 60, difficultyBand: "intermediate",
    ...over,
  };
}

function plan(): InterviewPlan {
  return {
    planKey: "k", categoryId: "salesforce_dev", difficulty: "intermediate", mode: "depth",
    durationS: 900,
    persona: { name: "Priya", style: "warm but brisk, never praises, never teaches, twenty chars min", voiceId: "v" },
    sections: [{ id: "sec1", title: "T", goal: "g", budgetS: 780, topicIds: ["governor_limits"] }],
    dimensionWeights: { correctness: 1 },
    promptVersion: "v1",
  };
}

const heard = (id: string, signalId: string) => ({ id, name: "record_signal", input: { signalId, status: "heard", quote: "q" } });

interface Harness {
  io: MockIO;
  sink: InMemoryEvidenceSink;
  store: FakeLifecycleStore;
  runner: InterviewRunner;
}

function harness(pool: Question[], opts: Partial<RunnerOptions> = {}): Harness {
  const interviewId = "iv-test-1";
  const io = new MockIO();
  const sink = new InMemoryEvidenceSink();
  const store = new FakeLifecycleStore();
  const errors: unknown[] = [];
  io.onUi(onUiEventForLifecycle(store, interviewId, (ctx, err) => errors.push({ ctx, err })));

  const provider = new FakeProvider([
    { toolCalls: [heard("t1", "s1"), heard("t2", "s2"), heard("t3", "s3")] },
  ]);
  const brain = new AdaptiveBrain({ provider, plan: plan(), topics: TOPICS, sink, questions: pool });
  const runner = new InterviewRunner(brain, io, {
    durationS: opts.durationS ?? 900, closingReserveS: opts.closingReserveS ?? 120, ladder: DEFAULT_LADDER,
  });
  return { io, sink, store, runner };
}

async function driveToListening(h: Harness): Promise<void> {
  await h.runner.start(); // INIT -> INTRO -> SELECT_NEXT -> ASK (speaks intro + question)
}

test("successful completion (pool exhausted) leaves the interview 'complete', reason 'completed'", async () => {
  const h = harness([question({ id: "gl1" })]);
  await driveToListening(h);
  await h.runner.onUtteranceFinal("full answer covering it all"); // -> EVALUATE -> SELECT_NEXT (no more questions) -> CLOSING -> GRADING -> COMPLETE

  assert.equal(h.store.statusOf("iv-test-1"), "complete");
  assert.deepEqual(h.store.endedCalls, [{ interviewId: "iv-test-1", reason: "completed" }]);
});

test("participant disconnect leaves the interview 'abandoned', reason 'disconnected'", async () => {
  const h = harness([question({ id: "gl1" }), question({ id: "gl2", text: "second question" })]);
  await driveToListening(h);

  await h.runner.onDisconnected();

  assert.equal(h.store.statusOf("iv-test-1"), "abandoned");
  assert.deepEqual(h.store.endedCalls, [{ interviewId: "iv-test-1", reason: "disconnected" }]);
});

test("explicit End Interview leaves the interview 'complete', reason 'user_ended'", async () => {
  const h = harness([question({ id: "gl1" }), question({ id: "gl2", text: "second question" })]);
  await driveToListening(h);

  await h.runner.requestEnd(); // -> CLOSING -> GRADING -> COMPLETE

  assert.equal(h.store.statusOf("iv-test-1"), "complete");
  assert.deepEqual(h.store.endedCalls, [{ interviewId: "iv-test-1", reason: "user_ended" }]);
});

test("duplicate teardown: a disconnect after the interview already ended does not overwrite the outcome", async () => {
  const h = harness([question({ id: "gl1" })]);
  await driveToListening(h);
  await h.runner.onUtteranceFinal("full answer covering it all"); // completes naturally

  await h.runner.onDisconnected(); // e.g. Close firing again after AgentSession tears down

  assert.equal(h.store.statusOf("iv-test-1"), "complete", "must stay complete, not get flipped to abandoned");
  assert.equal(h.store.endedCalls.length, 1);
});

test("a full turn persists the asked question, the candidate's turn, and every judged signal", async () => {
  const h = harness([question({ id: "gl1" })]);
  await driveToListening(h);
  await h.runner.onUtteranceFinal("names the query, names governor limits, and states the fix");

  assert.equal(h.sink.questionsAsked.length, 1);
  assert.equal(h.sink.questionsAsked[0]!.questionId, "gl1");

  const candidateTurn = h.sink.turns.find((t) => t.speaker === "candidate");
  assert.ok(candidateTurn);
  assert.equal(candidateTurn.text, "names the query, names governor limits, and states the fix");

  const evaluation = h.sink.evaluations.find((e) => e.questionId === "gl1");
  assert.ok(evaluation);
  assert.equal(evaluation.signals.length, 3);
  assert.ok(evaluation.signals.every((s) => s.status === "heard"));

  assert.equal(h.sink.questionsClosed.length, 1);
  assert.equal(h.sink.questionsClosed[0]!.questionId, "gl1");
});

test("a probe fires and persists as an interviewer turn when signals are left unresolved", async () => {
  const io = new MockIO();
  const sink = new InMemoryEvidenceSink();
  const store = new FakeLifecycleStore();
  io.onUi(onUiEventForLifecycle(store, "iv-probe", () => {}));
  // Only s1 gets judged "heard" — s2/s3 stay unresolved, so the brain should probe.
  const provider = new FakeProvider([{ toolCalls: [heard("t1", "s1")] }]);
  const brain = new AdaptiveBrain({ provider, plan: plan(), topics: TOPICS, sink, questions: [question({ id: "gl1", maxProbes: 1 })] });
  const runner = new InterviewRunner(brain, io, { durationS: 900, closingReserveS: 120, ladder: DEFAULT_LADDER });

  await runner.start();
  await runner.onUtteranceFinal("partial answer");

  const probeTurn = sink.turns.find((t) => t.isProbe);
  assert.ok(probeTurn, "an unresolved-signal answer must produce a persisted probe turn");
  assert.equal(probeTurn.speaker, "interviewer");
});
