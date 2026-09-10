import { test } from "node:test";
import assert from "node:assert/strict";
import { computeReport, type QuestionEvidence } from "./report.js";

const WEIGHTS = {
  correctness: 0.2, relevance: 0.1, depth: 0.22,
  clarity: 0.13, technical_accuracy: 0.15, problem_solving: 0.2,
};

function question(overrides: Partial<QuestionEvidence> = {}): QuestionEvidence {
  return {
    questionId: "q1",
    text: "Explain bulkification.",
    scores: ["correctness", "technical_accuracy"],
    mustHear: [
      { id: "s1", signal: "mentions per-record DML in a loop hits governor limits", probe: "What happens if you DML inside a for loop?" },
      { id: "s2", signal: "mentions collecting records before a single DML call", probe: "How would you avoid that?" },
      { id: "s3", signal: "mentions bulk-safe trigger design", probe: "Does this apply to triggers too?" },
    ],
    closeReason: "answered",
    signals: [],
    ...overrides,
  };
}

test("computeReport returns null score when there is no evidence at all", () => {
  const result = computeReport([], WEIGHTS);
  assert.equal(result.score, null);
  assert.equal(result.band, null);
  assert.deepEqual(result.questions, []);
  assert.deepEqual(result.workOn, []);
});

test("a dimension no question fed stays null, never coerced to zero", () => {
  const q = question({
    scores: ["correctness"],
    signals: [
      { signalId: "s1", status: "heard", evidenceTurnId: "t1", quote: "..." },
      { signalId: "s2", status: "heard", evidenceTurnId: "t2", quote: "..." },
      { signalId: "s3", status: "heard", evidenceTurnId: "t3", quote: "..." },
    ],
  });
  const result = computeReport([q], WEIGHTS);
  assert.ok(result.score);
  assert.equal(result.score!.dimensions.correctness, 10);
  assert.equal(result.score!.dimensions.depth, null, "no question fed depth — must stay null, not 0");
  assert.equal(result.score!.dimensions.clarity, null);
  assert.ok(result.score!.notAssessed.includes("depth"));
});

test("missing and partial signals are classified per-question and quoted where available", () => {
  const q = question({
    signals: [
      { signalId: "s1", status: "heard", evidenceTurnId: "t1", quote: "we collect records first" },
      { signalId: "s2", status: "partial", evidenceTurnId: "t2", quote: "sort of, yeah" },
      // s3 never recorded at all — must count as missing, same as an explicit "missing" status.
    ],
  });
  const [view] = computeReport([q], WEIGHTS).questions;
  assert.equal(view!.heard.length, 1);
  assert.equal(view!.heard[0]!.quote, "we collect records first");
  assert.equal(view!.partial.length, 1);
  assert.equal(view!.partial[0]!.quote, "sort of, yeah");
  assert.equal(view!.missing.length, 1);
  assert.equal(view!.missing[0]!.signal, question().mustHear[2]!.signal);
});

test("a question cut off by the clock is excluded from scoring and marked, not scored as a weakness", () => {
  const answered = question({
    questionId: "q1", scores: ["correctness"],
    signals: [
      { signalId: "s1", status: "heard", evidenceTurnId: "t1", quote: "x" },
      { signalId: "s2", status: "heard", evidenceTurnId: "t2", quote: "x" },
      { signalId: "s3", status: "heard", evidenceTurnId: "t3", quote: "x" },
    ],
  });
  const cutOff = question({ questionId: "q2", scores: ["correctness"], closeReason: "interview_ended", signals: [] });
  const neverClosed = question({ questionId: "q3", scores: ["correctness"], closeReason: null, signals: [] });

  const result = computeReport([answered, cutOff, neverClosed], WEIGHTS);

  assert.equal(result.score!.dimensions.correctness, 10, "only the answered question should feed the dimension");
  assert.equal(result.score!.excludedQuestionIds.length, 2);
  assert.equal(result.questions.find((q) => q.questionId === "q2")!.excluded, true);
  assert.equal(result.questions.find((q) => q.questionId === "q3")!.excluded, true, "an unclosed question is treated the same as an explicit cutoff");
  assert.equal(result.questions.find((q) => q.questionId === "q1")!.excluded, false);
});

test("workOn lists missing/partial signal text, deduplicated, and excludes cut-off questions", () => {
  const withMisses = question({
    signals: [
      { signalId: "s2", status: "partial", evidenceTurnId: "t2", quote: "partly" },
      // s1 and s3 never recorded -> missing
    ],
  });
  const cutOffWithMisses = question({ questionId: "q2", closeReason: "interview_ended", signals: [] });

  const result = computeReport([withMisses, cutOffWithMisses], WEIGHTS);

  // q1 contributes all 3 of its own signals (2 missing + 1 partial); q2 is
  // excluded entirely since it was cut off, even though it also has misses.
  assert.equal(result.workOn.length, 3);
  for (const mh of question().mustHear) assert.ok(result.workOn.includes(mh.signal));
});

test("workOn is capped at 6 even with more missing/partial signals across questions", () => {
  const q1 = question({ questionId: "q1", mustHear: Array.from({ length: 4 }, (_, i) => ({
    id: `q1s${i}`, signal: `q1 signal ${i}`, probe: `probe ${i}`,
  })), signals: [] });
  const q2 = question({ questionId: "q2", mustHear: Array.from({ length: 4 }, (_, i) => ({
    id: `q2s${i}`, signal: `q2 signal ${i}`, probe: `probe ${i}`,
  })), signals: [] });

  const result = computeReport([q1, q2], WEIGHTS);
  assert.equal(result.workOn.length, 6);
});

test("overall stays null when nothing at all was assessed", () => {
  const q = question({ closeReason: "interview_ended", signals: [] });
  const result = computeReport([q], WEIGHTS);
  assert.equal(result.score!.overall, null);
  assert.equal(result.band, null);
});
