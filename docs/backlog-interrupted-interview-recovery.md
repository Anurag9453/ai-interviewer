# Backlog milestone — Interrupted Interview Recovery

**Status: documented, NOT implemented. Do not build this before first beta readiness.**

Recorded so the design constraints aren't lost. Nothing in the current
codebase implements resume, and no partial work toward it exists.

## Problem

An accidental disconnect currently ends the interview permanently, and the
credit is already spent. Today's behaviour:

- `apps/voice-agent/src/interview-lifecycle.ts` maps a participant disconnect
  to `status = 'abandoned'`, `end_reason = 'disconnected'` — a terminal state.
- `markEnded` is idempotent and first-write-wins, so once abandoned, an
  interview cannot be revived by the current code path.
- `/api/interviews/[id]/token` refuses to reissue a token for a terminal
  interview (`TERMINAL_STATUSES` → 409 `interview_already_ended`).
- The credit was consumed at creation (`consume_interview_credit`), so a
  candidate whose wifi drops mid-answer loses both the session and the credit.

A closed laptop, a browser crash, or a tunnel/network blip is therefore
indistinguishable from giving up.

## Requirements (from the product decision)

1. An accidental disconnect or network failure must not immediately lose the
   interview.
2. Persisted state must be sufficient to resume.
3. **Intentional End Interview stays terminal** — a user who chooses to end
   must not be offered a resume. The distinction already exists in the data
   (`end_reason` `'user_ended'` vs `'disconnected'`), and must remain the
   authority.
4. A laptop or browser shutdown must preserve enough state for recovery.
5. A resumed interview must continue with the existing `AdaptiveBrain` and
   evidence context — not restart, and not begin a second parallel evaluation.
6. **No duplicate credit consumption on resume.**

## What already helps

The hard part — durable evidence — is largely done:

- `interview_questions` (one row per asked question, with `seq`) and
  `answer_evaluations` are written turn-by-turn during the interview, not at
  the end, so an interrupted interview already has its history on disk.
- `seen_questions` prevents re-asking, and `AdaptiveBrainOptions.seenQuestionIds`
  is already an input — a resumed brain can be told what was covered.
- `interviews` carries `plan_id`, `started_at`, `actual_duration_s`, so the
  clock and the plan are recoverable.
- `loadPlanData()` is pure and re-runnable for the same `plan_id`.

## Design questions to settle before building

- **A non-terminal interrupted state.** `interviews.status` currently checks
  `('configuring','live','grading','complete','abandoned')`. Recovery likely
  needs something like `'interrupted'`, with a deadline after which it becomes
  `'abandoned'` for real. That's a migration plus a decision about the window.
- **Signal-ledger reconstruction.** `AdaptiveBrain` holds its ledger in
  memory. Resuming means rebuilding it from `answer_evaluations` —
  `toSignalRecords`/`signal-ledger.ts` are the natural seam, but round-tripping
  needs verifying, not assuming.
- **Clock semantics.** Does the remaining time carry over, or does the
  interview resume with a fresh budget? Carrying over is more honest; it needs
  `actual_duration_s` to be accurate at interrupt time.
- **Credit accounting.** The credit stays spent, so resume must not consume a
  second one, and abandoning after the recovery window must not refund one
  either (the interview genuinely happened). Reserve-then-compensate already
  exists in `/api/interviews`; resume must not re-enter it.
- **LiveKit room reuse.** `interviews.room_name` is unique; a resumed session
  must decide between rejoining the same room name and minting a new one.
- **Whose choice is it.** The candidate should almost certainly be offered
  "resume" vs "end it here", rather than resume happening silently.

## Explicitly out of scope for this milestone

Everything else in the current freeze list: more categories, more payment
features, new AI providers, UI redesign, additional analytics.
