/**
 * Pure UI-state mapping for the interview room's connection/error surfaces —
 * split out from page.tsx so the mapping itself is unit-testable without a
 * live Room or DOM.
 */
import type { BrowserConnState } from "@/lib/interview-room";

export type ConnectionBadge = "good" | "degraded" | "lost";

/** Maps the browser's 5-state Room connection lifecycle onto the 3-state badge InterviewStage renders. */
export function connectionBadgeFor(connState: BrowserConnState, fallback: ConnectionBadge): ConnectionBadge {
  switch (connState) {
    case "reconnecting": return "degraded";
    case "disconnected":
    case "failed": return "lost";
    default: return fallback;
  }
}

export interface FatalError {
  code: string;
  message: string;
  retryable: boolean;
}

const TOKEN_ERROR: Record<number, FatalError> = {
  401: { code: "unauthenticated", message: "Your session expired. Please sign in again.", retryable: false },
  403: { code: "not_your_interview", message: "This interview doesn't belong to your account.", retryable: false },
  404: { code: "not_found", message: "This interview couldn't be found.", retryable: false },
  409: { code: "interview_already_ended", message: "This interview has already ended.", retryable: false },
  503: { code: "livekit_not_configured", message: "Voice isn't available right now. Please try again shortly.", retryable: true },
};

const DEFAULT_TOKEN_ERROR: FatalError = {
  code: "token_failed", message: "Couldn't prepare the interview. Please try again.", retryable: true,
};

/** Maps a `/api/interviews/[id]/token` HTTP status to the fatal-error screen's content. */
export function tokenErrorFor(status: number): FatalError {
  return TOKEN_ERROR[status] ?? DEFAULT_TOKEN_ERROR;
}
