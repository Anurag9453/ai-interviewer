import { test } from "node:test";
import assert from "node:assert/strict";
import { endReasonToStatus, FakeLifecycleStore, finalizeInterview, type LifecycleStore } from "./interview-lifecycle.js";
import type { EndReason } from "@ai/core";

test("endReasonToStatus maps disconnected and error to abandoned, everything else to complete", () => {
  assert.equal(endReasonToStatus("disconnected"), "abandoned");
  assert.equal(endReasonToStatus("error"), "abandoned");
  assert.equal(endReasonToStatus("completed"), "complete");
  assert.equal(endReasonToStatus("user_ended"), "complete");
  assert.equal(endReasonToStatus("timeout"), "complete");
});

test("markLive is idempotent — a second call after the interview has ended does not resurrect it", async () => {
  const store = new FakeLifecycleStore();
  await store.markLive("iv1");
  await store.markEnded("iv1", "completed");
  await store.markLive("iv1"); // e.g. a retried job dispatch
  assert.equal(store.statusOf("iv1"), "complete");
});

test("markEnded on a fresh interview records the call and sets the mapped status", async () => {
  const store = new FakeLifecycleStore();
  await store.markEnded("iv1", "disconnected");
  assert.equal(store.statusOf("iv1"), "abandoned");
  assert.deepEqual(store.endedCalls, [{ interviewId: "iv1", reason: "disconnected" }]);
});

test("duplicate teardown: calling markEnded twice only records the first call", async () => {
  const store = new FakeLifecycleStore();
  await store.markEnded("iv1", "completed");
  await store.markEnded("iv1", "disconnected"); // e.g. Close firing again after a graceful end
  assert.equal(store.endedCalls.length, 1, "a second markEnded call must be a no-op, not overwrite the first outcome");
  assert.equal(store.statusOf("iv1"), "complete");
});

test("finalizeInterview swallows a failing store and reports it via onError, never throwing", async () => {
  const failing: LifecycleStore = {
    markLive: async () => {},
    markEnded: async () => { throw new Error("connection reset"); },
  };
  const errors: Array<{ context: string; message: string }> = [];

  await finalizeInterview(failing, "iv1", "completed" as EndReason, (context, err) => {
    errors.push({ context, message: err instanceof Error ? err.message : String(err) });
  });

  assert.deepEqual(errors, [{ context: "lifecycle_write_failed", message: "connection reset" }]);
});

test("finalizeInterview does not call onError when the store succeeds", async () => {
  const store = new FakeLifecycleStore();
  let errorCalled = false;
  await finalizeInterview(store, "iv1", "completed", () => { errorCalled = true; });
  assert.equal(errorCalled, false);
  assert.equal(store.statusOf("iv1"), "complete");
});
