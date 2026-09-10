/**
 * Live security verification for resume documents (M10.1).
 *
 * Runs against the REAL database and impersonates real authenticated users at
 * the SQL level (`set local role authenticated` + a forged
 * `request.jwt.claims`), which is exactly how PostgREST executes a client
 * query. That makes this a test of the actual enforcement boundary — RLS
 * policies and table grants — rather than of application code that could be
 * bypassed by any other caller.
 *
 * Lives in apps/voice-agent because that's where the `postgres` client
 * resolves; the concern is apps/web's, the tooling is here.
 *
 * Every row it creates is removed again, inside a transaction that is always
 * rolled back, so it cannot leave anything behind even on failure.
 *
 * Run: node --env-file=../../.env --import tsx src/_verify-resume-rls.ts
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

const results: Array<{ check: string; pass: boolean; detail: string }> = [];
function record(check: string, pass: boolean, detail = "") {
  results.push({ check, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${check}${detail ? ` — ${detail}` : ""}`);
}

/** Runs `fn` as the given authenticated user, the way PostgREST would. */
async function asUser<T>(tx: postgres.TransactionSql, userId: string, fn: () => Promise<T>): Promise<T> {
  await tx.unsafe(`set local role authenticated`);
  await tx.unsafe(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role: "authenticated" })}', true)`);
  try {
    return await fn();
  } finally {
    await tx.unsafe(`set local role postgres`);
  }
}


/**
 * Probes whether `authenticated` may run a write at all. Each probe gets its
 * own transaction: a permission error aborts the transaction it runs in, so
 * sharing one with the fixture checks would poison them. The grant check fires
 * before any row is matched, which is why a random id is sufficient.
 */
async function probeWriteDenied(userId: string, kind: "update" | "delete"): Promise<string> {
  const target = "00000000-0000-0000-0000-000000000000";
  try {
    return await sql.begin(async (tx) => {
      return await asUser(tx, userId, async () => {
        if (kind === "update") {
          await tx`update public.custom_documents set filename = 'x' where id = ${target}`;
        } else {
          await tx`delete from public.custom_documents where id = ${target}`;
        }
        return "allowed";
      });
    });
  } catch (err) {
    return err instanceof Error && /permission denied/i.test(err.message) ? "denied" : `other: ${err instanceof Error ? err.message : err}`;
  }
}

