/**
 * Persists `interviews.status`/`started_at`/`ended_at`/`end_reason` — the
 * one thing NOTHING in the codebase wrote before M6.1, which is why every
 * interview ever run stayed at status "configuring" forever regardless of
 * how it actually ended. `EndReason` (packages/core) and the DB's
 * `end_reason` CHECK constraint already use the exact same five values by
 * design (see the M0 schema comment); this module is the missing wire, not
 * a new vocabulary.
 */
import type { Sql } from "postgres";
import type { EndReason, UiEvent } from "@ai/core";

/** Only two DB statuses an interview can end in — the CHECK constraint permits five, but nothing here ever writes "grading" (GRADING is instantaneous today, per runner.ts). */
export type TerminalStatus = "complete" | "abandoned";

/** Same mapping runner.ts's own `end()` uses to pick a machine phase for each EndReason. */
export function endReasonToStatus(reason: EndReason): TerminalStatus {
  return reason === "disconnected" || reason === "error" ? "abandoned" : "complete";
}

export interface LifecycleStore {
  /** Idempotent: only moves configuring -> live. A retried/duplicate call is a no-op. */
  markLive(interviewId: string): Promise<void>;
  /** Idempotent: only moves a non-terminal status to complete/abandoned. A duplicate teardown must never double-write. */
  markEnded(interviewId: string, reason: EndReason): Promise<void>;
}

export class PostgresLifecycleStore implements LifecycleStore {
  constructor(private readonly sql: Sql) {}

  async markLive(interviewId: string): Promise<void> {
    await this.sql`
      update public.interviews
      set status = 'live', started_at = coalesce(started_at, now())
      where id = ${interviewId} and status = 'configuring'`;
  }

  async markEnded(interviewId: string, reason: EndReason): Promise<void> {
    const status = endReasonToStatus(reason);
    await this.sql`
      update public.interviews
      set status = ${status},
          ended_at = now(),
          end_reason = ${reason},
          actual_duration_s = greatest(0, extract(epoch from (now() - coalesce(started_at, created_at)))::int)
      where id = ${interviewId} and status not in ('complete', 'abandoned')`;
  }
}

/** In-memory test double — mirrors InMemoryEvidenceSink's role for evidence-sink.ts. */
export class FakeLifecycleStore implements LifecycleStore {
  readonly liveCalls: string[] = [];
  readonly endedCalls: Array<{ interviewId: string; reason: EndReason }> = [];
  private readonly status = new Map<string, TerminalStatus | "live">();

  async markLive(interviewId: string): Promise<void> {
    this.liveCalls.push(interviewId);
    if (!this.status.has(interviewId)) this.status.set(interviewId, "live");
  }

  async markEnded(interviewId: string, reason: EndReason): Promise<void> {
    const current = this.status.get(interviewId);
    if (current === "complete" || current === "abandoned") return; // idempotent, matches the SQL guard
    this.endedCalls.push({ interviewId, reason });
    this.status.set(interviewId, endReasonToStatus(reason));
  }

  statusOf(interviewId: string): TerminalStatus | "live" | "configuring" {
    return this.status.get(interviewId) ?? "configuring";
  }
}

/**
 * Finalizes an interview exactly once, tolerating a failing store: a DB
 * outage must never block the "ended" UiEvent the browser depends on, or
 * crash the agent process. Logged, never silent — mirrors every other
 * degrade path in this codebase (claude_degraded, ui_publish_failed, ...).
 */
export async function finalizeInterview(
  store: LifecycleStore,
  interviewId: string,
  reason: EndReason,
  onError: (context: string, err: unknown) => void,
): Promise<void> {
  try {
    await store.markEnded(interviewId, reason);
  } catch (err) {
    onError("lifecycle_write_failed", err);
  }
}

/**
 * The exact hook agent.ts installs on `VoiceIO.publishUi`, factored out so a
 * test can drive a real InterviewRunner/AdaptiveBrain through
 * `publishUi(event)` and assert on the SAME function production runs,
 * instead of a parallel reimplementation that could silently drift from it.
 * `{t:"ended"}` fires exactly once per interview (the state machine's own
 * terminal-phase absorption guarantees this — see interview-machine.ts), and
 * `finalizeInterview`'s store-level idempotency guards it again regardless.
 */
export function onUiEventForLifecycle(
  store: LifecycleStore,
  interviewId: string,
  onError: (context: string, err: unknown) => void,
): (event: UiEvent) => void {
  return (event: UiEvent) => {
    if (event.t !== "ended") return;
    void finalizeInterview(store, interviewId, event.reason as EndReason, onError);
  };
}
