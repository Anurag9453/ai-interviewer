/**
 * Durable per-interview usage/cost records (M8 §12) — purely additive to
 * agent.ts's existing turn-metrics.ts logging, not a change to it: the SAME
 * events (stt_metrics, tts_metrics, claude_usage/claude_degraded, speak_start)
 * already flow through agent.ts today; this module just also accumulates
 * them in memory and persists one row at teardown, alongside the existing
 * interview-lifecycle.ts hook.
 *
 * Two DIFFERENT kinds of number live here and must never be conflated:
 *
 *   llm_input_tokens / llm_output_tokens / llm_cached_input_tokens
 *     Real counts the provider returned. Facts.
 *
 *   llm_cost_cents
 *     Those real token counts multiplied by a LOCAL price table. Anthropic
 *     does not return a cost, so this is an estimate derived from facts —
 *     accurate only while the table matches current published rates.
 *
 *   estimated_cost_cents
 *     The weakest number: llm_cost_cents plus rough per-second/per-character
 *     guesses for STT and TTS. A planning figure, not an invoice.
 *
 * None of these is actual billed spend; only the provider's own console is.
 *
 * Token counts were null until 2026-09-11 because onEvaluated exposed only
 * {durationMs, costCents}. It now carries the full per-turn Usage, so they are
 * recorded. They are still never fabricated — a provider that omits a field
 * leaves it null rather than zero.
 */
import type { Sql } from "postgres";

export interface UsageAccumulator {
  durationS: number | null;
  sttProvider: string | null;
  sttAudioS: number;
  llmProvider: string | null;
  llmModel: string | null;
  llmCostCents: number;
  /** Real provider-reported counts, summed over per-turn deltas. */
  llmInputTokens: number;
  llmOutputTokens: number;
  llmCachedInputTokens: number;
  /** Number of evaluated turns — lets a reader sanity-check the cost per turn. */
  llmTurns: number;
  ttsProvider: string | null;
  ttsCharacters: number;
  livekitMinutes: number | null;
}

export function newUsageAccumulator(): UsageAccumulator {
  return {
    durationS: null, sttProvider: null, sttAudioS: 0,
    llmProvider: null, llmModel: null, llmCostCents: 0,
    llmInputTokens: 0, llmOutputTokens: 0, llmCachedInputTokens: 0, llmTurns: 0,
    ttsProvider: null, ttsCharacters: 0, livekitMinutes: null,
  };
}

/**
 * Rough, clearly-labeled estimate — STT/TTS providers are billed roughly
 * per-second/per-character; this is NOT a substitute for reading actual
 * provider invoices, only a same-order-of-magnitude planning number for the
 * admin unit-economics view. Never presented as the real llmCostCents,
 * which IS the provider-reported figure.
 */
export function estimateCostCents(u: UsageAccumulator): number {
  const sttCents = u.sttAudioS * 0.007; // ~$0.0043/min Deepgram nova-3, rounded up for headroom
  const ttsCents = (u.ttsCharacters / 1000) * 1.5; // ~$0.015/1k chars, Cartesia-order-of-magnitude
  return Math.round((sttCents + ttsCents + u.llmCostCents) * 100) / 100;
}

export async function persistUsageEvent(sql: Sql, interviewId: string, userId: string, u: UsageAccumulator): Promise<void> {
  const estimated = estimateCostCents(u);
  // Single transaction, single authoritative writer. interviews.cost_cents sat
  // at 0 forever because nothing wrote it; it is now derived from the same
  // accumulator as the usage row in the same commit, so the two can never
  // disagree. Deliberately NOT a second writer elsewhere.
  await sql.begin(async (tx) => {
    await tx`
      insert into public.usage_events
        (interview_id, user_id, duration_s, stt_provider, stt_audio_s, llm_provider, llm_model,
         llm_input_tokens, llm_output_tokens, llm_cached_input_tokens,
         llm_cost_cents, tts_provider, tts_characters, livekit_minutes, estimated_cost_cents, updated_at)
      values
        (${interviewId}, ${userId}, ${u.durationS}, ${u.sttProvider}, ${u.sttAudioS}, ${u.llmProvider}, ${u.llmModel},
         ${u.llmInputTokens}, ${u.llmOutputTokens}, ${u.llmCachedInputTokens},
         ${u.llmCostCents}, ${u.ttsProvider}, ${u.ttsCharacters}, ${u.livekitMinutes}, ${estimated}, now())
      on conflict (interview_id) do update set
        duration_s = excluded.duration_s, stt_audio_s = excluded.stt_audio_s,
        llm_input_tokens = excluded.llm_input_tokens,
        llm_output_tokens = excluded.llm_output_tokens,
        llm_cached_input_tokens = excluded.llm_cached_input_tokens,
        llm_cost_cents = excluded.llm_cost_cents, tts_characters = excluded.tts_characters,
        livekit_minutes = excluded.livekit_minutes, estimated_cost_cents = excluded.estimated_cost_cents,
        updated_at = now()`;

    await tx`update public.interviews set cost_cents = ${estimated} where id = ${interviewId}`;
  });
}
