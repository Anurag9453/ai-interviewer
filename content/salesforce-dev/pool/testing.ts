import type { Question } from "@ai/core";

const BASE = { maxProbes: 3, hardTimeS: 240, difficultyBand: "intermediate" } as const;

export const TESTING_POOL: Question[] = [
  {
    ...BASE,
    id: "ts.test-a-callout",
    topicId: "sfdev.testing",
    text: "How do you test logic that calls an external system?",
    kind: "scenario",
    scores: ["correctness", "depth"],
    mustHear: [
      { id: "s1", signal: "states that the external call has to be substituted rather than actually made during a test", probe: "Tests cannot reach the outside world. So how does it run?" },
      { id: "s2", signal: "names how the substitute is supplied to the code under test", probe: "How does your code end up using the fake one?" },
      { id: "s3", signal: "describes asserting on the resulting state rather than on the test merely completing", probe: "What does the test actually assert?" },
      { id: "s4", signal: "volunteers testing the unsuccessful response as well as the successful one", probe: "What else would you test besides the happy path?" },
    ],
    answerKey: {
      weak: "I would mark the class as a test class and make sure the coverage percentage is above the threshold the org requires.",
      competent: "Callouts cannot run in a test, so I supply a mock response and register it before the code runs. Then I assert that the record ended up in the state the response should produce.",
      excellent: "The call gets substituted with a mock registered before the code runs, so nothing leaves the org. Then I assert on the resulting record state, not just that it completed. The case worth writing is the unsuccessful response, because that is the path that runs in production at three in the morning and the one nobody has ever exercised.",
    },
  },
  {
    ...BASE,
    id: "ts.coverage-without-assertions",
    topicId: "sfdev.testing",
    text: "A colleague hits the required coverage number with a test that asserts nothing. What is your position?",
    kind: "tradeoff",
    scores: ["relevance", "clarity", "problem_solving"],
    mustHear: [
      { id: "s1", signal: "distinguishes lines having been executed from behaviour having been verified", probe: "What does coverage actually measure?" },
      { id: "s2", signal: "states that such a test still passes when the logic becomes wrong, so it protects nothing", probe: "What happens when someone breaks that code?" },
      { id: "s3", signal: "acknowledges the threshold as a real deployment constraint rather than dismissing it", probe: "But the deployment does need the number." },
      { id: "s4", signal: "volunteers that the cost is paid later, when a change breaks behaviour and the suite stays green", probe: "Where does the cost show up?" },
    ],
    answerKey: {
      weak: "It meets the requirement so the deployment will work, but I would ask them to add some assertions when they get time.",
      competent: "Coverage only says the lines ran. A test with no assertions passes even when the behaviour is wrong, so it gives no protection. The number is required for deployment, but it is not the point of the test.",
      excellent: "Coverage measures execution, not correctness, so that test will stay green through any behavioural regression. It is worse than no test, because it buys false confidence and satisfies the gate that was supposed to force the real one. The threshold is a genuine deployment constraint, so the answer is assertions on the behaviour that matters rather than deleting the test.",
    },
  },
  {
    ...BASE,
    id: "ts.passes-locally-fails-deploy",
    topicId: "sfdev.testing",
    text: "A test passes in your development environment and fails during deployment. Where do you look?",
    kind: "debug",
    scores: ["problem_solving", "depth", "correctness"],
    mustHear: [
      { id: "s1", signal: "identifies dependence on data or configuration that exists in one environment and not the other", probe: "What differs between the two places?" },
      { id: "s2", signal: "names the kinds of hidden dependency involved, such as existing records, required fields, validation rules, or automation present in only one org", probe: "What kind of dependency does that?" },
      { id: "s3", signal: "states that the fix is the test creating everything it needs rather than the target being adjusted", probe: "How do you fix it for good?" },
      { id: "s4", signal: "volunteers that a test depending on ambient data is unreliable even where it currently passes", probe: "Is that test trustworthy where it passes?" },
    ],
    answerKey: {
      weak: "I would check the deployment error message and add the missing records to the target org so the test can find what it needs.",
      competent: "It is relying on something that exists in my environment and not the target. Usually existing records, or a required field or validation rule that differs. The test should create its own data instead of assuming any.",
      excellent: "Something ambient in my environment is absent in the target, whether that is records, a required field, a validation rule, or automation only one org has. The fix is the test building everything it depends on, not seeding the target. And I would not trust that test where it passes either, because it is passing for a reason unrelated to the behaviour it claims to check.",
    },
  },
  {
    ...BASE,
    id: "ts.shared-setup-across-methods",
    topicId: "sfdev.testing",
    text: "Several test methods in one class all need the same set of records. How do you set that up?",
    kind: "code_reasoning",
    scores: ["technical_accuracy", "clarity", "depth"],
    mustHear: [
      { id: "s1", signal: "names the mechanism for creating records once for every method in the class", probe: "Is there something built in for that?" },
      { id: "s2", signal: "states that each method receives the same starting state and that changes made in one do not persist into another", probe: "What does each method see?" },
      { id: "s3", signal: "identifies the benefit beyond tidiness, namely the setup cost being paid once rather than per method", probe: "Why bother, versus a helper method?" },
      { id: "s4", signal: "volunteers a case where this is the wrong tool, such as a method needing a different starting state", probe: "When would you not use it?" },
    ],
    answerKey: {
      weak: "I would write a helper method that creates the records and call it at the beginning of each of the test methods.",
      competent: "There is a setup mechanism that runs once for the class. Each method gets the same records and its changes are rolled back afterwards, so the methods stay independent of each other.",
      excellent: "Use the class-level setup so the records are created once and every method starts from the same state with its own changes rolled back. The gain over a helper is that the creation cost is paid once rather than per method, which matters as the class grows. I would not use it where a method needs a genuinely different starting state, since bending the shared setup to serve every case is how it turns into a tangle.",
    },
  },
  {
    ...BASE,
    id: "ts.isolation-meaning",
    topicId: "sfdev.testing",
    text: "What does it mean for a test to be isolated from the data already in the org?",
    kind: "definition",
    scores: ["technical_accuracy", "clarity", "relevance"],
    mustHear: [
      { id: "s1", signal: "states that the test sees only records it created rather than records already present", probe: "Isolated from what, exactly?" },
      { id: "s2", signal: "states that this is the default behaviour and that it can be deliberately overridden", probe: "Is that automatic?" },
      { id: "s3", signal: "identifies why it matters, namely that a test depending on ambient data breaks when that data changes", probe: "Why is that worth having?" },
    ],
    answerKey: {
      weak: "It means the test creates its own records instead of using the ones already in the org so it does not interfere with them.",
      competent: "By default a test cannot see the org's existing records, only what it creates. There is a way to override that, but then the test depends on data somebody else can change.",
      excellent: "The test's view is limited to what it created, which is the default rather than something you opt into, and it can be deliberately overridden. It matters because a test reading ambient data is really asserting on somebody else's records, so it starts failing on a change that has nothing to do with the code, and by then nobody remembers why the test existed.",
    },
  },
];
