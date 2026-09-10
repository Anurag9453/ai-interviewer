import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateSpeaking, decodeUiEvent, deriveUiState, encodeUiEvent, type UiEvent,
} from "./ui-events.js";

test("maps LiveKit state pairs onto the four UI states", () => {
  assert.equal(deriveUiState("initializing", "listening"), "connecting");
  assert.equal(deriveUiState("speaking", "listening"), "ai_speaking");
  assert.equal(deriveUiState("thinking", "listening"), "processing");
  assert.equal(deriveUiState("listening", "speaking"), "listening");
  assert.equal(deriveUiState("listening", "listening"), "listening");
  assert.equal(deriveUiState("idle", "away"), "listening");
});

test("barge-in shows as ai_speaking while the candidate is already talking", () => {
  // Both are true mid-interruption; the screen must keep showing the agent as
  // speaking until LiveKit actually stops it.
  assert.equal(deriveUiState("speaking", "speaking"), "ai_speaking");
  assert.equal(candidateSpeaking("speaking"), true);
});

test("round-trips a UI event over the wire", () => {
  const e: UiEvent = { t: "clock", elapsedS: 42, remainingS: 858 };
  assert.deepEqual(decodeUiEvent(encodeUiEvent(e)), e);
});

test("malformed wire payloads decode to null rather than throwing", () => {
  assert.equal(decodeUiEvent(new TextEncoder().encode("not json")), null);
  assert.equal(decodeUiEvent(new TextEncoder().encode('{"no":"tag"}')), null);
});
