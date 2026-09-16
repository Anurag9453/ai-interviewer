import { requireUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader, Card, PageHeading } from "@/components/ui";
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
    <>
      <AppHeader current="billing" />
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-7 sm:px-6 sm:pt-10">
        <div className="mb-6 animate-rise">
          <PageHeading
            eyebrow="Billing"
            title="Your plan"
            sub="Credits are used one-for-one, for any kind of interview."
          />
        </div>

        <Card className="mb-8 px-6 py-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-accent-ink)]">
            Interviews remaining
          </p>
          <p className="font-display mt-2 text-6xl tabular-nums leading-none">{remaining}</p>
        </Card>

        <BillingClient products={products ?? []} />
      </main>
    </>
  );
}
