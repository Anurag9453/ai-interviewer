/**
 * ResumeProfile -> DocumentBlueprint. Pure, deterministic, no I/O.
 *
 * This function is the whole reason resumes don't need their own interview
 * engine. Once a resume is expressed as a DocumentBlueprint, the existing
 * generateDocumentPlan() writes the questions, validatePlan() holds them to
 * the same bar as seeded M1 content, and the plan runs through the same
 * AdaptiveBrain, evidence sink and report path. Nothing downstream knows or
 * cares that the source was a resume.
 *
 * Being pure also means every mapping decision here is testable without a
 * provider, which matters because this is where "grounded in the candidate's
 * own claims" is actually enforced: candidateFacts is populated from what the
 * resume asserts, and that is what lets the interviewer say "you mentioned X,
 * walk me through it" rather than asking something generic.
 */
import type { DocumentBlueprint, BlueprintTopic } from "./schema/document-analysis.js";
import type { ResumeEmphasis, ResumeProfile } from "./schema/resume-analysis.js";

/** DocumentBlueprintSchema's own limits, mirrored so this can clamp to them. */
const LIMITS = {
  subject: 200,
  domain: 120,
  topics: 12,
  topicLabel: 80,
  topicDescription: 700,
  subtopic: 120,
  subtopicsPerTopic: 8,
  concept: 120,
  concepts: 20,
  section: 160,
  sections: 20,
  fact: 300,
  facts: 30,
  angle: 200,
  angles: 10,
  rationale: 300,
} as const;

/**
 * How much each kind of resume material matters, per emphasis. These are
 * relative importances handed to the question generator — they steer how many
 * questions a topic attracts, they don't hard-filter anything.
 */
const EMPHASIS_WEIGHTS: Record<ResumeEmphasis, { role: number; project: number; skill: number }> = {
  experience: { role: 1.0, project: 0.65, skill: 0.45 },
  projects: { role: 0.65, project: 1.0, skill: 0.5 },
  technical_depth: { role: 0.6, project: 0.8, skill: 1.0 },
  problem_solving: { role: 0.85, project: 0.9, skill: 0.55 },
  mixed: { role: 0.85, project: 0.85, skill: 0.7 },
};

export interface ResumeBlueprintOptions {
  emphasis: ResumeEmphasis;
  /**
   * Extension point for Resume + Job Description (see the note in
   * schema/resume-analysis.ts). A future `jobDescription` field enters here
   * and adjusts weighting/angles; taking an options object today means adding
   * it later changes no call site.
   */
}

export type ResumeBlueprintResult =
  | { ok: true; blueprint: DocumentBlueprint }
  | { ok: false; reason: "too_thin"; detail: string };

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max).trimEnd();
}

/** Non-empty, clipped, de-duplicated (case-insensitively), capped. */
function cleanList(values: readonly string[], maxItem: number, maxCount: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = clip(raw, maxItem);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= maxCount) break;
  }
  return out;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number(n.toFixed(3))));
}

function roleTopic(role: ResumeProfile["roles"][number], index: number, weight: number): BlueprintTopic {
  const where = role.organization ? ` at ${role.organization}` : "";
  const when = role.durationLabel ? ` (${role.durationLabel})` : "";
  // The description is what the question generator reads, so it carries the
  // candidate's own stated responsibilities and outcomes verbatim-ish rather
  // than a summary of them.
  const parts = [
    `${role.title}${where}${when}.`,
    role.responsibilities.length ? `Stated responsibilities: ${role.responsibilities.join("; ")}.` : "",
    role.achievements.length ? `Claimed outcomes: ${role.achievements.join("; ")}.` : "",
    role.technologies.length ? `Technologies: ${role.technologies.join(", ")}.` : "",
  ].filter(Boolean);

  return {
    id: `role-${index + 1}`,
    label: clip(role.organization ? `${role.title} — ${role.organization}` : role.title, LIMITS.topicLabel),
    description: clip(parts.join(" "), LIMITS.topicDescription),
    subtopics: cleanList(
      [...role.responsibilities, ...role.achievements],
      LIMITS.subtopic,
      LIMITS.subtopicsPerTopic,
    ),
    // A current role is the most defensible thing to interview on, so it
    // outranks past ones at equal emphasis.
    importance: clamp01(weight * (role.isCurrent ? 1 : 0.85)),
  };
}

