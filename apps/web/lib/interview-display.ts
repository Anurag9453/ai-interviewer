/**
 * Turning an interview row into something a candidate can read.
 *
 * Pure on purpose: the dashboard, history, progress and report pages all need
 * the same label, and the old dashboard hardcoded "Salesforce Developer" for
 * every row — which is wrong the moment a second category, an uploaded
 * document, or a resume interview exists.
 *
 * Custom and resume interviews get a synthetic `categories` row inserted with
 * `active = false`, and the categories RLS policy is "read active" — so a
 * client-side category lookup returns NOTHING for them. Their label has to
 * come from `custom_documents` (which is select-own) joined on
 * `generated_plan_id`, which is why this takes document fields rather than
 * just a category.
 */

export type InterviewKind = "standard" | "resume" | "material";

export interface InterviewDescriptorInput {
  categoryId: string;
  /** From `categories`, when readable (built-in, active categories only). */
  categoryLabel?: string | null;
  /** From `custom_documents`, matched via generated_plan_id → interviews.plan_id. */
  documentType?: "resume" | "material" | null;
  documentFilename?: string | null;
}

export interface InterviewDescriptor {
  kind: InterviewKind;
  title: string;
  /** Secondary line; omitted rather than empty when there's nothing to add. */
  detail?: string;
}

/** `salesforce_dev` → `Salesforce Dev`, used only when no label is readable. */
export function humanizeCategoryId(categoryId: string): string {
  return categoryId
    .replace(/^custom_/, "")
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Drops the extension so a filename reads as a document name, not a file. */
export function documentDisplayName(filename: string): string {
  return filename.replace(/\.(pdf|docx|txt)$/i, "").trim() || filename;
}

export function describeInterview(input: InterviewDescriptorInput): InterviewDescriptor {
  if (input.documentType === "resume") {
    return {
      kind: "resume",
      title: "Resume interview",
      ...(input.documentFilename ? { detail: documentDisplayName(input.documentFilename) } : {}),
    };
  }
  if (input.documentType === "material") {
    return {
      kind: "material",
      title: input.documentFilename ? documentDisplayName(input.documentFilename) : "Your material",
      detail: "Your own material",
    };
  }
  return {
    kind: "standard",
    title: input.categoryLabel?.trim() || humanizeCategoryId(input.categoryId),
  };
}

/**
 * What the candidate should see for a row's state. Deliberately hides the
 * internal vocabulary — 'configuring' and 'grading' are implementation
 * states, not things to explain to a user mid-flow.
 */
export function statusLabel(status: string, endReason?: string | null): string {
  switch (status) {
    case "complete":
      return endReason === "user_ended" ? "Ended early" : "Completed";
    case "abandoned":
      return endReason === "disconnected" ? "Disconnected" : "Not finished";
    case "live":
      return "In progress";
    case "grading":
      return "Scoring";
    case "configuring":
      return "Not started";
    default:
      return "Unknown";
  }
}

/** True when the interview has reached a state that can have a report. */
export function isTerminal(status: string): boolean {
  return status === "complete" || status === "abandoned";
}

export function formatMinutes(durationS: number): string {
  const min = Math.round(durationS / 60);
  return `${min} min`;
}

/** Score band, used for colouring a score without inventing new thresholds. */
export function scoreBand(score: number): "strong" | "mixed" | "weak" {
  if (score >= 70) return "strong";
  if (score >= 45) return "mixed";
  return "weak";
}
