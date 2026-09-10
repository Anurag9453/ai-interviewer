import { readFileSync } from "node:fs";
import postgres from "postgres";
function loadDotEnv(path: string) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    process.env[k] = v;
  }
}
loadDotEnv(new URL("../../../.env", import.meta.url).pathname);
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
try {
  const rows = await sql`
    select i.id, i.user_id, i.plan_id, i.category_id, i.difficulty, i.duration_s,
           i.status, i.room_name, i.created_at, p.plan_key
    from public.interviews i
    join public.interview_plans p on p.id = i.plan_id
    order by i.created_at desc limit 5`;
  console.log("=== interviews (most recent) ===");
  for (const r of rows) console.log(" ", r);
  console.log("\ntotal interview rows:", rows.length);
} finally {
  await sql.end({ timeout: 3 });
}
