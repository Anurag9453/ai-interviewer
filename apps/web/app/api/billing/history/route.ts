import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Purchase history + current subscription — all RLS-scoped to the caller (select-own on every table read here). */
export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let results;
  try {
    results = await Promise.all([
      supabase.from("payment_transactions").select("*").order("created_at", { ascending: false }),
      supabase.from("subscriptions").select("*").order("created_at", { ascending: false }),
      supabase.from("credit_reversals").select("*").order("created_at", { ascending: false }),
      supabase.from("interview_credits").select("granted, consumed").single(),
    ]);
  } catch (err) {
    // A transport-level rejection (PostgREST unreachable) rather than a
    // per-query error.
    console.error("billing history request failed", err);
    return NextResponse.json({ error: "history_unavailable" }, { status: 502 });
  }

  const [transactions, subscriptions, reversals, credits] = results;

  // A failed query used to be reported as an empty history with a 200, which
  // tells a paying user they have no purchases — the worst possible wrong
  // answer for billing data. `interview_credits` is excluded from this check:
  // `.single()` legitimately errors when a brand-new user has no row yet.
  const failed = [transactions.error, subscriptions.error, reversals.error].filter(Boolean);
  if (failed.length > 0) {
    console.error("billing history query failed", failed);
    return NextResponse.json({ error: "history_unavailable" }, { status: 502 });
  }

  return NextResponse.json({
    transactions: transactions.data ?? [],
    subscriptions: subscriptions.data ?? [],
    reversals: reversals.data ?? [],
    credits: credits.data ?? null,
  });
}
