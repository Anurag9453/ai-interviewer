/**
 * Browser-safe subset of @ai/core.
 *
 * The full barrel (index.ts) re-exports providers/index.ts, which imports
 * the concrete Anthropic and Bedrock adapters — both pull in SDKs whose
 * transitive dependencies (notably the AWS credential-provider chain) use
 * Node built-ins like `child_process`. Webpack cannot bundle those for the
 * browser and fails the build outright, not just bloats it — tree-shaking
 * does not save you here because the import graph is walked at build time
 * regardless of which symbols are actually used.
 *
 * Anything client-side (the mock interview session, browser components)
 * must import from "@ai/core/browser", never the bare "@ai/core" specifier.
 * This file exports everything EXCEPT providers/index.ts — provider TYPES
 * (LlmProvider, LiveSession, etc., from providers/types.js) are still here,
 * since they're pure interfaces with no SDK dependency; only the concrete
 * adapters and the createProvider() factory are excluded.
 */
export * from "./providers/types.js";
export * from "./schema/plan.js";
export * from "./schema/evaluation.js";
export * from "./schema/document-analysis.js";
export * from "./scoring.js";
export * from "./prompts/plan-generator.js";
export * from "./prompts/document-prompts.js";
export * from "./validate/plan-validator.js";
export * from "./document-analyzer.js";
export * from "./document-plan-generator.js";
export * from "./state/interview-machine.js";
export * from "./state/silence-ladder.js";
export * from "./state/ui-events.js";
export * from "./state/brain.js";
export * from "./state/runner.js";
export * from "./state/scripted-brain.js";
export * from "./state/claude-evaluation-brain.js";
export * from "./state/signal-ledger.js";
export * from "./state/adaptive-selection.js";
export * from "./state/evidence-sink.js";
export * from "./state/fake-provider.js";
export * from "./state/adaptive-brain.js";
