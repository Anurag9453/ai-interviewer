# First real AI acceptance test — M5 gate

Status: **blocked**, not run. `ClaudeEvaluationBrain.evaluate()` fails on every
turn today — confirmed live on 2026-09-10, not from memory:

- Direct Anthropic key: `400 invalid_request_error` — "Your credit balance is
  too low to access the Anthropic API."
- Bedrock (`anthropic.claude-opus-5`, `AI_PROVIDER=bedrock`): `403` —
  "anthropic.claude-opus-5 is not available for this account."

Everything in M5 (real `livekit-client` connection, real LiveKit Cloud room,
real Deepgram STT, real Cartesia TTS, native barge-in, state machine +
silence ladder, browser audio playback, session lifecycle, security
boundaries) is proven. The one leg never exercised for real is Claude
producing a genuine interviewer response. **Do not claim adaptive
intelligence works until this test has actually been run and passed** — a
degrade-path interview completing normally is not the same thing, and M5's
own dry run produced exactly that (see "What M5 already showed" below).

Run this test as the first action once either the Anthropic Console balance
is topped up or the Bedrock model access request for `anthropic.claude-opus-5`
is approved. Re-verify with the same raw check used to confirm the block
before spending a real interview credit on it:

```
curl -s https://api.anthropic.com/v1/messages -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-5","max_tokens":16,"messages":[{"role":"user","content":"say hi"}]}'
```

## Preconditions

