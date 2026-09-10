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
const USER_ID = "32756d8c-2016-4fb2-8ea3-a6d0ab85aa49";
try {
  const [credit] = await sql`select granted, consumed, updated_at from public.interview_credits where user_id = ${USER_ID}`;
  const interviews = await sql`select id, status, room_name, created_at from public.interviews where user_id = ${USER_ID} order by created_at`;
  console.log("=== interview_credits ===", credit);
  console.log("=== interviews (count:", interviews.length, ") ===");
  for (const i of interviews) console.log(" ", i);
} finally {
  await sql.end({ timeout: 3 });
}
