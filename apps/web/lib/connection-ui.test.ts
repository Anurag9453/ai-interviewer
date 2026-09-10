import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionBadgeFor, tokenErrorFor } from "./connection-ui.js";

test("connectionBadgeFor maps reconnecting to degraded and disconnected/failed to lost", () => {
  assert.equal(connectionBadgeFor("reconnecting", "good"), "degraded");
  assert.equal(connectionBadgeFor("disconnected", "good"), "lost");
  assert.equal(connectionBadgeFor("failed", "good"), "lost");
});

test("connectionBadgeFor falls back to the reducer's own connection quality for connecting/connected", () => {
  assert.equal(connectionBadgeFor("connecting", "good"), "good");
  assert.equal(connectionBadgeFor("connected", "degraded"), "degraded");
  assert.equal(connectionBadgeFor("connected", "lost"), "lost");
});

test("tokenErrorFor maps every documented token-route status to a distinct, correctly-retryable error", () => {
  assert.deepEqual(tokenErrorFor(401), { code: "unauthenticated", message: "Your session expired. Please sign in again.", retryable: false });
  assert.deepEqual(tokenErrorFor(403), { code: "not_your_interview", message: "This interview doesn't belong to your account.", retryable: false });
  assert.deepEqual(tokenErrorFor(404), { code: "not_found", message: "This interview couldn't be found.", retryable: false });
  assert.deepEqual(tokenErrorFor(409), { code: "interview_already_ended", message: "This interview has already ended.", retryable: false });
  assert.equal(tokenErrorFor(503).retryable, true);
});

test("tokenErrorFor falls back to a generic retryable error for an undocumented status", () => {
  const err = tokenErrorFor(500);
  assert.equal(err.code, "token_failed");
  assert.equal(err.retryable, true);
});
