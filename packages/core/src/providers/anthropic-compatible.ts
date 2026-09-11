/**
 * Shared implementation for any client that speaks the Anthropic Messages
 * API wire format — the first-party API and Amazon Bedrock's Mantle client
 * both `extend BaseAnthropic` from `@anthropic-ai/sdk`, so `.messages.create
 * /.stream/.parse` share identical request/response types and the same
 * typed exception classes. Only the client construction and pricing differ
 * between platforms, so those are the only two things each thin wrapper
 * (anthropic.ts, bedrock.ts) supplies.
 *
 * Structured outputs and adaptive thinking are both GA on Bedrock per
 * shared/platform-availability.md, so this file works unmodified there.
 * Mid-conversation system messages are also supported on Bedrock, but only
 * via InvokeModel passthrough (not ARN-versioned models) — irrelevant here
 * since ClaudeEvaluationBrain (M2-B's only consumer so far) never calls
 * openLiveSession(); it only uses generateStructured().
 */
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  ZERO_USAGE,
  addUsage,
  ProviderError,
  type LiveSession,
  type LiveSessionInit,
  type LlmProvider,
  type Quality,
  type StructuredRequest,
  type StructuredResult,
  type ToolSpec,
  type TurnEvent,
  type TurnInput,
  type Usage,
} from "./types.js";

const EFFORT: Record<Quality, "low" | "high" | "max"> = {
  fast: "low",
  balanced: "high",
  thorough: "max",
};

export interface Pricing {
  /** USD per million tokens. */
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

function priceUsage(
  pricing: Pricing,
  u: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
): Usage {
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const dollars =
    (u.input_tokens * pricing.input +
      cacheWrite * pricing.cacheWrite +
      cacheRead * pricing.cacheRead +
      u.output_tokens * pricing.output) /
    1_000_000;
  return {
    inputTokens: u.input_tokens,
    cachedInputTokens: cacheRead,
    outputTokens: u.output_tokens,
    costCents: dollars * 100,
  };
}

/**
 * Classifies errors by the SDK's typed exception classes — the `Anthropic`
 * class reference is shared between the first-party and Bedrock packages
 * (pnpm dedupes the identical semver-compatible `@anthropic-ai/sdk` they
 * both depend on), so `instanceof` checks work for either client's errors.
 */
export function classify(AnthropicCtor: typeof Anthropic, err: unknown): ProviderError {
  if (err instanceof AnthropicCtor.RateLimitError)
    return new ProviderError("rate limited", true, err);
  if (err instanceof AnthropicCtor.APIConnectionError)
    return new ProviderError("connection failed", true, err);
  if (err instanceof AnthropicCtor.AuthenticationError)
    return new ProviderError("bad credentials", false, err);
  if (err instanceof AnthropicCtor.BadRequestError)
    return new ProviderError(`bad request: ${err.message}`, false, err);
  if (err instanceof AnthropicCtor.APIError)
    return new ProviderError(`api error ${err.status}`, (err.status ?? 500) >= 500, err);
  return new ProviderError(String(err), false, err);
}

function toAnthropicTools(tools: ToolSpec[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    strict: true,
    input_schema: t.parameters as Anthropic.Tool["input_schema"],
  }));
}

class CompatibleLiveSession implements LiveSession {
  private readonly system: Anthropic.TextBlockParam[];
  private readonly tools: Anthropic.Tool[];
  private readonly maxTokens: number;
  private messages: Anthropic.MessageParam[] = [];
  private pendingToolUseIds: string[] = [];
  private usage: Usage = ZERO_USAGE;
  private disposed = false;

  constructor(
    private readonly client: Anthropic,
    private readonly AnthropicCtor: typeof Anthropic,
    private readonly model: string,
    private readonly pricing: Pricing,
    init: LiveSessionInit,
  ) {
    this.tools = toAnthropicTools(init.tools);
    this.maxTokens = init.maxOutputTokens ?? 1024;
    this.system = [
      { type: "text", text: init.systemPrompt },
      { type: "text", text: init.planContext, cache_control: { type: "ephemeral", ttl: "1h" } },
    ];
  }

