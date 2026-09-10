import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** POST-only by convention — signing out is a state change, not a GET. */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url));
}
