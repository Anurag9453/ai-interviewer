/**
 * Manual provider smoke check. Makes ONE real call through whichever
 * provider AI_PROVIDER selects, so the credential path can be verified
 * end to end before running the voice agent.
 *
 *   set -a && source .env && set +a
 *   pnpm --filter @ai/core exec tsx src/providers/smoke-check.ts
 */
import { z } from "zod";
import { createProvider } from "./index.js";

const provider = createProvider();
console.log(`provider: ${provider.id} | model: ${provider.batchModel}`);

const started = Date.now();
try {
  const result = await provider.generateStructured({
    systemPrompt: "You are a terse test harness. Follow the instruction exactly.",
    userPrompt: "Return shouldProbe false and probe as an empty string.",
    schema: z.object({ shouldProbe: z.boolean(), probe: z.string() }),
    quality: "fast",
    maxOutputTokens: 512,
  });
  console.log(
    `OK ${JSON.stringify(result.value)} | ${Date.now() - started}ms | ` +
      `${result.usage.inputTokens} in / ${result.usage.outputTokens} out | ` +
      `${result.usage.costCents.toFixed(4)} cents`,
  );
} catch (err) {
  console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