  async *turn(input: TurnInput, signal?: AbortSignal): AsyncIterable<TurnEvent> {
    if (this.disposed) throw new ProviderError("session disposed", false);
    if (this.pendingToolUseIds.length > 0) {
      throw new ProviderError(
        `settleToolCalls() not called for ${this.pendingToolUseIds.length} pending call(s)`,
        false,
      );
    }

    this.messages.push({ role: "user", content: input.candidateUtterance });
    this.messages.push({ role: "system", content: input.stateBlock } as unknown as Anthropic.MessageParam);

    let final: Anthropic.Message;
    try {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          system: this.system,
          messages: this.messages,
          tools: this.tools,
        },
        signal ? { signal } : undefined,
      );

      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) {
          yield { type: "text", delta: ev.delta.text };
        }
      }
      final = await stream.finalMessage();
    } catch (err) {
      const pe = classify(this.AnthropicCtor, err);
      this.messages.length = this.messages.length - 2;
      yield { type: "error", error: pe, retryable: pe.retryable };
      return;
    }

    this.messages.push({ role: "assistant", content: final.content });

    for (const block of final.content) {
      if (block.type === "tool_use") {
        this.pendingToolUseIds.push(block.id);
        yield { type: "tool_call", id: block.id, name: block.name, input: block.input };
      }
    }

    const turnUsage = priceUsage(this.pricing, final.usage);
    this.usage = addUsage(this.usage, turnUsage);
    yield { type: "done", usage: turnUsage, stopReason: final.stop_reason ?? "end_turn" };
  }

  settleToolCalls(results: Array<{ id: string; content: string }>): void {
    if (this.pendingToolUseIds.length === 0) return;
    const byId = new Map(results.map((r) => [r.id, r.content]));
    const blocks: Anthropic.ToolResultBlockParam[] = this.pendingToolUseIds.map((id) => ({
      type: "tool_result",
      tool_use_id: id,
      content: byId.get(id) ?? "ok",
    }));
    this.messages.push({ role: "user", content: blocks });
    this.pendingToolUseIds = [];
  }

  totalUsage(): Usage {
    return this.usage;
  }

  dispose(): void {
    this.disposed = true;
    this.messages = [];
    this.pendingToolUseIds = [];
  }
}

export interface CompatibleProviderConfig {
  id: string;
  liveModel: string;
  batchModel: string;
  client: Anthropic;
  AnthropicCtor: typeof Anthropic;
  /**
   * Separate tables because live and batch are different models at different
   * rates. Pricing the per-turn evaluator with the batch model's table would
   * misreport cost even once the accounting is otherwise correct.
   */
  livePricing: Pricing;
  batchPricing: Pricing;
}

/** Builds an LlmProvider from any Messages-API-compatible client + pricing. */
export function createCompatibleProvider(config: CompatibleProviderConfig): LlmProvider {
  const { id, liveModel, batchModel, client, AnthropicCtor, livePricing, batchPricing } = config;
  return {
    id,
    liveModel,
    batchModel,

    openLiveSession(init: LiveSessionInit): LiveSession {
      return new CompatibleLiveSession(client, AnthropicCtor, liveModel, livePricing, init);
    },

    async generateStructured<T>(
      req: StructuredRequest<T>,
      signal?: AbortSignal,
    ): Promise<StructuredResult<T>> {
      try {
        const res = await client.messages.parse(
          {
            model: batchModel,
            max_tokens: req.maxOutputTokens ?? 32_000,
            thinking: { type: "adaptive" },
            output_config: { effort: EFFORT[req.quality], format: zodOutputFormat(req.schema) },
            ...(req.systemPrompt ? { system: req.systemPrompt } : {}),
            messages: [{ role: "user", content: req.userPrompt }],
          },
          signal ? { signal } : undefined,
        );
        if (res.parsed_output == null) {
          throw new ProviderError("structured output failed to parse", true);
        }
        return { value: res.parsed_output as T, usage: priceUsage(batchPricing, res.usage) };
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw classify(AnthropicCtor, err);
      }
    },
  };
}
