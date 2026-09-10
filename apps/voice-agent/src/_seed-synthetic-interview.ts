/**
 * SYNTHETIC FIXTURE — not a real AI interview.
 *
 * M6.1's acceptance criteria ask for a deterministic way to exercise the
 * report/history/progress UI against real-shaped, correctly-persisted rows
 * (real question_pool/interview_plans content, real RLS boundaries) without
 * running the live agent or spending the one remaining free interview
 * credit. This script inserts exactly the rows agent.ts would have written
 * for a real interview — nothing more, nothing computed differently — but
 * skips consume_interview_credit() entirely and never touches Claude,
 * Deepgram, Cartesia, or LiveKit.
 *
 * Every row this creates is clearly marked as synthetic so it can never be
 * mistaken for genuine candidate data:
 *   - interviews.room_name is prefixed "synthetic_"
 *   - interview_turns.text is prefixed "[SYNTHETIC]"
 *   - answer_evaluations.model is literally "synthetic-fixture"
 *
 * Usage:
 *   pnpm --filter @ai/voice-agent exec tsx src/_seed-synthetic-interview.ts --user-id <uuid>
 *   pnpm --filter @ai/voice-agent exec tsx src/_seed-synthetic-interview.ts --cleanup <interview-id>
 *
 * Reads DATABASE_URL from the repo root .env, same as the other _verify-*
 * scripts in apps/voice-agent/src.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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

async function cleanup(interviewId: string) {
  const [row] = await sql<{ room_name: string | null }[]>`
    select room_name from public.interviews where id = ${interviewId}`;
  if (!row) {
    console.log(`no interview ${interviewId} found — nothing to do`);
    return;
  }
  if (!row.room_name?.startsWith("synthetic_")) {
    throw new Error(`refusing to delete ${interviewId} — room_name "${row.room_name}" is not a synthetic fixture`);
  }
  // Child rows cascade via FK (interview_questions -> interview_turns/
  // answer_evaluations all have `on delete cascade`).
  await sql`delete from public.interviews where id = ${interviewId}`;
  console.log(`deleted synthetic interview ${interviewId}`);
}

async function seed(userId: string) {
  const [plan] = await sql<{ id: string; category_id: string; difficulty: string; duration_s: number }[]>`
    select id, category_id, difficulty, duration_s from public.interview_plans
    where category_id = 'salesforce_dev' and difficulty = 'intermediate' order by validated_at desc limit 1`;
  if (!plan) throw new Error("no seeded interview_plans row for salesforce_dev/intermediate — run content/scripts/seed.ts first");

  const questions = await sql<{ id: string; text: string; scores: string[]; must_hear: Array<{ id: string; signal: string; probe: string }> }[]>`
    select id, text, scores, must_hear from public.question_pool where plan_id = ${plan.id} order by external_id limit 2`;
  if (questions.length < 2) throw new Error(`question_pool has fewer than 2 rows for plan ${plan.id}`);

  const interviewId = randomUUID();
  const startedAt = new Date(Date.now() - plan.duration_s * 1000 * 0.7);
  const endedAt = new Date();

  await sql.begin(async (tx) => {
    await tx`
      insert into public.interviews
        (id, user_id, plan_id, category_id, difficulty, duration_s, status, room_name, started_at, ended_at, actual_duration_s, end_reason)
      values (${interviewId}, ${userId}, ${plan.id}, ${plan.category_id}, ${plan.difficulty}, ${plan.duration_s},
              'complete', ${"synthetic_" + interviewId}, ${startedAt}, ${endedAt}, ${Math.round(plan.duration_s * 0.7)}, 'completed')`;

    // Question 1: fully covered — every signal heard.
    const [iq1] = await tx<{ id: string }[]>`
      insert into public.interview_questions (interview_id, question_id, seq, difficulty_at_ask, asked_at, closed_at, close_reason, probes_used)
      values (${interviewId}, ${questions[0]!.id}, 1, 'intermediate', ${startedAt}, now(), 'covered', 0)
      returning id`;
    await tx`
      insert into public.interview_turns (interview_question_id, turn_index, speaker, text, is_probe)
      values
        (${iq1!.id}, 0, 'interviewer', ${"[SYNTHETIC] " + questions[0]!.text}, false),
        (${iq1!.id}, 1, 'candidate', '[SYNTHETIC] a complete, on-topic answer covering every expected point.', false)`;
    await tx`
      insert into public.answer_evaluations (interview_question_id, signals, model)
      values (${iq1!.id}, ${tx.json(questions[0]!.must_hear.map((m) => ({ signal_id: m.id, status: "heard", evidence_turn_id: null, quote: "[SYNTHETIC] " + m.signal })))}, 'synthetic-fixture')`;

    // Question 2: partially covered — one signal missing, one partial, rest heard,
    // so the report's "areas to work on" and partial/missing rendering both have real rows to show.
    const [iq2] = await tx<{ id: string }[]>`
      insert into public.interview_questions (interview_id, question_id, seq, difficulty_at_ask, asked_at, closed_at, close_reason, probes_used)
      values (${interviewId}, ${questions[1]!.id}, 2, 'intermediate', ${startedAt}, now(), 'probes_exhausted', 1)
      returning id`;
    await tx`
      insert into public.interview_turns (interview_question_id, turn_index, speaker, text, is_probe)
      values
        (${iq2!.id}, 0, 'interviewer', ${"[SYNTHETIC] " + questions[1]!.text}, false),
        (${iq2!.id}, 1, 'candidate', '[SYNTHETIC] a partial answer that misses one expected point.', false),
        (${iq2!.id}, 2, 'interviewer', '[SYNTHETIC] a follow-up probe targeting the gap.', true),
        (${iq2!.id}, 3, 'candidate', '[SYNTHETIC] a follow-up answer that still does not fully resolve it.', false)`;
    const signals2 = questions[1]!.must_hear.map((m, i) => ({
      signal_id: m.id,
      status: i === 0 ? "missing" : i === 1 ? "partial" : "heard",
      evidence_turn_id: null,
      quote: i === 0 ? "" : "[SYNTHETIC] " + m.signal,
    }));
    await tx`
      insert into public.answer_evaluations (interview_question_id, signals, model)
      values (${iq2!.id}, ${tx.json(signals2)}, 'synthetic-fixture')`;
  });

  console.log("=== synthetic interview created ===");
  console.log("interviewId:", interviewId);
  console.log("userId:     ", userId);
  console.log("report URL: /interview/" + interviewId + "/report");
  console.log("\nTo remove it:");
  console.log(`  pnpm --filter @ai/voice-agent exec tsx src/_seed-synthetic-interview.ts --cleanup ${interviewId}`);
}

async function main() {
  const args = process.argv.slice(2);
  const cleanupIdx = args.indexOf("--cleanup");
  if (cleanupIdx >= 0) {
    const id = args[cleanupIdx + 1];
    if (!id) throw new Error("--cleanup requires an interview id");
    await cleanup(id);
    return;
  }
  const userIdx = args.indexOf("--user-id");
  const userId = userIdx >= 0 ? args[userIdx + 1] : undefined;
  if (!userId) throw new Error("usage: seed-synthetic-interview.ts --user-id <uuid>  (or --cleanup <interview-id>)");
  await seed(userId);
}

try {
  await main();
} finally {
  await sql.end({ timeout: 3 });
}
