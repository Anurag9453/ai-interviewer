import type { InterviewPlan, Question } from "@ai/core";
import { GOVERNOR_LIMITS_POOL } from "./governor-limits.js";
import { BULKIFICATION_POOL } from "./bulkification.js";
import { ASYNC_APEX_POOL } from "./async-apex.js";
import { SOQL_RELATIONSHIPS_POOL } from "./soql-relationships.js";
import { TESTING_POOL } from "./testing.js";
import { SECURITY_SHARING_POOL } from "./security-sharing.js";

export const POOL: Question[] = [
  ...GOVERNOR_LIMITS_POOL,
  ...BULKIFICATION_POOL,
  ...ASYNC_APEX_POOL,
  ...SOQL_RELATIONSHIPS_POOL,
  ...TESTING_POOL,
  ...SECURITY_SHARING_POOL,
];

export const PLAN: InterviewPlan = {
  planKey: "salesforce_dev|intermediate|depth|900|handauthored.v1",
  categoryId: "salesforce_dev",
  difficulty: "intermediate",
  mode: "depth",
  durationS: 900,
  persona: {
    name: "Priya",
    style:
      "Senior Salesforce engineer who runs this interview a few times a week. " +
      "Warm but brisk. Never praises an answer, never teaches, never summarises " +
      "what the candidate just said.",
    voiceId: "cartesia:priya-en",
  },
  // Two sections, prerequisites ahead of the topics that need them.
  sections: [
    {
      id: "sec.core",
      title: "Platform core",
      goal: "Establish depth on transaction behaviour, bulk-safe code, and querying",
      budgetS: 390,
      topicIds: ["sfdev.governor_limits", "sfdev.bulkification", "sfdev.soql_relationships"],
    },
    {
      id: "sec.applied",
      title: "Applied engineering",
      goal: "Probe judgement under constraints, and where correctness is invisible at runtime",
      budgetS: 390,
      topicIds: ["sfdev.async_apex", "sfdev.testing", "sfdev.security_sharing"],
    },
  ],
  dimensionWeights: {
    correctness: 0.20,
    relevance: 0.10,
    depth: 0.22,
    clarity: 0.13,
    technical_accuracy: 0.15,
    problem_solving: 0.20,
  },
  promptVersion: "handauthored/2026-09-09.1",
};
