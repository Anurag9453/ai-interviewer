import type { GeneratedPlan, Question } from "../schema/plan.js";
import type { TopicSpec } from "../prompts/plan-generator.js";

export interface Issue {
  severity: "error" | "warn";
  rule: string;
  where: string;
  detail: string;
}

/**
 * Quality adjectives masquerading as observable signals.
 *
 * "well" needs a lookbehind: "explains it well" is a judgement, but "as well
 * as" is an ordinary conjunction and matching it produces false rejections.
 */
const JUDGEMENT_WORDS =
  /\b(clear(ly)?|good|properly|correctly|thorough(ly)?|strong|solid|appropriate(ly)?|understand(s|ing)?|demonstrates?|shows?)\b|(?<!\bas )\bwell\b/i;

/** Release-dependent status words that must never gate a score. */
const RELEASE_STATUS_WORDS = /\b(GA|generally available|beta|pilot|deprecated|API version)\b/i;

/** Framework product names — neutrality requirement. */
const FRAMEWORK_NAMES = /\b(fflib|apex-common|trigger actions|trigger handler framework|nebula|kitchen sink)\b/i;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export interface ValidateContext {
  topics: TopicSpec[];
  dimensions: string[];
  durationS: number;
  poolPerTopic: number;
  closingReserveS: number;
}

