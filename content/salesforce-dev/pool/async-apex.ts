import type { Question } from "@ai/core";

const BASE = { maxProbes: 3, hardTimeS: 240, difficultyBand: "intermediate" } as const;

export const ASYNC_APEX_POOL: Question[] = [
  {
    ...BASE,
    id: "as.callout-on-close",
    topicId: "sfdev.async_apex",
    text: "You need to call an external system when an opportunity is closed. Walk me through your options.",
    kind: "tradeoff",
    scores: ["correctness", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "states that the call cannot be made in the same synchronous execution as the save", probe: "Can you make that call directly in the save?" },
      { id: "s2", signal: "names more than one asynchronous mechanism together with a concrete difference between them, such as what can be passed in or whether further work can be queued", probe: "What is the actual difference between those?" },
      { id: "s3", signal: "chooses one and ties the choice to the constraint in the question", probe: "Which would you pick here, and why that one?" },
      { id: "s4", signal: "volunteers a failure mode of the chosen design, such as the external system being unavailable, repeated delivery, or the record being left inconsistent", probe: "The external system is down. What happens to that record?" },
    ],
    answerKey: {
      weak: "I would make the callout from the trigger so the external system is updated as soon as the opportunity closes.",
      competent: "You cannot call out synchronously from a save, so it has to be asynchronous. I would use a queued job rather than the older annotation, because it takes real objects as input and can queue follow-up work.",
      excellent: "The save cannot call out synchronously, so it is asynchronous either way. I would queue a job rather than use the older annotation, mainly because it accepts typed input and can chain. The part worth designing up front is what happens when the far side is down: without an idempotency key and somewhere to record the failure, you either lose the event or send it twice, and the record ends up claiming something that never happened.",
    },
  },
  {
    ...BASE,
    id: "as.volume-beyond-transaction",
    topicId: "sfdev.async_apex",
    text: "A nightly process has to touch far more records than a single transaction can handle. How do you approach it?",
    kind: "scenario",
    scores: ["correctness", "depth", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "states that the work must be divided so each division runs in its own transaction with its own budget", probe: "Why can this not run as one piece of work?" },
      { id: "s2", signal: "names the mechanism intended for processing volume in divided transactions", probe: "Which mechanism is built for that?" },
      { id: "s3", signal: "describes how the set of records to process is selected and how progress is tracked", probe: "How does it know what to work on?" },
      { id: "s4", signal: "volunteers that partial completion is now a real state, so failures must be recorded and the run made safe to repeat", probe: "One division fails halfway. Then what?" },
    ],
    answerKey: {
      weak: "I would schedule the job to run at night when nobody is using the system so it has more resources available to finish.",
      competent: "It needs to be divided into separate transactions, so the mechanism built for processing volume. It selects the records with a query, then processes them in divisions, each getting its own budget.",
      excellent: "Divide it so each division is its own transaction with its own budget, using the mechanism built for that. I would drive selection from a query and keep a marker on the record so a re-run does not redo finished work. The thing to design for is that partial success is now normal: a division can fail while others succeed, so failures need recording somewhere a human will see, and the whole run needs to be safe to start again.",
    },
  },
  {
    ...BASE,
    id: "as.silent-async-failure",
    topicId: "sfdev.async_apex",
    text: "An asynchronous job quietly did nothing for some records and nobody noticed for a week. How would you have caught that sooner?",
    kind: "debug",
    scores: ["relevance", "depth", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "states that an asynchronous failure has no user watching it, so nothing surfaces unless the code surfaces it", probe: "Why did nobody notice?" },
      { id: "s2", signal: "names where the outcome of asynchronous work can be inspected after the fact", probe: "Where would you go looking?" },
      { id: "s3", signal: "describes recording per-record outcome rather than relying on the absence of an exception", probe: "What would you add to the code?" },
      { id: "s4", signal: "volunteers that the useful alert is on expected work not completing, rather than on errors being thrown", probe: "What would you alert on?" },
    ],
    answerKey: {
      weak: "I would add a try catch around the logic and write the exception to the debug logs so it can be found later.",
      competent: "Nothing was watching it. I would check the job records to see the outcome and add error handling that writes failures somewhere persistent instead of just letting them disappear.",
      excellent: "Asynchronous work has no user staring at a spinner, so silence reads as success. I would look at the job history first, then add a per-record outcome so the code records what it did rather than only what threw. The alert that would actually have caught this is on expected work not finishing, since the failure here was records being skipped, and skipping throws nothing.",
    },
  },
  {
    ...BASE,
    id: "as.older-mechanism-choice",
    topicId: "sfdev.async_apex",
    text: "Your team already uses the older fire and forget annotation everywhere. Would you keep using it on a new piece of work?",
    kind: "tradeoff",
    scores: ["relevance", "clarity", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "names a concrete difference between the older annotation and the newer mechanism rather than labelling one as outdated", probe: "What actually differs between them?" },
      { id: "s2", signal: "identifies the property of the new work that decides which one fits", probe: "What about this work decides it?" },
      { id: "s3", signal: "treats consistency with the existing codebase as a real factor rather than dismissing it", probe: "Does what the team already uses matter?" },
      { id: "s4", signal: "volunteers the cost of either choice, whether that is inconsistency in the codebase or being unable to pass what is needed", probe: "What does your choice cost?" },
    ],
    answerKey: {
      weak: "No, that annotation is outdated and the newer mechanism is the recommended approach now, so I would use that instead.",
      competent: "It depends what the work needs. The older annotation only takes simple values and cannot queue follow-up work. If this job needs either of those, I would use the newer mechanism, otherwise the annotation is fine.",
      excellent: "The difference that matters is what you can pass in and whether you can queue follow-on work, not which is newer. If this job needs typed input or chaining, that decides it. If not, I would weigh matching the existing codebase, because a single file doing it differently is a maintenance cost somebody pays later. I would rather introduce the newer one deliberately across a boundary than sprinkle it.",
    },
  },
  {
    ...BASE,
    id: "as.two-jobs-same-records",
    topicId: "sfdev.async_apex",
    text: "Two asynchronous jobs both update the same records and you are seeing inconsistent results. What do you look at?",
    kind: "debug",
    scores: ["correctness", "depth", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "states that the two have no guaranteed ordering relative to each other", probe: "What order do those two run in?" },
      { id: "s2", signal: "identifies that each reads a snapshot and can overwrite what the other wrote", probe: "How does one lose the other's change?" },
      { id: "s3", signal: "names a way to remove the race, such as sequencing the work or narrowing each job to the fields it owns", probe: "How would you make it deterministic?" },
      { id: "s4", signal: "volunteers that reproducing this is timing dependent, so it will not fail consistently in testing", probe: "How would you prove you fixed it?" },
    ],
    answerKey: {
      weak: "I would add a delay to one of the jobs so they do not run at the same time and overwrite each other's changes.",
      competent: "There is no ordering guarantee between them, so both read the record and the second write wins. I would chain them so one runs after the other, or split them so each only touches its own fields.",
      excellent: "No ordering guarantee, and each reads its own snapshot, so whichever commits last silently discards the other. I would either sequence them explicitly or narrow each to the fields it owns, which I prefer because it removes the race instead of hiding it behind timing. And I would say up front that this will not reproduce reliably, so a passing test proves very little here.",
    },
  },
];
