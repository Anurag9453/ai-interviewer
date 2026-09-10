import { AnthropicProvider } from "./anthropic.js";
import { BedrockProvider } from "./bedrock.js";
import type { LlmProvider } from "./types.js";

export * from "./types.js";
export { AnthropicProvider } from "./anthropic.js";
export { BedrockProvider, type BedrockProviderOptions } from "./bedrock.js";

export type ProviderId = "anthropic" | "bedrock";

/**
 * The single place the app chooses a provider. Adding one means adding an
 * adapter file and a case here; nothing else in the codebase changes —
 * ClaudeEvaluationBrain, agent.ts, and every other consumer only ever see
 * the LlmProvider interface.
 */
export function createProvider(id: ProviderId = readProviderId()): LlmProvider {
  switch (id) {
    case "anthropic":
      return new AnthropicProvider();
    case "bedrock": {
      const awsRegion = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
      if (!awsRegion) {
        throw new Error(
          "AI_PROVIDER=bedrock requires AWS_REGION (or AWS_DEFAULT_REGION) to be set",
        );
      }
      const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
      return new BedrockProvider({ awsRegion, ...(apiKey ? { apiKey } : {}) });
    }
    default: {
      const exhaustive: never = id;
      throw new Error(`unknown AI provider: ${String(exhaustive)}`);
    }
  }
}

function readProviderId(): ProviderId {
  const raw = process.env.AI_PROVIDER?.trim();
  if (!raw || raw === "anthropic") return "anthropic";
  if (raw === "bedrock") return "bedrock";
  throw new Error(`AI_PROVIDER="${raw}" is not implemented`);
}
