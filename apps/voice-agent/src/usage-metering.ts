/**
 * Durable per-interview usage/cost records (M8 §12) — purely additive to
 * agent.ts's existing turn-metrics.ts logging, not a change to it: the SAME
 * events (stt_metrics, tts_metrics, claude_usage/claude_degraded, speak_start)
 * already flow through agent.ts today; this module just also accumulates
 * them in memory and persists one row at teardown, alongside the existing
 * interview-lifecycle.ts hook.
 *
 * Raw usage stays separate from the derived cost estimate (usage_events has
 * both llm_cost_cents — real, reported by the provider — and
 * estimated_cost_cents — this module's own rough STT/TTS/LiveKit estimate,
 * clearly a different, weaker kind of number). Token counts
 * (llm_input_tokens/llm_output_tokens) are left null: AdaptiveBrain's
 * onEvaluated callback only exposes {durationMs, costCents} today, and
 * widening it is out of this milestone's explicit "do not redesign
 * AdaptiveBrain" scope — not faked, genuinely unavailable at this call site.
 */
import type { Sql } from "postgres";

export interface UsageAccumulator {
  durationS: number | null;
  sttProvider: string | null;
  sttAudioS: number;
  llmProvider: string | null;
  llmModel: string | null;
  llmCostCents: number;
  ttsProvider: string | null;
  ttsCharacters: number;
  livekitMinutes: number | null;
}

export function newUsageAccumulator(): UsageAccumulator {
  return {
    durationS: null, sttProvider: null, sttAudioS: 0,
    llmProvider: null, llmModel: null, llmCostCents: 0,
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
  await sql`
    insert into public.usage_events
      (interview_id, user_id, duration_s, stt_provider, stt_audio_s, llm_provider, llm_model,
       llm_cost_cents, tts_provider, tts_characters, livekit_minutes, estimated_cost_cents, updated_at)
    values
      (${interviewId}, ${userId}, ${u.durationS}, ${u.sttProvider}, ${u.sttAudioS}, ${u.llmProvider}, ${u.llmModel},
       ${u.llmCostCents}, ${u.ttsProvider}, ${u.ttsCharacters}, ${u.livekitMinutes}, ${estimateCostCents(u)}, now())
    on conflict (interview_id) do update set
      duration_s = excluded.duration_s, stt_audio_s = excluded.stt_audio_s,
      llm_cost_cents = excluded.llm_cost_cents, tts_characters = excluded.tts_characters,
      livekit_minutes = excluded.livekit_minutes, estimated_cost_cents = excluded.estimated_cost_cents,
      updated_at = now()`;
}
