import type { z } from "zod";

/**
 * Provider-neutral AI layer.
 *
 * The interview engine talks ONLY to these interfaces. Nothing below this file
 * knows that Claude exists. Swapping providers means adding one adapter and
 * changing one factory line — the state machine, scoring, and prompts are
 * untouched.
 */

/** Quality/latency intent. Adapters map this to their own knobs. */
export type Quality = "fast" | "balanced" | "thorough";

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costCents: number;
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  costCents: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costCents: a.costCents + b.costCents,
  };
}

/** JSON Schema is the common denominator for tool params across providers. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type TurnEvent =
  /** Emit to TTS immediately. Do not wait for the turn to finish. */
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "done"; usage: Usage; stopReason: string }
  | { type: "error"; error: Error; retryable: boolean };

export interface TurnInput {
  /** Verbatim candidate speech. Untrusted. Never rendered in an operator position. */
  candidateUtterance: string;
  /**
   * Per-turn operator state (current question, unresolved signals, probes used,
   * time left). The engine does not know how this is delivered: the Anthropic
   * adapter uses a mid-conversation `role: "system"` message so the cached
   * prefix survives; another adapter may use a developer message.
   */
  stateBlock: string;
}

/**
 * A live interview turn-taker. Stateful and single-use per interview: the
 * adapter owns the raw provider message history, which is what lets it handle
 * provider-specific requirements (echoing thinking blocks, cache_control
 * placement) without the engine knowing about them.
 */
export interface LiveSession {
  /** Streams one interviewer turn. Text deltas arrive before tool calls settle. */
  turn(input: TurnInput, signal?: AbortSignal): AsyncIterable<TurnEvent>;
  /** Must be called with a result for every tool_call emitted by the last turn. */
  settleToolCalls(results: Array<{ id: string; content: string }>): void;
  totalUsage(): Usage;
  dispose(): void;
}

export interface LiveSessionInit {
  /** Stable for the whole interview. Adapters may cache this prefix. */
  systemPrompt: string;
  /** Stable for the whole interview. Rendered after systemPrompt. */
  planContext: string;
  tools: ToolSpec[];
  maxOutputTokens?: number;
}

export interface StructuredRequest<T> {
  systemPrompt?: string;
  userPrompt: string;
  /**
   * Zod schema for the expected result. Zod is provider-agnostic: the
   * Anthropic adapter passes it through `zodOutputFormat`, other adapters can
   * convert it to JSON Schema. Keeping it here also gives the caller inferred
   * result types instead of `unknown`.
   */
  schema: z.ZodType<T>;
  quality: Quality;
  maxOutputTokens?: number;
}

export interface StructuredResult<T> {
  value: T;
  usage: Usage;
}

export interface LlmProvider {
  readonly id: string;
  /** Model used for latency-critical live turns. */
  readonly liveModel: string;
  /** Model used for offline plan generation and grading. */
  readonly batchModel: string;

  openLiveSession(init: LiveSessionInit): LiveSession;
  generateStructured<T>(req: StructuredRequest<T>, signal?: AbortSignal): Promise<StructuredResult<T>>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
