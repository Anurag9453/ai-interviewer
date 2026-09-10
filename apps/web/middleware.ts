import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static assets, the health probe, and the Razorpay webhook — the
  // webhook has no user session (it's a server-to-server POST with no
  // cookies), so running updateSession on it would either crash on missing
  // Supabase env or redirect the webhook POST to /login, silently breaking
  // every real delivery. Its own signature check is the real auth here.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/billing/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
