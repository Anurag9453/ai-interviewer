import { z } from "zod";

/**
 * Fail fast at boot rather than mid-interview. A missing TTS key should stop
 * the deploy, not surface as silence to a candidate 8 minutes in.
 *
 * ANTHROPIC_API_KEY / AWS_REGION are conditionally required based on
 * AI_PROVIDER, via superRefine below, so switching providers doesn't force
 * every credential from every provider to be present at once.
 */
const BaseSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),
  DEEPGRAM_API_KEY: z.string().min(1),
  CARTESIA_API_KEY: z.string().min(1),
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  // Required as of M6.1: the production agent loads the real plan/question
  // pool and persists evidence + interview lifecycle status through a direct
  // Postgres connection (see plan-loader.ts / interview-lifecycle.ts / the
  // existing postgres-evidence-sink.ts). A missing value must fail at boot,
  // not silently leave every interview stuck at status "configuring".
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  PORT: z.coerce.number().int().default(8080),
  AI_PROVIDER: z.enum(["anthropic", "bedrock"]).default("anthropic"),
});

const EnvSchema = BaseSchema.superRefine((env, ctx) => {
  if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ANTHROPIC_API_KEY"],
      message: "required when AI_PROVIDER=anthropic",
    });
  }
  if (env.AI_PROVIDER === "bedrock" && !env.AWS_REGION) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AWS_REGION"],
      message: "required when AI_PROVIDER=bedrock",
    });
  }
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  // A blank line in .env (`FOO=`) exports an empty string, not an absent
  // key — so optional fields would fail min(1) on a value the author
  // clearly meant as "unset". Strip empties first so `FOO=` and a missing
  // FOO behave identically.
  const cleaned = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`voice-agent: invalid or missing env: ${missing}`);
  }
  return parsed.data;
}
