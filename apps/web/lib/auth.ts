import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * The only sanctioned way to get the current user id in a server context.
 * getClaims() verifies the JWT signature on every call; getSession() does not
 * and must never gate access.
 */
export async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");
  return userId;
}
