import type { Question } from "@ai/core";

const BASE = { maxProbes: 3, hardTimeS: 240, difficultyBand: "intermediate" } as const;

export const SOQL_RELATIONSHIPS_POOL: Question[] = [
  {
    ...BASE,
    id: "sq.query-degrades-with-growth",
    topicId: "sfdev.soql_relationships",
    text: "A query that has been fine for two years starts timing out as the object grows. Nothing about the query changed. What happened?",
    kind: "debug",
    scores: ["correctness", "depth", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "states that the filter is no longer narrowing the result enough relative to the size of the object", probe: "What about growth would change the query's behaviour?" },
      { id: "s2", signal: "identifies what makes a filter able to narrow efficiently, such as the field being indexed or the value being rare", probe: "What makes a filter efficient?" },
      { id: "s3", signal: "names a concrete change, such as filtering on an indexed field, tightening the range, or adding an index", probe: "What would you change?" },
      { id: "s4", signal: "volunteers that the query was always inefficient and only the data volume made it visible", probe: "Was this query ever correct?" },
    ],
    answerKey: {
      weak: "The table got bigger so the query takes longer. I would add a limit clause so it returns fewer records and finishes faster.",
      competent: "The filter is not selective enough for the current size. Probably filtering on something unindexed or on a value that matches most rows. I would filter on an indexed field or narrow the range.",
      excellent: "The filter stopped being selective relative to the object size, so the platform can no longer use an index and falls back to scanning. I would filter on an indexed field, or narrow the range so fewer rows qualify. Worth naming that the query was always inefficient, volume just made it visible, so the same mistake is probably elsewhere in the codebase waiting for its own growth curve.",
    },
  },
  {
    ...BASE,
    id: "sq.parent-and-children-together",
    topicId: "sfdev.soql_relationships",
    text: "You need fields from a record's parent and also its child records, in as few reads as possible. How do you write that?",
    kind: "code_reasoning",
    scores: ["technical_accuracy", "depth"],
    mustHear: [
      { id: "s1", signal: "names traversing upward to the parent by walking the relationship in the field list", probe: "How do you reach the parent?" },
      { id: "s2", signal: "names retrieving children through a nested query inside the field list", probe: "And the children?" },
      { id: "s3", signal: "states that both can be done in the same single read rather than requiring separate queries", probe: "How many reads is that?" },
      { id: "s4", signal: "volunteers a constraint on the nested form, such as bounded nesting depth or that filtering and ordering behave differently inside it", probe: "Any limitation on the nested part?" },
    ],
    answerKey: {
      weak: "I would query the record, then query the parent, then query the children, and combine the three results in Apex afterwards.",
      competent: "One query. Walk the relationship in the field list for parent fields, and put a nested query in the field list for the children. That gets everything in a single read.",
      excellent: "A single read does both: dot through the relationship for parent fields, and a nested query in the field list for children. The nested form is where people get surprised, since nesting is bounded and filtering inside it does not behave like a top-level filter, so I would not lean on it for anything deep.",
    },
  },
  {
    ...BASE,
    id: "sq.for-loop-vs-list",
    topicId: "sfdev.soql_relationships",
    text: "When would you iterate a query directly rather than assigning the results to a list first?",
    kind: "tradeoff",
    scores: ["technical_accuracy", "depth", "problem_solving", "relevance"],
    mustHear: [
      { id: "s1", signal: "states that assigning everything to a list holds all of it in memory at once", probe: "What is the cost of the list version?" },
      { id: "s2", signal: "identifies that iterating the query directly processes in portions and keeps memory bounded", probe: "What does iterating directly do differently?" },
      { id: "s3", signal: "names the situation that decides it, namely a result set large enough that memory becomes the constraint", probe: "When does it actually matter?" },
      { id: "s4", signal: "volunteers that this addresses memory only and does nothing for the number of reads or the time spent", probe: "Which limit does this help with?" },
    ],
    answerKey: {
      weak: "I would iterate the query directly because it is more efficient and uses fewer queries than assigning to a list first.",
      competent: "When the result set is big enough that holding it all in memory is a problem. Iterating the query directly works through it in portions so memory stays bounded.",
      excellent: "When the result is large enough that memory is the binding constraint rather than the query count. Iterating directly works in portions and keeps the footprint flat. What it does not do is reduce reads or processing time, so if the actual problem is the number of queries or time spent, this changes nothing and I would be looking somewhere else.",
    },
  },
  {
    ...BASE,
    id: "sq.three-object-fetch",
    topicId: "sfdev.soql_relationships",
    text: "A screen needs data spanning three related objects. Talk me through how you would fetch it.",
    kind: "scenario",
    scores: ["depth", "problem_solving", "clarity", "relevance"],
    mustHear: [
      { id: "s1", signal: "establishes the direction of the relationships before deciding on the query shape", probe: "What do you need to know before writing it?" },
      { id: "s2", signal: "states which parts can be combined into one read and which genuinely require a separate one", probe: "Can that be one query?" },
      { id: "s3", signal: "keeps the total number of reads bounded rather than proportional to the records involved", probe: "How many reads does your approach take?" },
      { id: "s4", signal: "volunteers that fetching only the fields the screen uses matters as much as the number of reads", probe: "Anything else you would be careful about?" },
    ],
    answerKey: {
      weak: "I would query each object separately and then loop through the results to match the records up in Apex.",
      competent: "First I would check which way the relationships run. Anything reachable upward goes in the field list, children go in a nested query. If a leg is not reachable from the root, that is a second query keyed by id.",
      excellent: "I would map the relationship directions first, because that decides the shape entirely. Whatever is reachable from the root goes into one read, upward through the field list and downward through a nested query, with any unreachable leg as one more keyed query. Two reads, not two per record. I would also only select the fields the screen renders, since a wide select is the other way this gets expensive.",
    },
  },
  {
    ...BASE,
    id: "sq.selective-meaning",
    topicId: "sfdev.soql_relationships",
    text: "What makes a query selective?",
    kind: "definition",
    scores: ["technical_accuracy", "clarity", "relevance"],
    mustHear: [
      { id: "s1", signal: "states that it concerns the proportion of rows the filter eliminates rather than how the query is written", probe: "Selective with respect to what?" },
      { id: "s2", signal: "names the role of an index on the filtered field", probe: "What does the platform need in order to do that?" },
      { id: "s3", signal: "states that the same query can be selective on a small object and not on a large one", probe: "Is it a fixed property of the query?" },
    ],
    answerKey: {
      weak: "A selective query is one that has a where clause and a limit so it does not return too many records at once.",
      competent: "The filter narrows to a small proportion of the rows, and it is on an indexed field so the platform can use the index instead of scanning. The same query can stop being selective as the object grows.",
      excellent: "It is about the fraction of rows the filter eliminates, not the syntax. The platform needs an index on the filtered field and a filter narrow enough to be worth using it. The important part is that it is not a fixed property of the query at all: the identical query can be selective on a small object and non-selective on a large one, so this is something that degrades with growth rather than something you get right once.",
    },
  },
];
