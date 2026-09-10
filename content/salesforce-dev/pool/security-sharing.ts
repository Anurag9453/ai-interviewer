import type { Question } from "@ai/core";

const BASE = { maxProbes: 3, hardTimeS: 240, difficultyBand: "intermediate" } as const;

/**
 * Signals here are deliberately version-agnostic. Verification found that the
 * platform default for execution mode changed by API version, so a candidate
 * who answers "it depends on the version or on how the class is declared"
 * FULLY satisfies s1 rather than being marked wrong. Likewise any legitimate
 * field-enforcement mechanism satisfies the enforcement signal.
 */
export const SECURITY_SHARING_POOL: Question[] = [
  {
    ...BASE,
    id: "sc.component-returns-contacts",
    topicId: "sfdev.security_sharing",
    text: "Your component calls an Apex method that returns a list of contacts. What do you need to think about for security?",
    kind: "scenario",
    scores: ["correctness", "depth"],
    mustHear: [
      { id: "s1", signal: "treats whether sharing and field access are enforced as a property of how the class or operation is declared rather than as something to assume, including saying it depends on the version or the declaration", probe: "What does that class enforce, and how do you know?" },
      { id: "s2", signal: "separates who can see the record from who can see the fields on it", probe: "Are those the same question?" },
      { id: "s3", signal: "states that declaring sharing on the class does not by itself restrict which fields come back", probe: "Does the sharing declaration cover the fields too?" },
      { id: "s4", signal: "names a concrete mechanism that enforces field access, any legitimate one counting equally", probe: "So how do you actually enforce field access?" },
    ],
    answerKey: {
      weak: "I would add the sharing keyword to the class declaration so the running user's permissions are respected on the query.",
      competent: "Record access and field access are separate. The sharing declaration governs which records come back but not which fields, so I also need to enforce field access explicitly rather than assuming the query does it.",
      excellent: "First I would not assume what the class enforces, since that depends on how it is declared and has changed across versions. Then I would treat record access and field access as two questions, because the sharing declaration governs rows and says nothing about columns. For the fields I would enforce explicitly, and I would pick the mechanism based on whether I want the request to fail loudly or to silently drop what the user cannot see.",
    },
  },
  {
    ...BASE,
    id: "sc.user-sees-wrong-record",
    topicId: "sfdev.security_sharing",
    text: "A user reports seeing a record they should not have access to. Where do you start?",
    kind: "debug",
    scores: ["problem_solving", "depth", "correctness"],
    mustHear: [
      { id: "s1", signal: "establishes whether the record was reached through code or through the standard interface before investigating", probe: "What is the first thing you would establish?" },
      { id: "s2", signal: "identifies custom code running without enforcing the running user's access as a likely path", probe: "How could code cause this?" },
      { id: "s3", signal: "names where the intended record access for that user can be inspected", probe: "How do you find out what they should be able to see?" },
      { id: "s4", signal: "volunteers that the same gap probably exposes other records and users, so the fix is not limited to the reported case", probe: "Is this one record, or something larger?" },
    ],
    answerKey: {
      weak: "I would check the user's profile and permission sets to see whether they have been given access to that object by mistake.",
      competent: "First, whether they got there through the interface or through our code. If it is our code, likely a class returning records without enforcing the running user's access. I would compare against what their configured access should allow.",
      excellent: "I would establish the path first, because configuration and code are different investigations. If it is our code, the usual cause is a query running without the running user's access enforced. I would check their intended access to confirm what should have been visible. Then I would treat the report as a sample rather than the bug: if one query skips enforcement, that user is very unlikely to be the only one who noticed something, and the others just have not reported it.",
    },
  },
  {
    ...BASE,
    id: "sc.deliberately-not-enforcing",
    topicId: "sfdev.security_sharing",
    text: "When would you deliberately run something without enforcing the running user's record access?",
    kind: "tradeoff",
    scores: ["relevance", "clarity", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "names a legitimate case where the operation must act beyond what the user can see, such as maintaining a rollup or reading a reference table", probe: "Give me a case where it is the right call." },
      { id: "s2", signal: "states that the elevated scope should be confined to the narrow operation that needs it rather than applied to the whole path", probe: "How far does that elevation extend?" },
      { id: "s3", signal: "identifies that what is returned to the user must still be limited even when the internal read was not", probe: "What comes back to the user?" },
      { id: "s4", signal: "volunteers that this is the kind of decision that needs to be visible in review, since it is invisible at runtime", probe: "How does the next person know this was deliberate?" },
    ],
    answerKey: {
      weak: "I would avoid it entirely, since running without enforcing access is a security risk and there is usually another way to do it.",
      competent: "When the operation legitimately needs to see more than the user, like updating a total that depends on records they cannot read. I would keep that to the smallest possible piece and not return anything to the user they should not see.",
      excellent: "When the operation genuinely must act beyond the user's visibility, such as maintaining a total over records they cannot read. I would confine the elevation to that one call rather than the whole entry point, and still filter what goes back to the user, since the internal read being broad does not license a broad response. I would also make it obvious in the code why it is deliberate, because at runtime this looks identical to the mistake.",
    },
  },
  {
    ...BASE,
    id: "sc.return-only-visible-fields",
    topicId: "sfdev.security_sharing",
    text: "You need to return records but only the fields the running user is allowed to see. Talk me through how.",
    kind: "code_reasoning",
    scores: ["technical_accuracy", "depth", "problem_solving", "relevance"],
    mustHear: [
      { id: "s1", signal: "names at least one concrete mechanism for enforcing field access, any legitimate one counting equally", probe: "What mechanism would you reach for?" },
      { id: "s2", signal: "distinguishes an approach that raises an error on inaccessible fields from one that removes them from the result", probe: "Does it fail, or does it strip?" },
      { id: "s3", signal: "ties the choice to how the caller should behave when a field is not permitted", probe: "Which behaviour do you want here, and why?" },
      { id: "s4", signal: "volunteers that the component receiving the data must tolerate a field being absent rather than assuming it is there", probe: "What does the front end need to handle?" },
    ],
    answerKey: {
      weak: "I would check the field permissions for each field using the schema describe calls before adding them to the response object.",
      competent: "I would use one of the built-in enforcement approaches rather than hand-rolling describe checks. One raises an error if the user cannot see a field, the other strips those fields from the result, so I would pick based on which behaviour I want.",
      excellent: "One of the built-in mechanisms rather than hand-rolled describe checks, and the real decision is failure mode: erroring on an inaccessible field versus quietly removing it. For a read feeding a screen I would strip, so a user with narrower access gets a smaller screen instead of an error. That pushes a requirement onto the front end, which now has to render with a field absent rather than assuming every field arrived.",
    },
  },
  {
    ...BASE,
    id: "sc.record-vs-field-access",
    topicId: "sfdev.security_sharing",
    text: "What is the difference between record access and field access?",
    kind: "definition",
    scores: ["technical_accuracy", "clarity", "relevance"],
    mustHear: [
      { id: "s1", signal: "states that one governs which rows a user can reach and the other which columns on a reachable row", probe: "What does each one control?" },
      { id: "s2", signal: "states that they are configured and enforced through separate mechanisms", probe: "Are they enforced by the same thing?" },
      { id: "s3", signal: "identifies that a user can reach a record while being unable to see some of its fields", probe: "Can you have one without the other?" },
    ],
    answerKey: {
      weak: "Record access is whether you can open the record and field access is whether you can edit the fields on it once open.",
      competent: "Record access decides which rows you can reach, field access decides which columns on those rows. They are configured separately and enforced separately, so having one does not imply the other.",
      excellent: "Rows versus columns. Record access decides which rows a user can reach at all; field access decides which columns they see on a row they can already reach. They are configured and enforced through different mechanisms, which is exactly why code that handles one often silently ignores the other, and the usual production bug is a query that respected the rows and returned every column.",
    },
  },
];
