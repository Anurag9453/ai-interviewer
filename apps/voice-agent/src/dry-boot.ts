/**
 * Dry-boot check: verifies agent.ts's module-level code (imports, plugin
 * constructors, defineAgent()) executes cleanly with placeholder credentials
 * — everything short of ctx.connect() and a real network call, which need a
 * live LiveKit room and cannot be exercised without credentials.
 *
 * Not part of the app; run manually or from CI as a boot smoke test.
 */
import agentDef, {} from "./agent.js";
import { isAgent } from "@livekit/agents";

console.log("module loaded without throwing");
console.log("isAgent(default export):", isAgent(agentDef));
console.log("entry is a function:", typeof agentDef.entry === "function");
console.log("prewarm is a function:", typeof agentDef.prewarm === "function");
process.exit(0);
