import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Real server-side admin check — `profiles.is_admin`, readable via the
 * normal "own profile: select" RLS policy (harmless: it's read-only column
 * access to your own row) but NOT client-writable (deliberately excluded
 * from the `update (display_name)` column grant in the M8 migration — no
 * client request, however shaped, can ever set it on themselves). This is
 * the actual authorization boundary, not a hidden route: every admin page
 * and every admin API route calls one of the two functions below before
 * doing anything else.
 */
async function isCurrentUserAdmin(): Promise<{ userId: string | null; isAdmin: boolean }> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub ?? null;
  if (!userId) return { userId: null, isAdmin: false };

  const { data } = await supabase.from("profiles").select("is_admin").eq("id", userId).single();
  return { userId, isAdmin: data?.is_admin === true };
}

/** For admin PAGE components — redirects a non-admin to /dashboard, same shape as requireUserId(). */
export async function requireAdminPage(): Promise<string> {
  const { userId, isAdmin } = await isCurrentUserAdmin();
  if (!userId) redirect("/login");
  if (!isAdmin) redirect("/dashboard");
  return userId;
}

/** For admin API routes — never redirects (an API route can't usefully send one); the caller returns a 401/403 JSON response. */
export async function checkAdminRequest(): Promise<{ ok: true; userId: string } | { ok: false; status: 401 | 403 }> {
  const { userId, isAdmin } = await isCurrentUserAdmin();
  if (!userId) return { ok: false, status: 401 };
  if (!isAdmin) return { ok: false, status: 403 };
  return { ok: true, userId };
}
