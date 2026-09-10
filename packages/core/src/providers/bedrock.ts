/**
 * Amazon Bedrock provider — same LlmProvider seam as AnthropicProvider, so
 * ClaudeEvaluationBrain and agent.ts need zero changes to use this instead.
 * Verified against shared/platform-availability.md: structured outputs and
 * adaptive thinking are both GA on Bedrock.
 *
 * Model IDs on Bedrock take an "anthropic." prefix, unlike the first-party
 * API's bare "claude-opus-5".
 *
 * Auth, simplest first:
 *  1. A Bedrock API key (bearer token) — pass `apiKey`, or set
 *     AWS_BEARER_TOKEN_BEDROCK and the SDK picks it up. Generated in the
 *     Bedrock console under Discover -> API keys. Takes precedence over
 *     AWS credentials.
 *  2. Standard AWS credential chain (AWS_ACCESS_KEY_ID/SECRET, shared
 *     credentials file, IAM role) — same behavior as the regular AWS SDK.
 *
 * `awsRegion` is required either way; it builds the endpoint URL.
 *
 * Pricing note: Bedrock is partner-operated with its own price sheet
 * (https://aws.amazon.com/bedrock/pricing/), not necessarily identical to
 * first-party rates. The figures below are the first-party rates as a
 * placeholder — confirm against the AWS console before relying on cost
 * figures this provider reports.
 */
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { createCompatibleProvider, type Pricing } from "./anthropic-compatible.js";
import type { LlmProvider } from "./types.js";

const LIVE_MODEL = "anthropic.claude-opus-5";
const BATCH_MODEL = "anthropic.claude-opus-5";

/** PLACEHOLDER — verify against https://aws.amazon.com/bedrock/pricing/. */
const PRICING: Pricing = { input: 5.0, cacheWrite: 6.25, cacheRead: 0.5, output: 25.0 };

export interface BedrockProviderOptions {
  /** AWS region. Required — Bedrock model access is region-scoped. */
  awsRegion: string;
  /**
   * Bedrock API key (bearer token). Optional: when omitted the SDK falls
   * back to AWS_BEARER_TOKEN_BEDROCK, then the AWS credential chain.
   */
  apiKey?: string;
}

export class BedrockProvider implements LlmProvider {
  private readonly inner: LlmProvider;
  readonly id = "bedrock";
  readonly liveModel = LIVE_MODEL;
  readonly batchModel = BATCH_MODEL;

  constructor(opts: BedrockProviderOptions) {
    const client = new AnthropicBedrockMantle({
      awsRegion: opts.awsRegion,
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    });
    this.inner = createCompatibleProvider({
      id: "bedrock",
      liveModel: LIVE_MODEL,
      batchModel: BATCH_MODEL,
      // AnthropicBedrockMantle extends BaseAnthropic and shares the exact
      // Messages-API request/response types, so it satisfies the shared
      // factory's `Anthropic`-shaped client parameter structurally.
      client: client as unknown as Anthropic,
      AnthropicCtor: Anthropic,
      pricing: PRICING,
    });
  }

  openLiveSession: LlmProvider["openLiveSession"] = (init) => this.inner.openLiveSession(init);
  generateStructured: LlmProvider["generateStructured"] = (req, signal) =>
    this.inner.generateStructured(req, signal);
}
