/**
 * One-off admin grant of acceptance-testing credits.
 *
 * Uses the EXISTING grant_interview_credits() SECURITY DEFINER RPC — the same
 * function the Razorpay webhook calls — rather than touching interview_credits
 * directly. That means the additive credit_grants ledger, the fast-path
 * balance, and the audit trail all stay consistent with production behaviour.
 *
 * Explicitly NOT changed: free-trial logic, subscription logic, pricing,
 * entitlement rules, and consume_interview_credit(). Credits land in the same
 * single fungible balance the app already reads, so consumption still goes
 * through the normal race-safe server-side path.
 *
 * Scoped to exactly one account by email lookup, and the note records why the
 * grant exists so it is auditable and reversible
 * (reverse_interview_credits() can undo it).
 *
 * Run: node --env-file=.env.local _grant-test-credits.mjs
 */
import { createClient } from "@supabase/supabase-js";

const EMAIL = "anurag94533@gmail.com";
const AMOUNT = 10;
const SOURCE = "promo"; // allowed by the credit_grants source check constraint
const NOTE = "admin:acceptance-testing — production acceptance test credits, not a customer purchase";

const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: users, error: userErr } = await svc.auth.admin.listUsers();
if (userErr) throw userErr;
const target = (users?.users ?? []).find((u) => u.email === EMAIL);
if (!target) throw new Error(`no user found for ${EMAIL} — refusing to grant`);

// Guard: never touch anyone else, even if the lookup somehow returned extras.
const others = (users?.users ?? []).filter((u) => u.email !== EMAIL);
console.log(`target: ${target.email} (${target.id})`);
console.log(`other accounts in project: ${others.length} — none will be modified`);

const balance = async () => {
  const { data } = await svc
    .from("interview_credits").select("granted,consumed").eq("user_id", target.id).single();
  return data;
};
const grantCount = async () => {
  const { count } = await svc
    .from("credit_grants").select("*", { count: "exact", head: true }).eq("user_id", target.id);
  return count;
};

const before = await balance();
const beforeGrants = await grantCount();
console.log("\n=== BEFORE ===");
console.log(`  granted=${before.granted} consumed=${before.consumed} remaining=${before.granted - before.consumed}`);
console.log(`  credit_grants rows: ${beforeGrants}`);

const { error: rpcErr } = await svc.rpc("grant_interview_credits", {
  p_user_id: target.id,
  p_source: SOURCE,
  p_amount: AMOUNT,
  p_note: NOTE,
});
if (rpcErr) {
  console.error("\nGRANT FAILED:", rpcErr.message);
  process.exit(1);
}

const after = await balance();
const afterGrants = await grantCount();
console.log("\n=== AFTER ===");
console.log(`  granted=${after.granted} consumed=${after.consumed} remaining=${after.granted - after.consumed}`);
console.log(`  credit_grants rows: ${afterGrants}`);
console.log(`  delta: granted +${after.granted - before.granted}, remaining +${(after.granted - after.consumed) - (before.granted - before.consumed)}`);
console.log(`  consumed unchanged: ${after.consumed === before.consumed ? "yes" : "NO — unexpected"}`);

const { data: row } = await svc
  .from("credit_grants").select("id,source,amount,note,granted_at")
  .eq("user_id", target.id).order("granted_at", { ascending: false }).limit(1).single();
console.log("\n=== NEW LEDGER ROW (auditable / reversible) ===");
console.log(`  id:      ${row.id}`);
console.log(`  source:  ${row.source}`);
console.log(`  amount:  ${row.amount}`);
console.log(`  note:    ${row.note}`);
console.log(`  granted: ${row.granted_at}`);

console.log("\n=== OTHER ACCOUNTS UNCHANGED ===");
for (const u of others) {
  const { data: c } = await svc
    .from("interview_credits").select("granted,consumed").eq("user_id", u.id).maybeSingle();
  console.log(`  ${u.email}: ${c ? `granted=${c.granted} consumed=${c.consumed}` : "no credit row"}`);
}
