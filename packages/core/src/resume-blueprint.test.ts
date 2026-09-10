import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeProfileToBlueprint } from "./resume-blueprint.js";
import { DocumentBlueprintSchema } from "./schema/document-analysis.js";
import { ResumeProfileSchema, type ResumeProfile } from "./schema/resume-analysis.js";

function profile(over: Partial<ResumeProfile> = {}): ResumeProfile {
  return {
    headline: "Salesforce developer",
    domain: "Salesforce development",
    totalExperienceLabel: "about 4 years",
    seniority: "mid",
    roles: [
      {
        title: "Salesforce Developer",
        organization: "Acme Corp",
        durationLabel: "2022–2024",
        isCurrent: true,
        responsibilities: ["Built Apex triggers for order processing"],
        achievements: ["Cut nightly sync time from 6h to 40m"],
        technologies: ["Apex", "SOQL"],
      },
    ],
    projects: [
      {
        name: "Bulk data integration",
        summary: "Integration handling large data volumes between NetSuite and Salesforce.",
        technologies: ["Bulk API"],
        claims: ["Handled 2M records per night"],
      },
    ],
    skills: ["Data modelling"],
    technologies: ["Apex", "LWC", "SOQL"],
    education: [{ qualification: "BSc Computer Science", institution: "State University", detail: null }],
    certifications: ["Salesforce Platform Developer I"],
    notableClaims: ["Reduced integration failures by 90%"],
    followUpAreas: [{ area: "Bulk API limits", rationale: "Claims 2M records but gives no architecture detail." }],
    thinAreas: ["No detail on error handling"],
    suggestedDifficulty: "intermediate",
    difficultyRationale: "Mid-level breadth with some depth on integrations.",
    ...over,
  };
}

