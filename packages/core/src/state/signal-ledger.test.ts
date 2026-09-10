import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyJudgment, createLedger, isFullyResolved, pickProbeTarget,
  ratio, toSignalRecords, unresolvedSignals,
} from "./signal-ledger.js";

const Q = {
  id: "q1",
  mustHear: [
    { id: "s1", signal: "names the loop", probe: "what loops here?" },
    { id: "s2", signal: "names the limit", probe: "which limit?" },
    { id: "s3", signal: "names the fix", probe: "what would you change?" },
  ],
};

test("a fresh ledger starts every signal missing with no evidence", () => {
  const l = createLedger(Q);
  assert.equal(l.signals.length, 3);
  assert.ok(l.signals.every((s) => s.status === "missing" && s.evidenceTurnId === null));
  assert.equal(ratio(l), 0);
  assert.equal(isFullyResolved(l), false);
});

test("applyJudgment updates only the targeted signal", () => {
  let l = createLedger(Q);
  l = applyJudgment(l, "s1", "heard", "t1", "the query is inside the loop");
  assert.equal(l.signals.find((s) => s.id === "s1")!.status, "heard");
  assert.equal(l.signals.find((s) => s.id === "s2")!.status, "missing");
});

test("pickProbeTarget returns the lowest-ordered unresolved signal", () => {
  let l = createLedger(Q);
  l = applyJudgment(l, "s1", "heard", "t1", "quote");
  assert.equal(pickProbeTarget(l)?.id, "s2");
  l = applyJudgment(l, "s2", "heard", "t2", "quote");
  assert.equal(pickProbeTarget(l)?.id, "s3");
});

test("pickProbeTarget is null once every signal is heard", () => {
  let l = createLedger(Q);
  for (const s of Q.mustHear) l = applyJudgment(l, s.id, "heard", "t", "q");
  assert.equal(pickProbeTarget(l), null);
  assert.equal(isFullyResolved(l), true);
});

test("partial credit is reflected in ratio, complete resolution reaches 1", () => {
  let l = createLedger(Q);
  l = applyJudgment(l, "s1", "heard", "t1", "q");
  l = applyJudgment(l, "s2", "partial", "t1", "q");
  // s3 still missing/unjudged
  assert.equal(ratio(l), (1 + 0.5 + 0) / 3);

  l = applyJudgment(l, "s2", "heard", "t2", "q"); // s2 clarified on a later turn
  l = applyJudgment(l, "s3", "heard", "t2", "q");
  assert.equal(ratio(l), 1);
});

test("unresolvedSignals excludes heard, includes partial and missing", () => {
  let l = createLedger(Q);
  l = applyJudgment(l, "s1", "heard", "t1", "q");
  l = applyJudgment(l, "s2", "partial", "t1", "q");
  const unresolved = unresolvedSignals(l).map((s) => s.id);
  assert.deepEqual(unresolved, ["s2", "s3"]);
});

test("toSignalRecords includes only judged signals, schema-conformant", () => {
  let l = createLedger(Q);
  l = applyJudgment(l, "s1", "heard", "t1", "the exact quote");
  const records = toSignalRecords(l);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    signalId: "s1", status: "heard", evidenceTurnId: "t1", quote: "the exact quote",
  });
});

test("a later judgment can explicitly downgrade a prior heard (contradiction)", () => {
  let l = createLedger(Q);
  l = applyJudgment(l, "s1", "heard", "t1", "q");
  l = applyJudgment(l, "s1", "missing", "t2", "actually contradicted themselves");
  assert.equal(l.signals.find((s) => s.id === "s1")!.status, "missing");
});
