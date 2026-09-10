import type { Question } from "@ai/core";

const BASE = { maxProbes: 3, hardTimeS: 240, difficultyBand: "intermediate" } as const;

export const BULKIFICATION_POOL: Question[] = [
  {
    ...BASE,
    id: "bk.sandbox-to-load",
    topicId: "sfdev.bulkification",
    text: "A trigger passes every test in your sandbox and then fails during a large data load. Where do you look first?",
    kind: "scenario",
    scores: ["correctness", "depth", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "identifies a query or a data operation placed inside a loop over the incoming records", probe: "What in that code makes the record count matter?" },
      { id: "s2", signal: "names which kind of limit the symptom points to rather than guessing at the message", probe: "Which limit would that trip?" },
      { id: "s3", signal: "states the fix as reading once into a keyed collection and operating once on a list", probe: "What does the restructured version look like?" },
      { id: "s4", signal: "volunteers that a large load fires the same code repeatedly in chunks, which is why low volume never surfaced it", probe: "Why did the small test pass?" },
    ],
    answerKey: {
      weak: "I would open the debug logs and read the error message to see what went wrong during the load.",
      competent: "Almost certainly a query or an update sitting inside a loop. I would move it out, gather the ids first, query once into a map, and do a single operation on a list at the end.",
      excellent: "A query or DML inside the per-record loop. I would collect the ids, read the related records once into a map keyed on id, and do one operation on a list. Worth saying why the sandbox passed: a big load fires this repeatedly in chunks, so the per-chunk budget was never close at low volume.",
    },
  },
  {
    ...BASE,
    id: "bk.restructure-inherited",
    topicId: "sfdev.bulkification",
    text: "You inherit a method that queries related records inside a loop over the incoming set. Talk me through how you would restructure it.",
    kind: "code_reasoning",
    scores: ["depth", "technical_accuracy", "problem_solving", "relevance"],
    mustHear: [
      { id: "s1", signal: "describes a first pass that gathers the keys needed before any reading happens", probe: "What happens before the query?" },
      { id: "s2", signal: "names a map keyed on the relating field so the join happens in memory", probe: "How do you match parents back to children?" },
      { id: "s3", signal: "states that changes are accumulated into a collection and committed once at the end", probe: "When does the write happen?" },
      { id: "s4", signal: "volunteers a case the naive rewrite would still get wrong, such as records whose related field is empty or parents that are missing", probe: "What would that rewrite still get wrong?" },
    ],
    answerKey: {
      weak: "I would move the query above the loop so it only runs once instead of running on every iteration of the records.",
      competent: "Two passes. First collect the parent ids from the incoming records, then query those parents once into a map keyed on id. Inside the loop I only read from the map, collect the records I changed, and update once at the end.",
      excellent: "Gather the parent ids first, query once into a map keyed on id, then loop reading only from memory and accumulating changes into a list for one commit. The part people miss is the records with an empty relating field, and parents the running user cannot see, so I would decide deliberately whether those are skipped or errored rather than letting a null lookup decide it.",
    },
  },
  {
    ...BASE,
    id: "bk.wrong-values-multi-record",
    topicId: "sfdev.bulkification",
    text: "Your logic gives the right answer for a single record and the wrong answer when several are saved together. What kind of bug is that?",
    kind: "debug",
    scores: ["correctness", "depth", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "identifies state being shared across records instead of being scoped to each one", probe: "What would produce a per-record difference like that?" },
      { id: "s2", signal: "names concrete shapes of the mistake, such as a variable assigned in one iteration and read in the next, or the first record standing in for all of them", probe: "What does that look like in code?" },
      { id: "s3", signal: "describes reproducing it with a multi-record test before changing anything", probe: "How would you confirm it?" },
      { id: "s4", signal: "volunteers that the failure is silent, producing wrong data rather than an exception, so nothing alerts on it", probe: "How bad is this compared with hitting a limit?" },
    ],
    answerKey: {
      weak: "It is a bulkification problem, so I would rewrite the method to handle a list of records instead of just one record.",
      competent: "Something is shared across iterations. Usually a variable set once and reused, or code that reads the first record and applies it to all of them. I would write a test that saves several records at once to reproduce it.",
      excellent: "State leaking across records, typically a variable assigned in one iteration and read in another, or the first element treated as representative. I would reproduce it with a multi-record test first. The reason this one is worse than a limit failure is that it throws nothing, so it quietly writes wrong data until somebody reconciles a report.",
    },
  },
  {
    ...BASE,
    id: "bk.single-entry-point-exception",
    topicId: "sfdev.bulkification",
    text: "You normally route all logic for an object through one entry point. When would you deliberately not do that?",
    kind: "tradeoff",
    scores: ["relevance", "clarity", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "states the reason the single entry point exists, namely controlling ordering and total consumption", probe: "What is the rule buying you in the first place?" },
      { id: "s2", signal: "names a situation where the cost outweighs it, such as work owned by a separate installed package or a boundary the team does not control", probe: "So when is it not worth it?" },
      { id: "s3", signal: "reasons from the constraint rather than restating the rule as an absolute", probe: "How do you decide in a given case?" },
      { id: "s4", signal: "volunteers what is given up by splitting, such as ordering becoming implicit and consumption becoming harder to attribute", probe: "What do you lose if you split it?" },
    ],
    answerKey: {
      weak: "I would always use one entry point because that is the best practice for keeping automation on an object maintainable.",
      competent: "The rule exists so ordering is explicit and you can see the total cost in one place. I would break it where the logic belongs to a separate installed package, since I do not own that code.",
      excellent: "It exists to make ordering explicit and consumption attributable. I would not force it across a boundary I do not control, like a managed package's own automation, because the coupling costs more than the ordering guarantee is worth. What I would be honest about is what splitting gives up: ordering becomes implicit, and when the budget runs out nobody can tell which side spent it.",
    },
  },
  {
    ...BASE,
    id: "bk.bulk-safe-meaning",
    topicId: "sfdev.bulkification",
    text: "What does it mean for a piece of Apex to be bulk safe?",
    kind: "definition",
    scores: ["technical_accuracy", "clarity", "relevance"],
    mustHear: [
      { id: "s1", signal: "states that it behaves the same whether one record or many arrive together", probe: "Safe against what, specifically?" },
      { id: "s2", signal: "names both failure modes it protects against, exhausting the transaction budget and producing wrong per-record results", probe: "What can go wrong if it is not?" },
      { id: "s3", signal: "states that reads and writes happen once over collections rather than once per record", probe: "What does the code have to do differently?" },
    ],
    answerKey: {
      weak: "It means the code has no queries or updates inside loops so it will not hit the query limits when data is loaded.",
      competent: "The same code gives the same result for one record or many. That means reading and writing over collections instead of per record, so you neither exhaust the budget nor mix up records.",
      excellent: "It behaves identically for one record and for a full batch. Two distinct failures it guards against: running out of transaction budget, which fails loudly, and carrying state between records, which fails silently and is the more expensive of the two. In practice that means one read and one write over collections, with everything in between working from memory.",
    },
  },
];