function unwrap(result: ReturnType<typeof resumeProfileToBlueprint>) {
  assert.equal(result.ok, true, `expected a blueprint, got: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.blueprint;
}

test("the fixture profile itself satisfies ResumeProfileSchema", () => {
  assert.doesNotThrow(() => ResumeProfileSchema.parse(profile()));
});

test("a resume maps to a blueprint that passes the EXISTING DocumentBlueprintSchema", () => {
  // The whole reuse strategy depends on this: if the mapped blueprint isn't a
  // valid DocumentBlueprint, the generic question generator can't consume it.
  const blueprint = unwrap(resumeProfileToBlueprint(profile(), { emphasis: "mixed" }));
  assert.doesNotThrow(() => DocumentBlueprintSchema.parse(blueprint));
});

test("roles, projects and a skills topic each become topics", () => {
  const b = unwrap(resumeProfileToBlueprint(profile(), { emphasis: "mixed" }));
  const ids = b.topics.map((t) => t.id);
  assert.ok(ids.includes("role-1"), `expected a role topic, got ${ids.join(",")}`);
  assert.ok(ids.includes("project-1"));
  assert.ok(ids.includes("skills"));
});

test("candidateFacts carries the candidate's own claims, achievements and project claims", () => {
  // This is the grounding contract — these strings are what let a question
  // reference what the candidate actually wrote.
  const b = unwrap(resumeProfileToBlueprint(profile(), { emphasis: "mixed" }));
  assert.ok(b.candidateFacts.includes("Reduced integration failures by 90%"));
  assert.ok(b.candidateFacts.includes("Cut nightly sync time from 6h to 40m"));
  assert.ok(b.candidateFacts.includes("Handled 2M records per night"));
});

test("emphasis changes the relative importance of roles vs projects vs skills", () => {
  const byId = (emphasis: "experience" | "projects" | "technical_depth") => {
    const b = unwrap(resumeProfileToBlueprint(profile(), { emphasis }));
    return new Map(b.topics.map((t) => [t.id, t.importance]));
  };
  const experience = byId("experience");
  const projects = byId("projects");
  const technical = byId("technical_depth");

  assert.ok(experience.get("role-1")! > experience.get("project-1")!, "experience should favour roles");
  assert.ok(projects.get("project-1")! > projects.get("role-1")!, "projects should favour projects");
  assert.ok(technical.get("skills")! > technical.get("role-1")!, "technical_depth should favour the toolkit");
});

test("a current role outranks an identical past role at the same emphasis", () => {
  const p = profile({
    roles: [
      { ...profile().roles[0]!, organization: "Past Co", isCurrent: false },
      { ...profile().roles[0]!, organization: "Now Co", isCurrent: true },
    ],
  });
  const b = unwrap(resumeProfileToBlueprint(p, { emphasis: "experience" }));
  const past = b.topics.find((t) => t.label.includes("Past Co"))!;
  const current = b.topics.find((t) => t.label.includes("Now Co"))!;
  assert.ok(current.importance > past.importance);
});

test("thin areas become 'ask them to substantiate' angles, never invented topics", () => {
  const b = unwrap(resumeProfileToBlueprint(profile(), { emphasis: "mixed" }));
  assert.ok(b.suggestedAngles.some((a) => a.includes("substantiate") && a.includes("error handling")));
  assert.ok(
    !b.topics.some((t) => t.label.toLowerCase().includes("error handling")),
    "a thin area must not become a topic with fabricated substance",
  );
});

test("an empty resume is reported as too thin rather than producing a padded blueprint", () => {
  const empty = profile({
    roles: [], projects: [], skills: [], technologies: [],
    notableClaims: [], followUpAreas: [], thinAreas: [], certifications: [], education: [],
  });
  const result = resumeProfileToBlueprint(empty, { emphasis: "mixed" });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.reason, "too_thin");
  assert.match(result.detail, /doesn't contain enough detail/);
});

test("a resume with no roles or projects but a real skill list still produces a blueprint", () => {
  const skillsOnly = profile({
    roles: [], projects: [], notableClaims: [],
    technologies: ["Apex", "LWC", "SOQL", "Bulk API"],
  });
  const b = unwrap(resumeProfileToBlueprint(skillsOnly, { emphasis: "technical_depth" }));
  assert.equal(b.topics.length, 1);
  assert.equal(b.topics[0]!.id, "skills");
  assert.doesNotThrow(() => DocumentBlueprintSchema.parse(b));
});

test("a skills list of only two entries with no roles is too thin to interview on", () => {
  const barely = profile({ roles: [], projects: [], technologies: ["Excel"], skills: ["Communication"] });
  const result = resumeProfileToBlueprint(barely, { emphasis: "mixed" });
  assert.equal(result.ok, false);
});

test("an oversized resume is clamped to every DocumentBlueprintSchema limit", () => {
  const many = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));
  const huge = profile({
    headline: "x".repeat(400),
    difficultyRationale: "y".repeat(500),
    roles: many(12, (i) => ({
      title: `Role ${i} ${"t".repeat(200)}`,
      organization: "Org".repeat(80),
      durationLabel: "2020–2024",
      isCurrent: false,
      responsibilities: many(8, (j) => `resp ${i}-${j} ${"r".repeat(400)}`),
      achievements: many(8, (j) => `ach ${i}-${j}`),
      technologies: many(15, (j) => `tech${i}-${j}`),
    })),
    projects: many(12, (i) => ({
      name: `Project ${i}`,
      summary: "s".repeat(600),
      technologies: many(15, (j) => `ptech${i}-${j}`),
      claims: many(6, (j) => `claim ${i}-${j}`),
    })),
    technologies: many(30, (i) => `t${i}`),
    skills: many(30, (i) => `s${i}`),
    notableClaims: many(20, (i) => `claim${i}`),
    followUpAreas: many(12, (i) => ({ area: `area${i}`, rationale: "r".repeat(400) })),
    thinAreas: many(10, (i) => `thin${i}`),
    certifications: many(12, (i) => `cert${i}`),
  });

  const b = unwrap(resumeProfileToBlueprint(huge, { emphasis: "mixed" }));
  // The schema parse is the real assertion — it enforces every bound at once.
  assert.doesNotThrow(() => DocumentBlueprintSchema.parse(b));
  assert.ok(b.topics.length <= 12);
  assert.ok(b.candidateFacts.length <= 30);
  assert.ok(b.suggestedAngles.length <= 10);
  assert.ok(b.concepts.length <= 20);
  assert.ok(b.importantSections.length <= 20);
  assert.ok(b.topics.every((t) => t.subtopics.length <= 8));
  assert.ok(b.topics.every((t) => t.description.length <= 700 && t.description.length >= 1));
  assert.ok(b.topics.every((t) => t.label.length <= 80));
});

test("mapping is deterministic — the same profile and emphasis produce an identical blueprint", () => {
  const p = profile();
  assert.deepEqual(
    resumeProfileToBlueprint(p, { emphasis: "problem_solving" }),
    resumeProfileToBlueprint(p, { emphasis: "problem_solving" }),
  );
});

test("duplicate technologies across roles and the top-level list are de-duplicated", () => {
  const b = unwrap(resumeProfileToBlueprint(profile(), { emphasis: "mixed" }));
  const lower = b.concepts.map((c) => c.toLowerCase());
  assert.equal(new Set(lower).size, lower.length, `concepts contained duplicates: ${b.concepts.join(", ")}`);
});

test("a role with no responsibilities or achievements still yields a non-empty description", () => {
  // DocumentBlueprintSchema requires description.min(1); a sparse role must
  // not produce an empty string and fail the parse.
  const sparse = profile({
    roles: [{
      title: "Consultant", organization: null, durationLabel: null, isCurrent: false,
      responsibilities: [], achievements: [], technologies: [],
    }],
    projects: [],
  });
  const b = unwrap(resumeProfileToBlueprint(sparse, { emphasis: "experience" }));
  const role = b.topics.find((t) => t.id === "role-1")!;
  assert.ok(role.description.length > 0);
  assert.doesNotThrow(() => DocumentBlueprintSchema.parse(b));
});

test("no personal identifying field can reach the blueprint, because the profile has nowhere to carry it", () => {
  // Privacy is enforced structurally: extra keys are stripped by the parse,
  // so even a model that returns an email has nowhere to put it.
  const withPii = { ...profile(), email: "someone@example.com", phone: "+91 90000 00000", fullName: "A. Candidate" };
  const parsed = ResumeProfileSchema.parse(withPii);
  assert.equal("email" in parsed, false);
  assert.equal("phone" in parsed, false);
  assert.equal("fullName" in parsed, false);

  const b = unwrap(resumeProfileToBlueprint(parsed, { emphasis: "mixed" }));
  const serialized = JSON.stringify(b);
  assert.ok(!serialized.includes("someone@example.com"));
  assert.ok(!serialized.includes("90000"));
  assert.ok(!serialized.includes("A. Candidate"));
});
