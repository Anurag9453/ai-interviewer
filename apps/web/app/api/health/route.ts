import { NextResponse } from "next/server";

/**
 * Liveness probe. Reports which server-side config is present, never values.
 *
 * Deliberate split between core and optional dependencies:
 *
 * CORE (gates `ok` and the 503) — without these the product cannot do the
 * thing it exists to do. No Supabase means no auth and no data; no LiveKit
 * means no voice session; no Anthropic key means no interviewer. A deployment
 * missing any of them is genuinely unhealthy and should fail a platform
 * health check.
 *
 * OPTIONAL (reported as `degraded`, still 200) — billing. An instance with no
 * Razorpay config can still sign users in and run their free interviews; only
 * purchasing is unavailable. Failing liveness would pull the whole service out
 * of rotation over a feature that isn't on the critical path, so this returns
 * 200 and names the degradation instead.
 *
 * What it must never do is report a flat `ok: true` while billing is
 * unconfigured — which is what it did before. That reads as "checkout works"
 * to anyone monitoring it, right up until a customer tries to pay.
 */
const CORE_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "NEXT_PUBLIC_LIVEKIT_URL",
] as const;

/** Billing needs all three: two to create a charge, one to trust the callback. */
const BILLING_ENV = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
] as const;

export function GET() {
  const missingCore = CORE_ENV.filter((k) => !process.env[k]);
  const missingBilling = BILLING_ENV.filter((k) => !process.env[k]);

  const healthy = missingCore.length === 0;
  const billingConfigured = missingBilling.length === 0;

  return NextResponse.json(
    {
      // `ok` answers exactly one question: can this instance serve the
      // product? It is not a claim that every subsystem is configured.
      ok: healthy,
      service: "web",
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
      dependencies: {
        core: healthy ? "ok" : "misconfigured",
        billing: billingConfigured ? "ok" : "not_configured",
      },
      // Names only — never values.
      missingEnv: missingCore,
      degraded: billingConfigured ? [] : ["billing"],
      missingOptionalEnv: missingBilling,
    },
    { status: healthy ? 200 : 503 },
  );
}
