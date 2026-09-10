import type { TopicSpec } from "@ai/core";

/**
 * Salesforce Developer — Intermediate taxonomy.
 *
 * `expectation` is deliberately phrased to avoid release-dependent facts (see
 * docs/verified-facts.md). Where the platform default varies by API version,
 * the expectation is that the candidate KNOWS IT VARIES — not that they recite
 * one particular default.
 */
export const SALESFORCE_DEV_TOPICS: TopicSpec[] = [
  {
    id: "sfdev.governor_limits",
    label: "Governor Limits",
    description:
      "Per-transaction resource ceilings the Apex runtime enforces, and how to read a limit failure back to its cause.",
    aliases: ["limits", "SOQL limit", "DML limit", "CPU timeout", "heap size", "LimitException", "too many SOQL queries"],
    importance: 0.95,
    depthReady: true,
    prereqs: [],
    rubricRef: "sfdev.governor_limits.v1",
    expectation:
      "Knows limits apply per transaction rather than per org or per record; can reason from a symptom to which limit was hit; knows asynchronous contexts get higher ceilings than synchronous ones without needing the exact values; knows CPU time is the limit you hit through logic rather than data volume.",
  },
  {
    id: "sfdev.bulkification",
    label: "Bulkification & Trigger Patterns",
    description:
      "Writing Apex that processes collections rather than single records, and keeping logic out of the trigger body.",
    aliases: ["bulkify", "SOQL in loop", "DML in loop", "trigger handler", "one trigger per object", "collections", "map lookup"],
    importance: 0.95,
    depthReady: true,
    prereqs: ["sfdev.governor_limits"],
    rubricRef: "sfdev.bulkification.v1",
    expectation:
      "Never places queries or DML inside a loop; joins related data in memory with a Map keyed on Id; knows a large load fires the trigger repeatedly in chunks so limits apply per chunk, which is why low-volume testing misses the problem; delegates logic to a handler class rather than writing it in the trigger body, without requiring any particular framework.",
  },
  {
    id: "sfdev.order_of_execution",
    label: "Trigger Context & Order of Execution",
    description:
      "Which trigger context to use for which job, and where trigger logic sits relative to the rest of the save.",
    aliases: ["save order", "before insert", "after update", "Trigger.new", "Trigger.oldMap", "recursion", "static guard"],
    importance: 0.75,
    depthReady: true,
    prereqs: [],
    rubricRef: "sfdev.order_of_execution.v1",
    expectation:
      "Sets fields on the record in a before context and works with related records in an after context, and can say why; knows Trigger.new is not writable in after contexts; can place validation rules, flows, and their own trigger relative to one another in the save; controls re-entry with a static guard.",
  },
  {
    id: "sfdev.soql_relationships",
    label: "SOQL & Relationship Queries",
    description:
      "Traversing relationships in both directions, and writing queries that stay performant as data grows.",
    aliases: ["parent-to-child", "child-to-parent", "subquery", "dot notation", "selective query", "custom index", "SOQL for loop", "non-selective query"],
    importance: 0.85,
    depthReady: true,
    prereqs: [],
    rubricRef: "sfdev.soql_relationships.v1",
    expectation:
      "Writes both traversal directions comfortably; knows what makes a filter selective and why that matters on a large object; uses a SOQL for-loop to bound heap when processing many records; recognises that nesting of child subqueries is bounded.",
  },
  {
    id: "sfdev.async_apex",
    label: "Asynchronous Apex",
    description:
      "The available asynchronous mechanisms, what distinguishes them, and how to choose between them.",
    aliases: ["future", "@future", "Queueable", "Batch Apex", "Database.Batchable", "Schedulable", "chaining", "async limits"],
    importance: 0.85,
    depthReady: true,
    prereqs: ["sfdev.governor_limits"],
    rubricRef: "sfdev.async_apex.v1",
    expectation:
      "Names several mechanisms and at least one concrete difference between them — argument types, chaining, ability to process volume beyond one transaction; knows chaining is possible and bounded without needing the bound; treats older constructs as legitimate choices rather than mistakes.",
  },
  {
    id: "sfdev.security_sharing",
    label: "Sharing & Security in Apex",
    description:
      "How record-, field-, and object-level access are enforced in Apex, and the mechanisms available to enforce them.",
    aliases: ["with sharing", "without sharing", "inherited sharing", "system mode", "user mode", "FLS", "CRUD", "stripInaccessible", "USER_MODE", "SECURITY_ENFORCED"],
    importance: 0.80,
    depthReady: true,
    prereqs: [],
    rubricRef: "sfdev.security_sharing.v1",
    expectation:
      "Knows that whether sharing rules and field-level security are enforced is a property of the execution mode of the class or operation rather than something to assume — a candidate who says it depends on API version or on how the class is declared is fully correct; separates object-, field-, and record-level access; knows the sharing keyword alone does not enforce field-level security; can name at least one concrete enforcement mechanism, any legitimate one counting equally.",
  },
  {
    id: "sfdev.testing",
    label: "Apex Testing",
    description:
      "Writing tests that prove behaviour rather than tests that produce coverage.",
    aliases: ["isTest", "testSetup", "Test.startTest", "Test.stopTest", "HttpCalloutMock", "Test.setMock", "SeeAllData", "code coverage", "assertion"],
    importance: 0.85,
    depthReady: true,
    prereqs: [],
    rubricRef: "sfdev.testing.v1",
    expectation:
      "Creates test data in the test rather than depending on org data; mocks callouts; knows how to make asynchronous work complete before asserting; asserts on resulting state rather than treating coverage as the goal; tests bulk and failure paths, not only the happy path.",
  },
  {
    id: "sfdev.error_handling",
    label: "Error Handling & Partial Success",
    description:
      "Controlling what happens when part of an operation fails, and surfacing failures usefully.",
    aliases: ["try catch", "custom exception", "addError", "allOrNone", "Database.insert", "savepoint", "rollback", "partial success"],
    importance: 0.70,
    depthReady: true,
    prereqs: [],
    rubricRef: "sfdev.error_handling.v1",
    expectation:
      "Knows the difference between an all-or-nothing DML statement and one that permits partial success and returns per-row results; uses record-level errors for validation in trigger context; knows an unhandled exception rolls the transaction back, and where a savepoint changes that.",
  },
  {
    id: "sfdev.lwc_fundamentals",
    label: "LWC Fundamentals",
    description:
      "Component boundaries, lifecycle, reactivity, and how components communicate.",
    aliases: ["Lightning Web Component", "@api", "lifecycle hook", "connectedCallback", "renderedCallback", "CustomEvent", "bubbles", "composed", "slot"],
    importance: 0.80,
    depthReady: true,
    prereqs: [],
    rubricRef: "sfdev.lwc_fundamentals.v1",
    expectation:
      "Exposes public properties deliberately; knows reassignment rather than mutation drives re-render; can distinguish the lifecycle hook that runs once from the one that runs on every render, and why work in the latter needs a guard; passes data down through properties and communicates upward through events.",
  },
  {
    id: "sfdev.lwc_apex_data",
    label: "LWC ↔ Apex Data Access",
    description:
      "Choosing between reactive wired data, imperative calls, and the platform's own record layer.",
    aliases: ["wire", "@wire", "imperative Apex", "cacheable", "refreshApex", "Lightning Data Service", "getRecord", "updateRecord", "record-edit-form"],
    importance: 0.75,
    depthReady: true,
    prereqs: ["sfdev.lwc_fundamentals"],
    rubricRef: "sfdev.lwc_apex_data.v1",
    expectation:
      "Knows reactive wired data requires the Apex method be marked cacheable and is therefore unsuitable for writes; knows cached data goes stale and how to force a refresh; reaches for the platform record layer before hand-written Apex for simple single-record work.",
  },
  {
    id: "sfdev.integration_callouts",
    label: "Integration & Callouts",
    description:
      "Calling external systems from the platform, and handling the ways that goes wrong.",
    aliases: ["HTTP callout", "HttpRequest", "REST callout", "Named Credential", "remote site setting", "callout from trigger", "timeout"],
    importance: 0.70,
    depthReady: true,
    prereqs: ["sfdev.async_apex"],
    rubricRef: "sfdev.integration_callouts.v1",
    expectation:
      "Knows a callout cannot be made synchronously from trigger context and why that forces an asynchronous design; keeps endpoints and credentials in platform configuration rather than in code; knows callouts and DML in one transaction have ordering constraints; handles non-success responses and timeouts explicitly rather than assuming success.",
  },
  {
    id: "sfdev.data_modeling",
    label: "Platform Data Modeling",
    description:
      "Relationship types and the behaviour each one implies for sharing, deletion, and rollups.",
    aliases: ["lookup", "master-detail", "junction object", "roll-up summary", "formula field", "external ID", "upsert", "cascade delete", "record type"],
    importance: 0.65,
    depthReady: true,
    prereqs: [],
    rubricRef: "sfdev.data_modeling.v1",
    expectation:
      "Knows a master-detail relationship implies ownership, cascade delete, and inherited sharing while a lookup does not, and can pick between them from requirements; knows which relationship type rollups require; uses an external identifier to make integration writes idempotent.",
  },
  {
    id: "sfdev.flow_vs_apex",
    label: "Declarative vs Apex",
    description:
      "Deciding when platform automation is the right tool and when code is.",
    aliases: ["declarative", "clicks not code", "Record-Triggered Flow", "invocable Apex", "InvocableMethod"],
    importance: 0.60,
    depthReady: false,
    prereqs: [],
    rubricRef: "sfdev.flow_vs_apex.v1",
    expectation:
      "Reasons from constraints rather than reciting a slogan — bulk behaviour, testability, debuggability, error handling, and who maintains it after handover. Any defensible position is acceptable; what is assessed is the reasoning, never the side chosen.",
  },
  {
    id: "sfdev.deployment",
    label: "Deployment & Metadata",
    description:
      "Moving work between environments and what gates a production release.",
    aliases: ["sfdx", "sf cli", "change set", "metadata API", "scratch org", "unlocked package", "destructive changes", "CI"],
    importance: 0.55,
    depthReady: false,
    prereqs: [],
    rubricRef: "sfdev.deployment.v1",
    expectation:
      "Works from source rather than clicking metadata between orgs; knows what a disposable development org is for; knows deletions are handled separately from additions; knows test execution gates a production deploy.",
  },
  {
    id: "sfdev.platform_events",
    label: "Platform Events & Change Data Capture",
    description:
      "Event-driven decoupling on the platform and when it beats a direct asynchronous call.",
    aliases: ["pub sub", "publish subscribe", "event bus", "Change Data Capture", "CDC", "EventBus.publish", "event trigger"],
    importance: 0.50,
    depthReady: false,
    prereqs: ["sfdev.async_apex"],
    rubricRef: "sfdev.platform_events.v1",
    expectation:
      "Treats this as fire-and-forget decoupling rather than request/response; can say when it is preferable to enqueueing work directly; knows delivery does not carry the same transactional guarantees as DML.",
  },
];
