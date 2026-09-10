import { z } from "zod";
import { DifficultySchema } from "./plan.js";

/**
 * What the resume-analysis pass produces — the candidate reviews this before
 * any question is written, exactly like DocumentBlueprint in M7.
 *
 * This is NOT a second interview engine. A ResumeProfile is converted by a
 * pure function (resume-blueprint.ts) into the same DocumentBlueprint the
 * generic document pipeline already consumes, so question generation, plan
 * validation, AdaptiveBrain, evidence and reports are all untouched.
 *
 * PRIVACY: deliberately has no field for name, email, phone, address, date of
 * birth, nationality, marital status, photo or personal URLs. A resume
 * contains all of those and none of them are needed to interview someone, so
 * the prompt is instructed not to emit them and the schema gives them nowhere
 * to land. Anything the model tries to return outside these fields is dropped
 * by the zod parse rather than persisted.
 */

/** How the interview should lean. Chosen by the candidate at configuration. */
export const RESUME_EMPHASES = ["experience", "technical_depth", "projects", "problem_solving", "mixed"] as const;
export const ResumeEmphasisSchema = z.enum(RESUME_EMPHASES);
export type ResumeEmphasis = z.infer<typeof ResumeEmphasisSchema>;

export const ResumeRoleSchema = z.object({
  /** Job title as stated, e.g. "Senior Salesforce Developer". */
  title: z.string().min(1).max(120),
  /** Employer/organisation when the resume names one. Often absent for freelance work. */
  organization: z.string().min(1).max(120).nullable(),
  /** The duration as the resume expresses it, e.g. "2021–2024" or "18 months". Not parsed into dates. */
  durationLabel: z.string().min(1).max(60).nullable(),
  isCurrent: z.boolean(),
  /** What they say they did — the raw material for responsibility/decision questions. */
  responsibilities: z.array(z.string().min(1).max(300)).max(8),
  /** Outcomes they claim, which are the most probe-worthy statements on a resume. */
  achievements: z.array(z.string().min(1).max(300)).max(8),
  technologies: z.array(z.string().min(1).max(60)).max(15),
});
export type ResumeRole = z.infer<typeof ResumeRoleSchema>;

export const ResumeProjectSchema = z.object({
  name: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  technologies: z.array(z.string().min(1).max(60)).max(15),
  /** Specific assertions about the project worth asking them to justify. */
  claims: z.array(z.string().min(1).max(300)).max(6),
});
export type ResumeProject = z.infer<typeof ResumeProjectSchema>;

export const ResumeEducationSchema = z.object({
  qualification: z.string().min(1).max(160),
  institution: z.string().min(1).max(160).nullable(),
  detail: z.string().min(1).max(200).nullable(),
});
export type ResumeEducation = z.infer<typeof ResumeEducationSchema>;

export const ResumeFollowUpSchema = z.object({
  /** Short name of the area to dig into. */
  area: z.string().min(1).max(160),
  /** Why it's worth probing — grounded in something the resume actually says. */
  rationale: z.string().min(1).max(300),
});
export type ResumeFollowUp = z.infer<typeof ResumeFollowUpSchema>;

export const ResumeProfileSchema = z.object({
  /** One line describing the candidate professionally — role and rough seniority, never their name. */
  headline: z.string().min(1).max(200),
  /** Professional domain, e.g. "Salesforce development", "data engineering". */
  domain: z.string().min(1).max(120),
  /** Total experience as the resume supports it, e.g. "about 4 years". Null when genuinely unclear. */
  totalExperienceLabel: z.string().min(1).max(60).nullable(),
  seniority: z.enum(["junior", "mid", "senior", "lead", "unclear"]),

  roles: z.array(ResumeRoleSchema).max(12),
  projects: z.array(ResumeProjectSchema).max(12),
  skills: z.array(z.string().min(1).max(60)).max(30),
  technologies: z.array(z.string().min(1).max(60)).max(30),
  education: z.array(ResumeEducationSchema).max(6),
  certifications: z.array(z.string().min(1).max(160)).max(12),

  /**
   * Standalone claims worth challenging — "handled large data volumes",
   * "reduced load time by 40%". These are what let the interviewer say
   * "you mentioned X, walk me through it" instead of asking generically.
   */
  notableClaims: z.array(z.string().min(1).max(300)).max(20),
  /** Where an interviewer should dig, with the reason. */
  followUpAreas: z.array(ResumeFollowUpSchema).max(12),
  /**
   * Places the resume is vague or unsubstantiated. Honest signal, and often
   * the most productive interview material — but never fabricated into
   * topics, since there's nothing concrete behind them.
   */
  thinAreas: z.array(z.string().min(1).max(200)).max(10),

  suggestedDifficulty: DifficultySchema,
  difficultyRationale: z.string().min(1).max(300),
});
export type ResumeProfile = z.infer<typeof ResumeProfileSchema>;

/**
 * Job-description support is a planned follow-up, NOT implemented here.
 *
 * The extension point is deliberately narrow: a JD would be uploaded as a
 * second `custom_documents` row (`document_type = 'job_description'`, already
 * documented on that column), analysed into its own profile, and passed
 * alongside the resume into `resumeProfileToBlueprint`'s options object —
 * which exists as an object precisely so a `jobDescription` field can be
 * added without changing any call site. It would influence topic weighting
 * and add gap-probing angles. Nothing about ResumeProfile needs to change to
 * accommodate it, which is why no placeholder types are defined now.
 */
