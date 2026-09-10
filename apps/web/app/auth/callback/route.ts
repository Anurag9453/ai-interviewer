import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback (Google, and any other provider added later). Distinct
 * from /auth/confirm, which handles the magic-link OTP flow — OAuth carries
 * a `code` param and exchanges it via exchangeCodeForSession; magic link
 * carries a `token_hash` and uses verifyOtp. Different grant types, so kept
 * as separate routes rather than one handler branching on params.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  // Same-origin relative redirects only — an open redirect here would let an
  // attacker forward a freshly authenticated session to their own domain.
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=oauth_failed", origin));
  }

  // Behind a proxy (Vercel, etc.) `origin` can be the internal host — prefer
  // the forwarded host for the redirect when present, same pattern used for
  // the magic-link confirm route.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const base = forwardedHost && process.env.NODE_ENV === "production"
    ? `https://${forwardedHost}`
    : origin;

  return NextResponse.redirect(new URL(target, base));
}
