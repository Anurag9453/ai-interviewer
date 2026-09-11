/**
 * First-party Anthropic API provider — thin wrapper over the shared
 * Messages-API-compatible factory in anthropic-compatible.ts.
 *
 * LIVE and BATCH are deliberately different models with their own price
 * tables. They do different work:
 *
 *   LIVE  — per-turn signal judging inside AdaptiveBrain. Runs several times
 *           per interview against a growing conversation, so it dominates
 *           runtime cost. The task is narrow: given a question's mustHear
 *           signals and a transcript, emit record_signal tool calls. That is
 *           structured extraction against explicit criteria, not open-ended
 *           reasoning, so the cheapest capable model is the right default.
 *
 *   BATCH — offline question/plan generation. Runs once per document and its
 *           output is reused by every future interview, so quality compounds
 *           and the cost is amortised. Worth the expensive model.
 *
 * Until 2026-09-11 both were "claude-opus-5" from a single constant, which
 * meant every per-turn evaluation ran on the most expensive model available.
 * Nothing chose that for the live path — it inherited it.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createCompatibleProvider, type Pricing } from "./anthropic-compatible.js";
import type { LlmProvider } from "./types.js";

/**
 * Per-turn evaluator. Overridable so the model can be changed without a
 * deploy, but the default is explicit and cheap — there is deliberately NO
 * fallback to BATCH_MODEL: an unset or bogus env var must not silently
 * promote routine evaluation onto Opus.
 */
const DEFAULT_LIVE_MODEL = "claude-haiku-4-5-20251001";
const BATCH_MODEL = "claude-opus-5";

/**
 * USD per million tokens, first-party API rates.
 *
 * VERIFY against https://www.anthropic.com/pricing before relying on these
 * for a pricing decision — they are a local table, not a figure any provider
 * reports back, and rates change. Every cost this code produces is therefore
 * an ESTIMATE derived from real token counts, never actual billed spend.
 */
const LIVE_PRICING: Pricing = { input: 1.0, cacheWrite: 1.25, cacheRead: 0.1, output: 5.0 };
const BATCH_PRICING: Pricing = { input: 5.0, cacheWrite: 6.25, cacheRead: 0.5, output: 25.0 };

/**
 * Resolves the live model from config. An explicitly-set empty value is a
 * configuration error rather than a request for the default, so it throws
 * instead of quietly picking something expensive.
 */
export function resolveLiveModel(env: Record<string, string | undefined> = process.env): string {
  const configured = env.ANTHROPIC_LIVE_MODEL;
  if (configured === undefined) return DEFAULT_LIVE_MODEL;
  const trimmed = configured.trim();
  if (trimmed === "") {
    throw new Error("ANTHROPIC_LIVE_MODEL is set but empty — unset it to use the default, or give it a model id");
  }
  return trimmed;
}

export class AnthropicProvider implements LlmProvider {
  private readonly inner: LlmProvider;
  readonly id = "anthropic";
  readonly liveModel: string;
  readonly batchModel = BATCH_MODEL;

  constructor(client?: Anthropic, env: Record<string, string | undefined> = process.env) {
    this.liveModel = resolveLiveModel(env);
    // Zero-arg resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ant profile.
    this.inner = createCompatibleProvider({
      id: "anthropic",
      liveModel: this.liveModel,
      batchModel: BATCH_MODEL,
      client: client ?? new Anthropic(),
      AnthropicCtor: Anthropic,
      livePricing: LIVE_PRICING,
      batchPricing: BATCH_PRICING,
    });
  }

  openLiveSession: LlmProvider["openLiveSession"] = (init) => this.inner.openLiveSession(init);
  generateStructured: LlmProvider["generateStructured"] = (req, signal) =>
    this.inner.generateStructured(req, signal);
}

/** Exported for tests and for anyone auditing which model runs where. */
export const ANTHROPIC_MODELS = {
  defaultLive: DEFAULT_LIVE_MODEL,
  batch: BATCH_MODEL,
  livePricing: LIVE_PRICING,
  batchPricing: BATCH_PRICING,
} as const;
