import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreLedger, type LedgerEntry } from "./scoring.js";
import type { SignalRecord } from "./schema/evaluation.js";

const EVEN_WEIGHTS = {
  correctness: 1 / 6, relevance: 1 / 6, depth: 1 / 6,
  clarity: 1 / 6, technical_accuracy: 1 / 6, problem_solving: 1 / 6,
};

function sig(id: string, status: SignalRecord["status"]): SignalRecord {
  return { signalId: id, status, evidenceTurnId: "t1", quote: "…" };
}

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    questionId: "q1", scores: ["correctness"], signalCount: 4,
    recorded: [], closeReason: "covered", ...over,
  };
}

test("a dimension no question touched is null, not zero", () => {
  const r = scoreLedger(
    [entry({ scores: ["correctness"], recorded: [sig("s1", "heard")] })],
    EVEN_WEIGHTS,
  );
  assert.equal(r.dimensions.correctness, 2.5);
  assert.equal(r.dimensions.problem_solving, null);
  assert.deepEqual(r.assessed, ["correctness"]);
  assert.ok(r.notAssessed.includes("problem_solving"));
});

test("not-assessed dimensions do not drag the overall down", () => {
  // All four signals heard on the only dimension assessed => a perfect run.
  const r = scoreLedger(
    [entry({
      recorded: ["s1", "s2", "s3", "s4"].map((s) => sig(s, "heard")),
    })],
    EVEN_WEIGHTS,
  );
  // Would be 17 if the five untouched dimensions counted as 0.
  assert.equal(r.overall, 100);
});

test("partial credit is honoured", () => {
  const r = scoreLedger(
    [entry({ recorded: [sig("s1", "heard"), sig("s2", "partial"), sig("s3", "missing")] })],
    EVEN_WEIGHTS,
  );
  assert.equal(r.dimensions.correctness, 3.8); // (1 + .5 + 0) / 4 * 10
});

test("a category with some components unassessed renormalizes", () => {
  // technical_knowledge = correctness 0.6 + technical_accuracy 0.4
  const r = scoreLedger(
    [entry({ scores: ["correctness"], signalCount: 2, recorded: [sig("s1", "heard"), sig("s2", "heard")] })],
    EVEN_WEIGHTS,
  );
  assert.equal(r.dimensions.technical_accuracy, null);
  assert.equal(r.categories.technical_knowledge, 10); // from correctness alone
  assert.equal(r.categories.problem_solving, null);
});

test("questions cut off by the clock are excluded, not scored zero", () => {
  const r = scoreLedger(
    [
      entry({ questionId: "q1", recorded: ["s1","s2","s3","s4"].map((s) => sig(s, "heard")) }),
      entry({ questionId: "q2", recorded: [], closeReason: "interview_ended" }),
    ],
    EVEN_WEIGHTS,
  );
  assert.deepEqual(r.excludedQuestionIds, ["q2"]);
  assert.equal(r.dimensions.correctness, 10);
});

test("nothing assessed yields a null overall so no report is written", () => {
  const r = scoreLedger(
    [entry({ recorded: [], closeReason: "interview_ended" })],
    EVEN_WEIGHTS,
  );
  assert.equal(r.overall, null);
  assert.equal(r.assessed.length, 0);
});

test("candidate_stuck still scores — silence is evidence", () => {
  const r = scoreLedger(
    [entry({ recorded: [sig("s1", "missing")], closeReason: "candidate_stuck" })],
    EVEN_WEIGHTS,
  );
  assert.equal(r.dimensions.correctness, 0);
  assert.equal(r.overall, 0);
});