- `AI_PROVIDER` in `.env` set to whichever provider was actually unblocked.
- A real Supabase account with at least one free interview credit
  (`consume_interview_credit` RPC — check via the dashboard, don't assume).
- `apps/web` dev server and the voice-agent worker (`pnpm --filter
  @ai/voice-agent dev:worker`) both running against the **real** LiveKit
  Cloud project, Deepgram, and Cartesia — same as every other M5 run, nothing
  new to configure.
- This must go through the real product path: signed-in browser →
  `/interview/new` → **Start interview** → `/interview?interviewId=...`.
  Not a directly-minted token in a test harness — the M5 dry runs already
  covered the raw LiveKit path; this test's job is specifically the
  authenticated, product-shaped flow plus the Claude leg neither has
  exercised yet.

## Exact test flow

| # | Step | What to actually do / observe |
|---|---|---|
| 1 | Authenticated candidate starts a real interview | Sign in with Google, land on `/dashboard`, click **Start interview**. Confirm `POST /api/interviews` returns 200 and a credit was consumed (`remainingCredits` decremented). |
| 2 | Interviewer speaks the first question | Browser UI status shows "Interviewer speaking"; `ui_state` event `ai_speaking` arrives over `UI_TOPIC`; real audio is audible/recordable from the subscribed remote track. |
| 3 | Candidate gives a natural spoken answer | Speak a real, on-topic answer into the mic. UI status should show "Listening". |
| 4 | Deepgram produces the final transcript | Worker log line `utterance_final` with the real transcript text; `eou` metrics line with `endOfUtteranceDelayMs`. |
| 5 | Claude receives the answer and returns a genuine interviewer response | Worker log line `claude_usage` (NOT `claude_degraded`) with real `durationMs`/`costCents`, followed by `claude_eval` with `endOfSpeechToLlmOutputMs`. This is the line that has never fired successfully yet — its presence is itself part of what this test is proving. |
| 6 | Response is spoken through Cartesia | `speak_start` → `tts` (`ttfbMs`, `durationMs`, `cancelled:false`) → `speak_done` (`interrupted:false`) in the worker log; browser receives real audio bytes on the remote track (non-trivial `MediaRecorder` byte count, same check used in the M5 dry runs). |
| 7 | Interviewer asks a relevant follow-up when appropriate | Only happens if `outcome.hasUnresolvedSignals && probesRemaining > 0` — phase event `PROBE` (not `SELECT_NEXT`) over `UI_TOPIC`. Give at least one answer deliberately incomplete or vague so this branch is actually exercised, not just the plain-advance branch. |
| 8 | Candidate interrupts the interviewer | Start speaking clearly while `uiState` is still `ai_speaking`. |
| 9 | Interviewer stops and correctly receives the new turn | Worker log: `speak_done interrupted:true`, a `tts` line with `cancelled:true`, `"speech interrupted, new user turn detected"`. Confirm the new utterance is what actually gets evaluated, not the truncated old one. |
| 10 | Next question is selected appropriately | Phase event `SELECT_NEXT` → `ASK`, `progress` event with `questionNumber` incremented, and the question relates sensibly to prior context to the extent the plan/pool allows (M1's fixed pool — this is not testing question generation). |
| 11 | Interview completes normally | Phase sequence ends `CLOSING` → `GRADING` → `COMPLETE`; `{t:"ended", reason:"completed", reportPending:true}` reaches the browser; `session_close` / `job_shutdown` in the worker log. |

## Telemetry to capture

All of this already exists in `apps/voice-agent/src/turn-metrics.ts` and the
browser console instrumentation added in `apps/web/app/interview/page.tsx` —
this test's job is to capture it while a genuine Claude call is in the loop,
not to build new instrumentation.

| Metric | Source | Log line / field |
|---|---|---|
| Transcript | Worker log | `utterance_final.chars` (length only today — log the actual text manually for this run since PII redaction currently drops it from stdout) |
| Claude request/response timing | Worker log | `claude_usage.durationMs` (SDK-measured call time) and `claude_usage.costCents` |
| End-of-user-speech → first AI audio | Worker log + browser console | `claude_eval.endOfSpeechToLlmOutputMs` (server-side, speech-end → LLM output) plus browser's `[interview <id>] time to first AI audio` line (`page.tsx`) for the full speech-end → audible-in-browser figure |
| TTS TTFB | Worker log | `tts.ttfbMs` |
| Interruption latency | Worker log | `interruption.detectionDelayMs`, `interruption.totalDurationMs` (LiveKit's own `interruption_metrics`) |
| Question transitions | Browser console / `run-log.json`-style capture | `phase` events (`ASK`/`LISTEN`/`EVALUATE`/`PROBE`/`SELECT_NEXT`) and `progress` events |
| Fallback/degradation events | Worker log | `claude_degraded` — **must not appear** in a passing run; if it does, the test has not actually exercised a genuine Claude turn |
| Connection health | Browser console | `[interview <id>] connect time`, `connection state -> ...` lines from `interview-room.ts` |

Known instrumentation gap to be aware of going in: `claude_degraded` currently
logs no duration at all (only `reason` and the error message). If the first
real attempt fails for a reason other than the known billing/entitlement
block, there's no timing signal to tell a fast-fail from a slow timeout —
worth a one-line follow-up (`Date.now()` around the `evaluate()` call) if it
turns out to matter.

## What M5 already showed (baseline, not this test)

Three real dry runs on 2026-09-10 (real LiveKit Cloud, real Deepgram, real
Cartesia, synthetic mic audio, `claude_degraded` firing on every turn) give a
concrete non-Claude baseline to compare the real run against:

| Leg | Observed | Note |
|---|---|---|
| Connect time | 927ms – 1818ms | `InterviewRoomController.connect()`, real WSS handshake |
| TTS TTFB | ~170–380ms | Consistently small — Cartesia is not the bottleneck |
| TTS synthesis duration | 174ms – 1655ms | Scales with response length, as expected |
| End-of-speech → next `ai_speaking` | ~1.2s – 3.7s | Currently dominated by the fixed 1500ms `endpointing.minDelay` (agent.ts) plus whatever the (degraded) `evaluate()` call takes to fail — a genuine Claude call will very likely land in the same range or higher, since `evaluate()`'s real network latency wasn't part of any of these numbers (the 403 responses returned fast) |
| Silence ladder | nudge fired ~8s of true silence, offer ~15s, matches `DEFAULT_LADDER` config | Not itself a bottleneck, but adds real wall-clock to any turn where the candidate pauses before or after Claude responds |

**The one bottleneck this doc can already flag with confidence:** the fixed
1500ms `endpointing.minDelay` (`agent.ts`, chosen in M2-B to avoid
self-interrupting on candidate thinking pauses) is a hard floor added to
every single turn's end-of-speech latency, independent of Claude. Once a real
Claude latency number exists, compare `claude_eval.endOfSpeechToLlmOutputMs`
against this floor to see whether Claude or the endpointing delay dominates
turn latency — don't tune one without knowing which it is.

Nothing about Claude's real latency, real interruption behavior 8/9 with a
genuine mid-response answer, or real probe-branch behavior (step 7) can be
inferred from these dry runs — that's exactly the gap this acceptance test
closes.

## Reporting the result

Use the same report shape as the M5 close-out: browser/agent behavior
observed, pass/fail per numbered step above, the telemetry table filled in
with real numbers, and an explicit statement of whether `claude_degraded`
appeared even once. Only after a clean pass — zero `claude_degraded` events,
all 11 steps observed — should any product claim describe the interviewer as
Claude-backed or adaptive.
