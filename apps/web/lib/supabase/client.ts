import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client. Deliberately does not configure `cookies` — @supabase/ssr
 * handles that, and hand-rolling it causes random logouts.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
