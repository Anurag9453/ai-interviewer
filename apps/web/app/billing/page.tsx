import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BillingClient } from "./BillingClient";

export default async function BillingPage() {
  const userId = await requireUserId();
  const supabase = await createClient();

  const [{ data: credits }, { data: products }] = await Promise.all([
    supabase.from("interview_credits").select("granted, consumed").eq("user_id", userId).single(),
    // billing_products RLS: "read active" — client-readable for authenticated.
    supabase.from("billing_products").select("id, name, kind, interview_quantity, price_cents, currency, billing_interval, description").eq("active", true).order("sort"),
  ]);

  const remaining = credits ? Math.max(0, credits.granted - credits.consumed) : 0;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-8">
        <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-muted)]">Billing</p>
        <h1 className="text-2xl font-semibold tracking-tight">Your plan</h1>
      </div>

      <div className="mb-8 rounded-xl border border-black/8 px-6 py-6 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-muted)]">Interviews remaining</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums">{remaining}</p>
      </div>

      <BillingClient products={products ?? []} />
    </main>
  );
}