function projectTopic(project: ResumeProfile["projects"][number], index: number, weight: number): BlueprintTopic {
  const parts = [
    `${project.name}: ${project.summary}`,
    project.claims.length ? `Claims made: ${project.claims.join("; ")}.` : "",
    project.technologies.length ? `Technologies: ${project.technologies.join(", ")}.` : "",
  ].filter(Boolean);

  return {
    id: `project-${index + 1}`,
    label: clip(project.name, LIMITS.topicLabel),
    description: clip(parts.join(" "), LIMITS.topicDescription),
    subtopics: cleanList([...project.claims, ...project.technologies], LIMITS.subtopic, LIMITS.subtopicsPerTopic),
    importance: clamp01(weight),
  };
}

/**
 * One topic for the toolkit rather than one per technology — a question pool
 * needs a topic with enough substance behind it, and "React" alone isn't a
 * topic, it's a subtopic of "what they claim to know".
 */
function skillsTopic(profile: ResumeProfile, weight: number): BlueprintTopic | null {
  const tools = cleanList([...profile.technologies, ...profile.skills], LIMITS.subtopic, LIMITS.subtopicsPerTopic);
  if (tools.length === 0) return null;
  return {
    id: "skills",
    label: clip(`Technical depth: ${profile.domain}`, LIMITS.topicLabel),
    description: clip(
      `Skills and technologies the resume claims: ${[...profile.technologies, ...profile.skills].join(", ")}. ` +
        `Probe claimed familiarity for real depth rather than accepting the list at face value.`,
      LIMITS.topicDescription,
    ),
    subtopics: tools,
    importance: clamp01(weight),
  };
}

export function resumeProfileToBlueprint(
  profile: ResumeProfile, options: ResumeBlueprintOptions,
): ResumeBlueprintResult {
  const weights = EMPHASIS_WEIGHTS[options.emphasis];

  const topics: BlueprintTopic[] = [
    ...profile.roles.map((r, i) => roleTopic(r, i, weights.role)),
    ...profile.projects.map((p, i) => projectTopic(p, i, weights.project)),
  ];
  const skills = skillsTopic(profile, weights.skill);
  if (skills) topics.push(skills);

  // A resume with no roles, no projects and nothing but a couple of stray
  // keywords cannot ground a real interview. Saying so is better than
  // generating plausible-sounding questions about nothing — and the
  // blueprint schema requires at least one topic anyway.
  const grounded = profile.roles.length + profile.projects.length;
  if (grounded === 0 && (skills?.subtopics.length ?? 0) < 3) {
    return {
      ok: false,
      reason: "too_thin",
      detail:
        "This resume doesn't contain enough detail to interview on — no roles or projects were found, " +
        "and too few skills to build questions around.",
    };
  }

  // Highest-importance topics win the 12 slots; ties keep source order, so
  // the mapping stays deterministic for the same profile and emphasis.
  const ranked = topics
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.importance - a.t.importance || a.i - b.i)
    .slice(0, LIMITS.topics)
    .map(({ t }) => t);

  // The candidate's own assertions. This is the grounding contract: every
  // one of these is something they wrote, so a question referencing it is
  // referencing them, not a generic template.
  const candidateFacts = cleanList(
    [
      ...profile.notableClaims,
      ...profile.roles.flatMap((r) => r.achievements),
      ...profile.projects.flatMap((p) => p.claims),
    ],
    LIMITS.fact,
    LIMITS.facts,
  );

  const angles = cleanList(
    [
      ...profile.followUpAreas.map((f) => `${f.area} — ${f.rationale}`),
      // Thin areas are legitimate angles, but only as "ask them to
      // substantiate it", never as invented topics with fake substance.
      ...profile.thinAreas.map((t) => `Ask them to substantiate: ${t}`),
    ],
    LIMITS.angle,
    LIMITS.angles,
  );

  const experience = profile.totalExperienceLabel ? `, ${profile.totalExperienceLabel}` : "";

  return {
    ok: true,
    blueprint: {
      subject: clip(`${profile.headline}${experience}`, LIMITS.subject),
      domain: clip(profile.domain, LIMITS.domain),
      topics: ranked,
      concepts: cleanList([...profile.technologies, ...profile.skills], LIMITS.concept, LIMITS.concepts),
      importantSections: cleanList(
        [
          ...profile.roles.map((r) => (r.organization ? `${r.title} — ${r.organization}` : r.title)),
          ...profile.projects.map((p) => p.name),
          ...profile.certifications,
        ],
        LIMITS.section,
        LIMITS.sections,
      ),
      candidateFacts,
      suggestedAngles: angles,
      suggestedDifficulty: profile.suggestedDifficulty,
      difficultyRationale: clip(profile.difficultyRationale, LIMITS.rationale),
    },
  };
}
