/**
 * First-party Anthropic API provider — thin wrapper over the shared
 * Messages-API-compatible factory in anthropic-compatible.ts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createCompatibleProvider, type Pricing } from "./anthropic-compatible.js";
import type { LlmProvider } from "./types.js";

const LIVE_MODEL = "claude-opus-5";
const BATCH_MODEL = "claude-opus-5";

/** USD per million tokens, first-party API rates. */
const PRICING: Pricing = { input: 5.0, cacheWrite: 6.25, cacheRead: 0.5, output: 25.0 };

export class AnthropicProvider implements LlmProvider {
  private readonly inner: LlmProvider;
  readonly id = "anthropic";
  readonly liveModel = LIVE_MODEL;
  readonly batchModel = BATCH_MODEL;

  constructor(client?: Anthropic) {
    // Zero-arg resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ant profile.
    this.inner = createCompatibleProvider({
      id: "anthropic",
      liveModel: LIVE_MODEL,
      batchModel: BATCH_MODEL,
      client: client ?? new Anthropic(),
      AnthropicCtor: Anthropic,
      pricing: PRICING,
    });
  }

  openLiveSession: LlmProvider["openLiveSession"] = (init) => this.inner.openLiveSession(init);
  generateStructured: LlmProvider["generateStructured"] = (req, signal) =>
    this.inner.generateStructured(req, signal);
}
