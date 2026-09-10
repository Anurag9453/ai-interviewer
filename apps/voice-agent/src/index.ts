import { loadEnv } from "./env.js";
import { startHealthServer } from "./health.js";
import { createProvider } from "@ai/core";

const env = loadEnv();

// Constructed once at boot so a bad key fails the deploy, not an interview.
const provider = createProvider(env.AI_PROVIDER as "anthropic");

const server = startHealthServer(env.PORT, () => ({
  service: "voice-agent",
  provider: provider.id,
  liveModel: provider.liveModel,
  activeSessions: 0, // wired to the real worker in worker.ts
}));

// This process is the health-only boot check used since M0. The real
// LiveKit agent worker is `pnpm --filter @ai/voice-agent start:worker`
// (src/worker.ts), which runs the actual voice pipeline.

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[voice-agent] ${sig} — draining`);
    server.close(() => process.exit(0));
  });
}