export function validatePlan(gen: GeneratedPlan, ctx: ValidateContext): Issue[] {
  const issues: Issue[] = [];
  const err = (rule: string, where: string, detail: string) =>
    issues.push({ severity: "error", rule, where, detail });
  const warn = (rule: string, where: string, detail: string) =>
    issues.push({ severity: "warn", rule, where, detail });

  const topicById = new Map(ctx.topics.map((t) => [t.id, t]));

  // ── plan-level ────────────────────────────────────────────────────────
  const weightSum = Object.values(gen.plan.dimensionWeights).reduce((a, b) => a + b, 0);
  if (Math.abs(weightSum - 1) > 0.001) {
    err("weights-sum", "plan.dimensionWeights", `sums to ${weightSum.toFixed(3)}, expected 1.0`);
  }
  for (const dim of Object.keys(gen.plan.dimensionWeights)) {
    if (!ctx.dimensions.includes(dim)) {
      err("unknown-dimension", "plan.dimensionWeights", `"${dim}" is not a category dimension`);
    }
  }

  const budget = gen.plan.sections.reduce((s, sec) => s + sec.budgetS, 0);
  const expected = ctx.durationS - ctx.closingReserveS;
  if (Math.abs(budget - expected) > 30) {
    err("section-budget", "plan.sections", `budgets total ${budget}s, expected ~${expected}s`);
  }

  // Prerequisites must not appear before the topic that needs them.
  const order: string[] = gen.plan.sections.flatMap((s) => s.topicIds);
  order.forEach((topicId, i) => {
    const topic = topicById.get(topicId);
    if (!topic) {
      err("unknown-topic", `sections[${i}]`, `"${topicId}" is not in the taxonomy`);
      return;
    }
    for (const pre of topic.prereqs) {
      const preIdx = order.indexOf(pre);
      if (preIdx !== -1 && preIdx > i) {
        err("prereq-order", topicId, `appears before its prerequisite "${pre}"`);
      }
    }
  });

  if (gen.plan.mode === "depth") {
    for (const sec of gen.plan.sections) {
      const anchor = sec.topicIds[0];
      if (anchor && topicById.get(anchor)?.depthReady === false) {
        err("depth-ready", sec.id, `anchored by "${anchor}", which is not depthReady`);
      }
    }
  }

  // ── per-question ──────────────────────────────────────────────────────
  const byTopic = new Map<string, Question[]>();
  const seenText = new Map<string, string>();

  for (const q of gen.questions) {
    const at = `question ${q.id}`;
    if (!topicById.has(q.topicId)) {
      err("unknown-topic", at, `topicId "${q.topicId}" is not in the taxonomy`);
    }
    byTopic.set(q.topicId, [...(byTopic.get(q.topicId) ?? []), q]);

    if (words(q.text) > 35) {
      err("question-length", at, `${words(q.text)} words, max 35 — this is read aloud`);
    }

    const norm = q.text.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    const dup = seenText.get(norm);
    if (dup) err("duplicate-question", at, `duplicates ${dup}`);
    else seenText.set(norm, q.id);

    for (const dim of q.scores) {
      if (!ctx.dimensions.includes(dim)) {
        err("unknown-dimension", at, `scores references unknown dimension "${dim}"`);
      }
    }
    // Requirement: one factual mistake must not be charged twice. Because a
    // question's signal ratio is applied uniformly to every dimension in
    // `scores`, listing both means a single missed signal reduces both. The
    // rule is therefore structural, not advisory.
    if (q.scores.includes("correctness") && q.scores.includes("technical_accuracy")) {
      err("correctness-accuracy-overlap", at,
        "scores both correctness and technical_accuracy; one mistake would be charged twice. " +
        "Pick whichever the question actually tests — claim truth, or naming precision.");
    }
    // relevance must stay narrow: whether the candidate addressed the question
    // asked rather than drifting. Because every dimension on a question gets
    // the same signal ratio, co-listing it with correctness makes the two
    // numerically identical — which is duplication, not a second measurement.
    if (q.scores.includes("relevance") && q.scores.includes("correctness")) {
      err("relevance-correctness-overlap", at,
        "scores both relevance and correctness; under uniform ratio scoring these " +
        "would be identical. Pick one: did they address the question, or was the claim true.");
    }
    if (q.kind === "definition" && q.scores.includes("problem_solving")) {
      err("dimension-mismatch", at, "a definition question cannot measure problem_solving");
    }

    // ── signals: the grading instrument ────────────────────────────────
    q.mustHear.forEach((sig, i) => {
      const sat = `${at} signal ${sig.id}`;

      if (JUDGEMENT_WORDS.test(sig.signal)) {
        err("signal-is-judgement", sat, `contains a quality adjective, not an observable: "${sig.signal}"`);
      }
      // The numeric ban. Release-dependent and edition-dependent values must
      // never gate a score.
      const nums = sig.signal.match(/\d+/g);
      if (nums) {
        err("signal-has-number", sat, `contains numeric value(s) ${nums.join(", ")} — numbers must never be a signal`);
      }
      if (RELEASE_STATUS_WORDS.test(sig.signal)) {
        err("signal-release-dependent", sat, `references release/version status: "${sig.signal}"`);
      }
      if (FRAMEWORK_NAMES.test(sig.signal)) {
        err("signal-names-framework", sat, "requires a specific framework — must state the architectural property instead");
      }

      // Probes must not hand over the answer.
      if (words(sig.probe) > 15) {
        warn("probe-length", sat, `probe is ${words(sig.probe)} words, prefer under 15`);
      }
      if (/\d+/.test(sig.probe)) {
        warn("probe-has-number", sat, "probe contains a number; prefer qualitative phrasing");
      }
      if (i === q.mustHear.length - 1 && sig.signal.length < 40) {
        warn("weak-top-signal", sat, "highest signal is unusually terse — confirm it is a volunteered insight, not trivia");
      }
    });

    // ── answer key ─────────────────────────────────────────────────────
    const k = q.answerKey;
    if (k.competent.trim() === k.excellent.trim()) {
      err("answer-key-flat", at, "competent and excellent are identical");
    }
    if (words(k.excellent) <= words(k.competent)) {
      warn("answer-key-gap", at, "excellent is not longer than competent — confirm the gap is the top signal, not wording");
    }
  }

  // ── pool coverage and question-kind mix ───────────────────────────────
  for (const topic of ctx.topics) {
    const qs = byTopic.get(topic.id) ?? [];
    if (qs.length < ctx.poolPerTopic) {
      warn("pool-size", topic.id, `${qs.length} questions, expected ${ctx.poolPerTopic}`);
    }
    const defs = qs.filter((q) => q.kind === "definition").length;
    if (defs > 1) {
      err("too-many-definitions", topic.id, `${defs} definition questions; at most 1 per topic — prefer scenarios`);
    }
    const reasoning = qs.filter((q) =>
      ["scenario", "tradeoff", "debug", "code_reasoning"].includes(q.kind),
    ).length;
    if (qs.length > 0 && reasoning / qs.length < 0.7) {
      err("trivia-heavy", topic.id,
        `only ${Math.round((reasoning / qs.length) * 100)}% reasoning-kind questions; require at least 70%`);
    }
  }

  return issues;
}

/** The LLM check for what regex cannot see. Run only if mechanical passes. */
export const LEAKAGE_CHECK_PROMPT = `You are auditing an interview question pool.

For EACH probe below, answer one question: could a candidate who knew nothing
about the topic produce the target signal just by echoing words from the probe?

Then for EACH question, answer: is the difference between the "competent" and
"excellent" answer keys exactly the highest must_hear signal — or do they
differ only in wording?

Return the failing ids with a one-line reason each. Return an empty list if
none fail. Be strict; a leaking probe silently inflates every score.`;
