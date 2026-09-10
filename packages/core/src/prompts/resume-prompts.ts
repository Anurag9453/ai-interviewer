/**
 * Prompt builder for the resume-analysis pass (M10).
 *
 * Only ANALYSIS is resume-specific. Question generation deliberately reuses
 * the generic document prompts unchanged — a ResumeProfile is converted into
 * a DocumentBlueprint first (resume-blueprint.ts), so there is exactly one
 * question-writing prompt in the system, held to one bar.
 *
 * Pure string builder — no I/O, no provider calls.
 */

export interface ResumeAnalysisPromptInput {
  /** Already extracted, normalized and length-capped — see document-extraction.ts. */
  text: string;
  filename: string;
}

export function buildResumeAnalysisPrompt(input: ResumeAnalysisPromptInput): string {
  return `You are reading a candidate's resume so that a mock interview can be built
around their actual experience. You are not writing interview questions yet —
only extracting a structured, faithful picture of what this resume claims.

## RESUME
filename: ${input.filename}

## TEXT
${input.text}

## TASK
Extract:
- headline: one line describing them professionally (role + rough seniority).
- domain: their professional domain, e.g. "Salesforce development".
- totalExperienceLabel: total experience if the resume supports it (e.g.
  "about 4 years"). Use null if it genuinely cannot be determined — do not
  estimate from thin air.
- seniority: junior / mid / senior / lead / unclear.
- roles: each position held, with title, organization (null if not named),
  durationLabel exactly as the resume expresses it (null if absent),
  isCurrent, the responsibilities and achievements it states, and the
  technologies attached to that role.
- projects: named projects, with a summary, technologies, and the specific
  claims made about each.
- skills and technologies: as listed or clearly implied.
- education and certifications: qualifications, institutions, detail.
- notableClaims: standalone, checkable assertions worth asking them to
  justify — "handled large data volumes", "cut deploy time in half". These
  are the most valuable output of this task, because they let the
  interviewer reference the candidate's own words instead of asking
  something generic.
- followUpAreas: where an interviewer should dig, each with a rationale
  grounded in something the resume actually says.
- thinAreas: places the resume is vague, unsubstantiated, or claims
  something with no supporting detail. Be honest here rather than generous.
- suggestedDifficulty (beginner/intermediate/advanced) and a one-line
  difficultyRationale, judged from the depth and seniority the resume
  demonstrates.

## RULES
Ground every field in what this resume actually states. Do not infer
seniority, duration or expertise the text does not support, and do not
invent projects, employers or achievements. A thin or near-empty resume must
produce a thin profile — returning empty arrays is correct and expected in
that case, and far better than padding.

PRIVACY — this is a hard requirement. Do NOT output the candidate's name,
email address, phone number, postal address, date of birth, nationality,
gender, marital status, photo, or personal links (LinkedIn, GitHub,
portfolio). None of it is needed to interview someone. Describe the person
only by role, seniority and domain. If a field would only be fillable with
personal identifying information, leave it out.`;
}
