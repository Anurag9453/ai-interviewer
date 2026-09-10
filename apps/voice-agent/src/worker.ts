/**
 * The real LiveKit agent worker process.
 *
 * `src/index.ts` (unchanged since M0) is a health-only boot check; this file
 * is the actual voice-pipeline process — it runs the health server alongside
 * `cli.runApp`, which owns the worker lifecycle (job dispatch, drain,
 * shutdown) and parses its own CLI subcommands (`dev`/`start`/`connect`).
 *
 *   pnpm --filter @ai/voice-agent dev:worker    # LiveKit CLI dev mode
 *   pnpm --filter @ai/voice-agent start:worker  # production
 */
import { fileURLToPath } from "node:url";
import { cli, WorkerOptions } from "@livekit/agents";
import { createProvider } from "@ai/core";
import { loadEnv } from "./env.js";
import { startHealthServer } from "./health.js";

const env = loadEnv();

// Constructed here so a bad provider config fails at worker boot rather
// than inside the first interview, and so health reports the model the
// provider actually uses (Bedrock prefixes it with "anthropic.").
const provider = createProvider(env.AI_PROVIDER);

let activeJobs = 0;
startHealthServer(env.PORT, () => ({
  service: "voice-agent-worker",
  provider: provider.id,
  liveModel: provider.liveModel,
  activeSessions: activeJobs,
}));

// `agent:` is a file path — LiveKit runs each job in its own subprocess and
// re-imports the module there via IPC, so it must be a resolvable path, not
// the already-imported module object.
cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(new URL("./agent.js", import.meta.url)),
    wsURL: env.LIVEKIT_URL,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    requestFunc: async (job) => {
      // JobRequest.accept() is not automatic once requestFunc is overridden —
      // omitting it would silently mean no job ever launches.
      await job.accept();
      activeJobs += 1;
      console.log(JSON.stringify({ ts: Date.now(), event: "job_accepted", jobId: job.id }));
    },
  }),
);
