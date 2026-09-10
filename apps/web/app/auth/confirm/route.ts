import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Magic-link landing route. Exchanges the token_hash for a session cookie. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");

  // Only allow same-origin relative redirects — an open redirect here would
  // let an attacker forward a fresh session to their own domain.
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL("/login?error=invalid_link", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return NextResponse.redirect(new URL("/login?error=expired_link", origin));
  }
  return NextResponse.redirect(new URL(target, origin));
}
