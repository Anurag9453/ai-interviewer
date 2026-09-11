# Backlog — extend prompt caching to the conversation prefix

Status: **not done**, deliberately deferred out of the P0 cost-metering commit.

## What already works

`CompatibleLiveSession` marks the `planContext` system block with
`cache_control: { type: "ephemeral", ttl: "1h" }`
(`packages/core/src/providers/anthropic-compatible.ts`). That block is the
largest fixed input — the generated plan, sections and answer keys — and one
session is reused for a whole interview, so every turn after the first reads it
from cache at 1/10th the input rate.

Until this commit nothing recorded whether that was actually happening:
`usage_events.llm_input_tokens` / `llm_output_tokens` were NULL in every row
because `onEvaluated` exposed only a cost figure. The new
`llm_cached_input_tokens` column plus the per-turn worker log make cache hit
rate observable for the first time. **Measure before optimising further.**

## What is still uncached

`this.messages` — the transcript, which grows by one candidate utterance and
one assistant turn per question. It is re-sent in full on every turn at the
fresh-input rate. Anthropic caches a prefix, so the standard fix is a
`cache_control` breakpoint on the last content block of the second-to-last
message, moved forward each turn.

## Why it is not in the P0 commit

1. That commit's job is to stop mis-reporting cost. Changing what we *send*
   mixes an accounting fix with a behaviour change and makes the before/after
   numbers uninterpretable.
2. Cache writes are billed above fresh input (1.25 vs 1.0 USD/M on the live
   table). With a short interview and a small transcript the breakpoint can
   cost more than it saves. Whether it pays depends on transcript size, which
   we can now measure and previously could not.
3. There is a 4-breakpoint limit per request; one is already spent on
   `planContext`. Placement needs to be deliberate, not incidental.

## Do this next

1. Run 3–5 production interviews with the fixed metering.
2. Query `llm_input_tokens` vs `llm_cached_input_tokens` per interview.
3. If fresh input grows materially across turns within an interview, add the
   rolling breakpoint and re-measure the same query. If it does not, close this.
