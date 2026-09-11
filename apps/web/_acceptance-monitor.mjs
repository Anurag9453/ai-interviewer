// Live acceptance monitor for the single real interview run.
// Read-only. Never starts, modifies, or ends an interview.
//
//   node --env-file=.env.local _acceptance-monitor.mjs baseline
//   node --env-file=.env.local _acceptance-monitor.mjs watch <seconds>
//   node --env-file=.env.local _acceptance-monitor.mjs report <baselineJsonPath>
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const EMAIL = "anurag94533@gmail.com";

async function targetUser() {
  const { data } = await svc.auth.admin.listUsers();
  const u = (data?.users ?? []).find((x) => x.email === EMAIL);
  if (!u) throw new Error(`no user ${EMAIL}`);
  return u;
}

async function snapshot() {
  const u = await targetUser();
  const [{ data: cred }, { count: interviews }, { count: questions }, { count: evals }, { count: seen }, { count: usage }] =
    await Promise.all([
      svc.from("interview_credits").select("granted,consumed").eq("user_id", u.id).single(),
      svc.from("interviews").select("*", { count: "exact", head: true }),
      svc.from("interview_questions").select("*", { count: "exact", head: true }),
      svc.from("answer_evaluations").select("*", { count: "exact", head: true }),
      svc.from("seen_questions").select("*", { count: "exact", head: true }),
      svc.from("usage_events").select("*", { count: "exact", head: true }),
    ]);
  const { data: mine } = await svc
    .from("interviews")
    .select("id,status,end_reason,started_at,ended_at,actual_duration_s,plan_id,cost_cents,created_at")
    .eq("user_id", u.id)
    .order("created_at", { ascending: false });
  return {
    at: new Date().toISOString(),
    userId: u.id,
    granted: cred.granted,
    consumed: cred.consumed,
    remaining: cred.granted - cred.consumed,
    interviews, questions, evals, seen, usage,
    mine: mine ?? [],
  };
}

const cmd = process.argv[2];

if (cmd === "baseline") {
  const s = await snapshot();
  writeFileSync("/tmp/acceptance-baseline.json", JSON.stringify(s, null, 2));
  console.log("=== BASELINE ===");
  console.log(`  user:               ${EMAIL} (${s.userId.slice(0, 8)})`);
  console.log(`  remaining credits:  ${s.remaining}  ${s.remaining === 1 ? "OK expected 1" : "MISMATCH expected 1"}`);
  console.log(`  interviews total:   ${s.interviews}  ${s.interviews === 4 ? "OK expected 4" : "MISMATCH expected 4"}`);
  console.log(`  interview_questions: ${s.questions}`);
  console.log(`  answer_evaluations:  ${s.evals}`);
  console.log(`  seen_questions:      ${s.seen}`);
  console.log(`  usage_events:        ${s.usage}`);
  console.log(`  this user's interviews: ${s.mine.length}`);
  for (const i of s.mine) console.log(`    ${i.id.slice(0, 8)} ${i.status} ${i.created_at.slice(0, 16)}`);
  const go = s.remaining === 1 && s.interviews === 4;
  console.log(`  GO/NO-GO: ${go ? "GO" : "NO-GO"}`);
  process.exit(go ? 0 : 1);
}

if (cmd === "watch") {
  const seconds = Number(process.argv[3] ?? 1200);
  const base = JSON.parse(readFileSync("/tmp/acceptance-baseline.json", "utf8"));
  const deadline = Date.now() + seconds * 1000;
  let last = "";
  console.log(`watching for ${seconds}s — logging only on CHANGE`);
  while (Date.now() < deadline) {
    const s = await snapshot();
    const newIv = s.mine.filter((i) => !base.mine.some((b) => b.id === i.id));
    const line = JSON.stringify({
      rem: s.remaining, iv: s.interviews, q: s.questions, e: s.evals, seen: s.seen, usage: s.usage,
      new: newIv.map((i) => `${i.id.slice(0, 8)}:${i.status}:${i.end_reason ?? "-"}`),
    });
    if (line !== last) {
      console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);
      last = line;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log("watch window ended");
  process.exit(0);
}

if (cmd === "report") {
  const base = JSON.parse(readFileSync("/tmp/acceptance-baseline.json", "utf8"));
  const s = await snapshot();
  const newIv = s.mine.filter((i) => !base.mine.some((b) => b.id === i.id));
  console.log("=== DELTA vs BASELINE ===");
  console.log(`  credits remaining:   ${base.remaining} -> ${s.remaining}   (consumed ${s.consumed - base.consumed})`);
  console.log(`  interviews total:    ${base.interviews} -> ${s.interviews}   (+${s.interviews - base.interviews})`);
  console.log(`  interview_questions: ${base.questions} -> ${s.questions}   (+${s.questions - base.questions})`);
  console.log(`  answer_evaluations:  ${base.evals} -> ${s.evals}   (+${s.evals - base.evals})`);
  console.log(`  seen_questions:      ${base.seen} -> ${s.seen}   (+${s.seen - base.seen})`);
  console.log(`  usage_events:        ${base.usage} -> ${s.usage}   (+${s.usage - base.usage})`);
  console.log(`  NEW interviews: ${newIv.length}`);
  for (const i of newIv) {
    console.log(`    id=${i.id}`);
    console.log(`      status=${i.status} end_reason=${i.end_reason ?? "-"}`);
    console.log(`      started=${i.started_at ?? "-"} ended=${i.ended_at ?? "-"} duration_s=${i.actual_duration_s ?? "-"}`);
    console.log(`      cost_cents=${i.cost_cents}`);
  }
  if (newIv.length === 1) {
    const id = newIv[0].id;
    const { data: qs } = await svc
      .from("interview_questions")
      .select("id,seq,question_id,asked_at,question_text")
      .eq("interview_id", id)
      .order("seq");
    console.log(`\n  --- interview_questions for ${id.slice(0, 8)} (${(qs ?? []).length}) ---`);
    for (const q of qs ?? []) {
      console.log(`    seq=${q.seq} qid=${q.question_id ?? "-"} asked=${(q.asked_at ?? "").slice(11, 19)}`);
      if (q.question_text) console.log(`      "${String(q.question_text).slice(0, 100)}"`);
    }
    const ids = (qs ?? []).map((q) => q.id);
    if (ids.length) {
      const { data: evs } = await svc
        .from("answer_evaluations")
        .select("interview_question_id,signals,transcript,evaluated_at")
        .in("interview_question_id", ids);
      console.log(`\n  --- answer_evaluations (${(evs ?? []).length}) ---`);
      for (const e of evs ?? []) {
        const sig = e.signals;
        const n = Array.isArray(sig) ? sig.length : sig && typeof sig === "object" ? Object.keys(sig).length : 0;
        console.log(`    for q=${String(e.interview_question_id).slice(0, 8)} signals=${n} transcript_len=${(e.transcript ?? "").length}`);
      }
    }
  }
}
