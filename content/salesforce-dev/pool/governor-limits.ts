import type { Question } from "@ai/core";

const BASE = { maxProbes: 3, hardTimeS: 240, difficultyBand: "intermediate" } as const;

export const GOVERNOR_LIMITS_POOL: Question[] = [
  {
    ...BASE,
    id: "gl.batch-passes-small",
    topicId: "sfdev.governor_limits",
    text: "A job fails with a limit exception on real data, but the same code runs fine when you test it on a handful of records. What is going on?",
    kind: "scenario",
    scores: ["correctness", "depth", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "states that limits are consumed per transaction rather than per record or per job", probe: "What is the scope those limits apply to?" },
      { id: "s2", signal: "connects the larger volume to either repeated execution or accumulation inside one transaction", probe: "Why would more records change anything?" },
      { id: "s3", signal: "describes inspecting which limit was actually consumed rather than guessing", probe: "How would you find out which one you hit?" },
      { id: "s4", signal: "volunteers that the fix is restructuring how the work is divided rather than trimming it slightly", probe: "So what actually changes in the code?" },
    ],
    answerKey: {
      weak: "The test data was too small, so I would test with more records next time and see if it breaks again.",
      competent: "Limits are per transaction, so more records means more queries or more DML in the same execution. I would check the logs to see which limit was hit and then bulkify the code.",
      excellent: "Limits are per transaction, so low volume never reached them. I would read the limit consumption in the logs to confirm which one, then restructure so the work is divided across transactions rather than shaving a little off each pass, because trimming only moves the failure threshold.",
    },
  },
  {
    ...BASE,
    id: "gl.cpu-small-data",
    topicId: "sfdev.governor_limits",
    text: "A page is slow and sometimes errors out. The logs point at a CPU time exception, but the record volume involved is small. Where do you look?",
    kind: "debug",
    scores: ["correctness", "depth", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "states that CPU time is consumed by logic executed rather than by the number of rows touched", probe: "What actually consumes that particular limit?" },
      { id: "s2", signal: "names candidate causes such as nested iteration, repeated scanning of collections, or a long chain of automation firing on save", probe: "What kind of code burns it?" },
      { id: "s3", signal: "describes narrowing the cause by measuring rather than by reading the whole codebase", probe: "How would you narrow it down?" },
      { id: "s4", signal: "volunteers that moving the work into asynchronous execution raises the ceiling without reducing the work being done", probe: "Would making it asynchronous solve it?" },
    ],
    answerKey: {
      weak: "I would move the logic into an asynchronous job so it gets more time to finish running.",
      competent: "CPU time comes from the logic itself, not the row count. I would look for nested loops or repeated work over collections, and check whether other automation is firing on the same save.",
      excellent: "CPU time tracks the logic executed, so small data pointing at CPU suggests nested iteration or a long automation chain on save. I would measure where the time goes before changing anything, and I would not reach for asynchronous execution first, since that raises the ceiling without removing the work.",
    },
  },
  {
    ...BASE,
    id: "gl.raise-the-limit-request",
    topicId: "sfdev.governor_limits",
    text: "A stakeholder asks you to raise the limit your code keeps hitting so the feature can ship this week. How do you respond?",
    kind: "tradeoff",
    scores: ["correctness", "clarity", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "states that these ceilings are not something the team can adjust on request", probe: "Is that something you can change?" },
      { id: "s2", signal: "reframes the problem as reducing consumption rather than raising the ceiling", probe: "So what is the actual problem to solve?" },
      { id: "s3", signal: "names a concrete restructuring that would lower consumption", probe: "What would you change concretely?" },
      { id: "s4", signal: "volunteers what the restructuring costs, such as added complexity, later completion, or intermediate state being visible", probe: "What does that approach cost you?" },
    ],
    answerKey: {
      weak: "I would raise a support case asking for the limit to be increased for our organisation so we can ship on time.",
      competent: "Those ceilings are not adjustable, so the real work is using less. I would find where the consumption is concentrated and restructure that part, then re-test with realistic volume.",
      excellent: "They are not adjustable, so the question becomes how to consume less. I would restructure the heaviest part, most likely moving repeated work out of the per-record path. I would also say plainly that splitting it across transactions means the result lands later and partial state becomes visible, which the stakeholder needs to agree to.",
    },
  },
  {
    ...BASE,
    id: "gl.two-triggers-same-object",
    topicId: "sfdev.governor_limits",
    text: "Two separate pieces of automation on the same object each query the same parent records. Why does that matter, and what would you do about it?",
    kind: "scenario",
    scores: ["correctness", "depth"],
    mustHear: [
      { id: "s1", signal: "states that both run inside the same transaction and therefore share one budget", probe: "Do those two share anything?" },
      { id: "s2", signal: "names consolidating the queries or holding the fetched data in a shared context so it is read once", probe: "How would you avoid querying twice?" },
      { id: "s3", signal: "states that a single entry point per object makes the ordering and the total consumption controllable, without requiring any particular framework", probe: "What is the structural fix?" },
      { id: "s4", signal: "volunteers that the risk compounds as unrelated features are added to the same object later", probe: "Does this get better or worse over time?" },
    ],
    answerKey: {
      weak: "It is duplicated work, so I would delete one of the queries and have both pieces of automation share the other one.",
      competent: "They run in the same transaction so they share the budget, and the same parent records get read twice. I would consolidate so the parents are queried once and passed to both.",
      excellent: "Same transaction, one shared budget, so the duplicate read costs twice. I would route both through a single entry point for the object and fetch the parents once into a shared context. The real reason to do it now is that the next three features on this object will each add their own queries, and nobody will notice until something unrelated starts failing.",
    },
  },
  {
    ...BASE,
    id: "gl.transaction-scope",
    topicId: "sfdev.governor_limits",
    text: "What does it mean that these limits apply per transaction, and where does a transaction begin and end?",
    kind: "definition",
    scores: ["technical_accuracy", "clarity", "relevance"],
    mustHear: [
      { id: "s1", signal: "distinguishes transaction scope from per-record scope and from an organisation-wide allocation", probe: "What is the alternative it is not?" },
      { id: "s2", signal: "names what opens and closes a transaction, such as a save, a callable entry point, or one asynchronous execution", probe: "What starts one?" },
      { id: "s3", signal: "states that asynchronous execution is counted separately and runs against a higher ceiling", probe: "Does asynchronous work share the same budget?" },
    ],
    answerKey: {
      weak: "It means there is a cap on how many queries you can run in your organisation before it stops working.",
      competent: "The budget resets for each transaction. A save on a record is one transaction, and everything that fires during it shares that budget. Asynchronous work gets its own, with higher ceilings.",
      excellent: "It resets per transaction, not per record and not per org, which is why one save with many records is very different from many separate saves. A save, an inbound call, or a single asynchronous execution each open one. Asynchronous executions are counted separately against a higher ceiling, which is why moving work there changes what is possible without changing what the work costs.",
    },
  },
];
