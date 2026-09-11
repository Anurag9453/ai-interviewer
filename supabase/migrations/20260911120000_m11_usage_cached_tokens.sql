-- P0 cost-metering fix (2026-09-11).
--
-- The live evaluator reuses one Anthropic session for a whole interview, so a
-- large and growing share of its input tokens are cache reads, billed at a
-- fraction of fresh input. Recording only input/output made cost look larger
-- and less explicable than it is, and left no way to tell whether caching was
-- working at all.
--
-- usage_events already had llm_input_tokens and llm_output_tokens (both NULL
-- in every row to date, because onEvaluated exposed only a cost figure). This
-- adds the third count so the three can be reconciled against the price table.
--
-- Nullable on purpose: a provider that does not report cache usage leaves this
-- NULL rather than 0, so "not reported" stays distinguishable from "zero".

alter table public.usage_events
  add column llm_cached_input_tokens integer;

comment on column public.usage_events.llm_cached_input_tokens is
  'Provider-reported cache-read input tokens. NULL means the provider did not report it, not zero.';

comment on column public.usage_events.llm_cost_cents is
  'Real token counts multiplied by a LOCAL price table — an estimate derived from facts, not billed spend. Anthropic does not return a cost.';

comment on column public.usage_events.estimated_cost_cents is
  'Weakest figure: llm_cost_cents plus rough STT/TTS/LiveKit guesses. Planning number only.';

comment on column public.interviews.cost_cents is
  'Mirrors usage_events.estimated_cost_cents, written in the same transaction by persistUsageEvent. Single authoritative writer — do not write this from anywhere else.';
