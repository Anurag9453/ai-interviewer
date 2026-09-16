"use client";

import type { Phase, UiState } from "@ai/core";
import { VoiceOrb } from "@/components/VoiceOrb";

/**
 * What the interview actually is, straight from
 * GET /api/interviews/[id]/meta. Optional only because mock mode has no
 * server-side interview to describe; the real room always passes it.
 */
export interface StageMeta {
  kind: "standard" | "resume" | "material";
  title: string;
  detail: string | null;
  difficulty: string;
  durationS: number;
  personaName: string;
  personaInitial: string;
}

export interface StageProps {
  uiState: UiState;
  phase: Phase;
  elapsedS: number;
  remainingS: number;
  questionNumber: number;
  plannedTotal: number;
  transcript: string;
  nudge: string | null;
  connection: "good" | "degraded" | "lost";
  onEnd: () => void;
  /** Omitted entirely (e.g. mock mode with no real mic control) hides the mute button. */
  micMuted?: boolean;
  onToggleMic?: () => void;
  /** Absent until the metadata fetch resolves, and in mock mode. */
  meta?: StageMeta | null;
}

const KIND_LABEL: Record<StageMeta["kind"], string> = {
  standard: "Technical interview",
  resume: "Resume interview",
  material: "Your material",
};

const STATUS_LABEL: Record<UiState, string> = {
  connecting: "Connecting",
  ai_speaking: "Interviewer speaking",
  listening: "Listening",
  processing: "Thinking",
};

function mmss(total: number): string {
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The interview screen. Deliberately not a chat transcript — an interview room
 * has one thing happening at a time, so the screen shows interviewer status,
 * the clock, and where you are. Nothing scrolls, and there is no text input:
 * the only channel is voice, matching the app's actual architecture (no
 * client-side VAD or a second interruption system — this component only
 * ever renders state the agent published, never infers anything itself).
 */
export function InterviewStage(p: StageProps) {
  const speaking = p.uiState === "ai_speaking";
  const thinking = p.uiState === "processing";
  const listening = p.uiState === "listening";
  const hasMicControl = p.micMuted !== undefined && p.onToggleMic !== undefined;

  return (
    <main data-theme="studio" className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-[var(--color-line)] px-4 py-3.5 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          {p.meta ? (
            <>
              <span className="truncate text-sm font-medium">{p.meta.title}</span>
              {p.meta.kind !== "standard" && (
                <span className="rounded-full bg-[var(--color-accent-wash)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent-ink)]">
                  {KIND_LABEL[p.meta.kind]}
                </span>
              )}
              <span className="text-xs capitalize text-[var(--color-muted)]">{p.meta.difficulty}</span>
              {p.meta.detail && (
                <span className="hidden truncate text-xs text-[var(--color-muted)] sm:inline">· {p.meta.detail}</span>
              )}
            </>
          ) : (
            // No placeholder title — inventing one is how the old hardcoded
            // "Salesforce Developer" got shown for resume interviews.
            <span className="text-sm font-medium text-[var(--color-muted)]">Interview</span>
          )}
        </div>
        <div className="flex items-center gap-3.5 text-xs tabular-nums text-[var(--color-muted)] sm:gap-5">
          {p.connection !== "good" && (
            <span className="flex items-center gap-1.5 rounded-full bg-[var(--color-caution-wash)] px-2 py-0.5 text-[var(--color-caution)]">
              {p.connection === "lost" ? (
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-critical)]" />
              ) : (
                <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-caution)]" />
              )}
              {p.connection === "degraded" ? "Weak connection" : "Reconnecting…"}
            </span>
          )}
          {p.plannedTotal > 0 && (
            <span>Question {Math.max(1, p.questionNumber)} of {p.plannedTotal}</span>
          )}
          <span className="rounded-full bg-[var(--color-raised)] px-2.5 py-1 font-medium text-[var(--color-ink)]">
            {mmss(p.remainingS)} left
          </span>
        </div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
        <div className="relative">
          <VoiceOrb size={220} speaking={speaking} listening={listening} />
          <div className="absolute inset-0 grid place-items-center">
            <span className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-ink)] text-lg font-semibold text-[var(--color-surface)] ring-2 ring-white/10">
              {p.meta?.personaInitial ?? "\u00b7"}
            </span>
          </div>
          {thinking && (
            <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 gap-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-muted)]"
                  style={{ animationDelay: `${i * 140}ms` }}
                />
              ))}
            </span>
          )}
          {p.micMuted && (
            <span
              aria-hidden
              title="Microphone muted"
              className="absolute bottom-4 right-8 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-critical)] text-xs text-white ring-2 ring-[var(--color-surface)]"
            >
              🎤
            </span>
          )}
        </div>

        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">
            {p.meta ? `${p.meta.personaName} · AI Interviewer` : "AI Interviewer"}
          </p>
          <p aria-live="polite" className="font-display text-3xl">
            {STATUS_LABEL[p.uiState]}
          </p>
          {p.nudge && (
            <p className="text-sm text-[var(--color-muted)]">{p.nudge}</p>
          )}
        </div>

        <p className="min-h-[1.75rem] max-w-xl text-center text-lg leading-relaxed text-balance text-[var(--color-ink-soft)]">
          {p.transcript}
        </p>
      </section>

      <footer className="flex items-center justify-between border-t border-[var(--color-line)] px-6 py-4">
        <span className="text-xs tabular-nums text-[var(--color-muted)]">
          {mmss(p.elapsedS)} elapsed
        </span>
        <div className="flex items-center gap-2">
          {hasMicControl && (
            <button
              onClick={p.onToggleMic}
              aria-pressed={p.micMuted}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                p.micMuted
                  ? "border-[var(--color-critical)] bg-[color-mix(in_oklch,var(--color-critical)_18%,transparent)] text-[var(--color-critical)]"
                  : "border-[var(--color-line-strong)] hover:bg-[var(--color-raised)]"
              }`}
            >
              {p.micMuted ? "Unmute" : "Mute"}
            </button>
          )}
          <button
            onClick={p.onEnd}
            className="rounded-full border border-[var(--color-line-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-raised)]"
          >
            End interview
          </button>
        </div>
      </footer>
    </main>
  );
}
