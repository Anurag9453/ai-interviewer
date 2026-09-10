import { handleWebhook } from "./handler.js";

export async function POST(request: Request) {
  // Imported lazily so route.test.ts (via handler.ts) can exercise
  // handleWebhook without pulling in supabase-billing-store.ts's
  // `server-only` guard (that guard stays in place — it's real
  // defense-in-depth against a service-role-key file ever landing in a
  // client bundle, unlike the redundant one removed from
  // document-extraction.ts).
  const { SupabaseBillingStore } = await import("@/lib/supabase-billing-store");
  return handleWebhook(request, new SupabaseBillingStore());
}