async function main() {
  const users = await sql<Array<{ id: string }>>`
    select user_id as id from public.interview_credits order by user_id limit 2`;
  if (users.length < 2) {
    console.error("need two existing users to test cross-user isolation; found", users.length);
    process.exitCode = 1;
    return;
  }
  const [userA, userB] = [users[0]!.id, users[1]!.id];
  console.log(`user A = ${userA}\nuser B = ${userB}\n`);

  // --- static boundary checks (no fixtures needed) -------------------------
  const grants = await sql<Array<{ privilege_type: string }>>`
    select privilege_type from information_schema.role_table_grants
    where table_name = 'custom_documents' and grantee = 'authenticated'`;
  const granted = grants.map((g) => g.privilege_type.toUpperCase()).sort();
  record(
    "custom_documents grants authenticated SELECT only (writes are service-role)",
    granted.length === 1 && granted[0] === "SELECT",
    `grants=[${granted.join(", ")}]`,
  );

  const policies = await sql<Array<{ policyname: string; cmd: string; qual: string | null }>>`
    select policyname, cmd, qual from pg_policies
    where schemaname = 'public' and tablename = 'custom_documents'`;
  const selectOwn = policies.find((p) => p.cmd === "SELECT");
  record(
    "custom_documents SELECT policy is scoped to auth.uid()",
    Boolean(selectOwn?.qual?.includes("auth.uid()") && selectOwn?.qual?.includes("user_id")),
    `policy=${selectOwn?.policyname ?? "none"}`,
  );
  record(
    "custom_documents has no client INSERT/UPDATE/DELETE policy",
    !policies.some((p) => ["INSERT", "UPDATE", "DELETE", "ALL"].includes(p.cmd)),
    `cmds=[${policies.map((p) => p.cmd).join(", ")}]`,
  );

  const storagePolicies = await sql<Array<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>>`
    select policyname, cmd, qual, with_check from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (qual like '%interview-documents%' or with_check like '%interview-documents%')`;
  record(
    "interview-documents storage policies key ownership on the first path segment",
    storagePolicies.length > 0 &&
      storagePolicies.every((p) => `${p.qual ?? ""}${p.with_check ?? ""}`.includes("foldername")),
    `${storagePolicies.length} policies: ${storagePolicies.map((p) => p.cmd).join(", ")}`,
  );

  // A resume's generated questions carry the grading signals and answer keys —
  // they must never be client-readable, or the candidate can read the answers.
  for (const table of ["interview_plans", "question_pool"]) {
    const g = await sql<Array<{ privilege_type: string }>>`
      select privilege_type from information_schema.role_table_grants
      where table_name = ${table} and grantee in ('authenticated', 'anon')`;
    record(`${table} is not readable by authenticated/anon`, g.length === 0, `grants=${g.length}`);
  }

  // --- cross-user isolation, with real fixture rows -----------------------
  // Everything below happens inside a transaction that is always rolled back.
  await sql
    .begin(async (tx) => {
      const [docA] = await tx<Array<{ id: string }>>`
        insert into public.custom_documents
          (user_id, filename, file_type, document_type, size_bytes, storage_path, status, extracted_text)
        values (${userA}, 'a-resume.pdf', 'pdf', 'resume', 1234,
                ${`${userA}/rls-check-a/a-resume.pdf`}, 'extracted', 'resume text A')
        returning id`;
      const [docB] = await tx<Array<{ id: string }>>`
        insert into public.custom_documents
          (user_id, filename, file_type, document_type, size_bytes, storage_path, status, extracted_text)
        values (${userB}, 'b-resume.pdf', 'pdf', 'resume', 5678,
                ${`${userB}/rls-check-b/b-resume.pdf`}, 'extracted', 'resume text B')
        returning id`;

      const aId = docA!.id;
      const bId = docB!.id;

      const aSees = await asUser(tx, userA, async () => {
        const rows = await tx<Array<{ id: string }>>`
          select id from public.custom_documents where id in (${aId}, ${bId})`;
        return rows.map((r) => r.id);
      });
      record(
        "user A sees their own resume document",
        aSees.includes(aId),
        `visible=${aSees.length}`,
      );
      record(
        "user A CANNOT see user B's resume document",
        !aSees.includes(bId),
        aSees.includes(bId) ? "LEAK: B's row was returned to A" : "correctly filtered",
      );

      const bSees = await asUser(tx, userB, async () => {
        const rows = await tx<Array<{ id: string }>>`
          select id from public.custom_documents where id in (${aId}, ${bId})`;
        return rows.map((r) => r.id);
      });
      record("user B CANNOT see user A's resume document", !bSees.includes(aId));

      // Direct fetch by a known id — the case where an id leaked or was guessed.
      const targeted = await asUser(tx, userA, async () => {
        const rows = await tx`select id, extracted_text from public.custom_documents where id = ${bId}`;
        return rows.length;
      });
      record("targeted fetch of another user's resume by id returns nothing", targeted === 0, `rows=${targeted}`);

      // Interview visibility: a resume interview must be visible only to its owner.
      const ivPolicies = await tx<Array<{ cmd: string; qual: string | null }>>`
        select cmd, qual from pg_policies where schemaname = 'public' and tablename = 'interviews'`;
      const ivSelect = ivPolicies.find((p) => p.cmd === "SELECT");
      record(
        "interviews SELECT policy is scoped to auth.uid()",
        Boolean(ivSelect?.qual?.includes("auth.uid()")),
        `qual=${ivSelect?.qual ?? "none"}`,
      );

      // Roll back — this verification must never persist fixtures.
      throw new Error("__rollback__");
    })
    .catch((err) => {
      if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
    });

  const updateOutcome = await probeWriteDenied(userA, "update");
  record("authenticated client cannot UPDATE custom_documents at all", updateOutcome === "denied", `outcome=${updateOutcome}`);
  const deleteOutcome = await probeWriteDenied(userA, "delete");
  record("authenticated client cannot DELETE custom_documents at all", deleteOutcome === "denied", `outcome=${deleteOutcome}`);

  const leftovers = await sql<Array<{ n: number }>>`
    select count(*)::int as n from public.custom_documents where storage_path like '%rls-check-%'`;
  record("no fixture rows persisted (transaction rolled back)", leftovers[0]!.n === 0, `found=${leftovers[0]!.n}`);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("verification aborted:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
