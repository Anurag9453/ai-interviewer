"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const EmailSchema = z.string().trim().toLowerCase().email().max(254);

export type LoginState = { status: "idle" | "sent" | "error"; message?: string };

export async function sendMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = EmailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { status: "error", message: "Enter a valid email address." };
  }

  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });

  if (error) {
    // Never echo the provider message — it can confirm whether an address is
    // registered.
    return { status: "error", message: "Could not send the link. Try again." };
  }
  return { status: "sent" };
}
