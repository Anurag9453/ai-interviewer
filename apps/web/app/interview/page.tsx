"use client";

import { Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { UiEvent, UiState, Phase } from "@ai/core";
import { MicPreflight } from "@/components/MicPreflight";
import { InterviewStage, type StageMeta } from "@/components/InterviewStage";
import { startMockSession, type MockController } from "@/lib/mock-session";
import { InterviewRoomController, MicPublishError, type BrowserConnState } from "@/lib/interview-room";
import { connectionBadgeFor, tokenErrorFor, type FatalError } from "@/lib/connection-ui";
import { buttonClass } from "@/components/ui";

interface ScreenState {
  uiState: UiState;
  phase: Phase;
  elapsedS: number;
  remainingS: number;
  questionNumber: number;
  plannedTotal: number;
  transcript: string;
  nudge: string | null;
  connection: "good" | "degraded" | "lost";
  ended: { reason: string; reportPending: boolean } | null;
}

const INITIAL: ScreenState = {
  uiState: "connecting", phase: "INIT", elapsedS: 0, remainingS: 900,
  questionNumber: 0, plannedTotal: 0, transcript: "", nudge: null,
  connection: "good", ended: null,
};

function reduce(s: ScreenState, e: UiEvent): ScreenState {
  switch (e.t) {
    case "ui_state": return { ...s, uiState: e.state, nudge: e.state === "ai_speaking" ? null : s.nudge };
    case "phase": return { ...s, phase: e.phase };
    case "clock": return { ...s, elapsedS: e.elapsedS, remainingS: e.remainingS };
    case "progress": return { ...s, questionNumber: e.questionNumber, plannedTotal: e.plannedTotal };
    case "transcript": return { ...s, transcript: e.text };
    case "nudge": return { ...s, nudge: NUDGE_TEXT[e.stage] ?? null };
    case "connection": return { ...s, connection: e.quality };
    case "ended": return { ...s, ended: { reason: e.reason, reportPending: e.reportPending } };
    default: return s;
  }
}

function mmssElapsed(total: number): string {
  const s = Math.max(0, Math.round(total));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min` : `${s}s`;
}

const NUDGE_TEXT: Record<string, string> = {
  nudge: "Take your time.",
  offer: "Want to think out loud, or move on?",
  advance: "Moving to the next question.",
};

/** How long to wait after a successful room connection for the agent to show up. */
const AGENT_JOIN_TIMEOUT_MS = 20_000;

interface TokenResponse {
  interviewId: string;
  roomName: string;
  livekitUrl: string;
  token: string;
}

/**
 * Mock mode (`?mock=1`) runs the real state machine, ladder, and
 * ScriptedBrain client-side with zero credentials — useful for verifying the
 * four-state UI, the clock, and the nudge ladder without a live agent.
 *
 * Everything else routes through the real LiveKit path: fetch a token for
 * this interview, connect with InterviewRoomController, and feed the SAME
 * reducer above from real `UiEvent`s decoded off the data channel instead of
 * the mock's synthetic ones. The reducer, InterviewStage, and ladder timing
 * are identical in both paths — only the event source changes.
 */
function InterviewPageInner() {
  const searchParams = useSearchParams();
  const interviewId = searchParams.get("interviewId");
  const isMock = searchParams.get("mock") === "1";

  const [ready, setReady] = useState(false);
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const [connState, setConnState] = useState<BrowserConnState>("connecting");
  const [fatalError, setFatalError] = useState<FatalError | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [meta, setMeta] = useState<StageMeta | null>(null);

  const controllerRef = useRef<MockController | InterviewRoomController | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const endingRef = useRef(false);
  const timingRef = useRef<{ mount: number; connected?: number; firstAudio?: number }>({ mount: performance.now() });

  const onMicReady = useCallback((stream: MediaStream) => {
    streamRef.current = stream;
    setReady(true);
  }, []);

  // What this interview IS comes from the server, never from client state or
  // the URL — the room previously hardcoded a Salesforce/Intermediate header,
  // which was wrong for every custom and resume interview. Independent of the
  // LiveKit connection on purpose: the header stays correct even while the
  // connection is failing or retrying.
  useEffect(() => {
    if (isMock || !interviewId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/interviews/${interviewId}/meta`);
        if (!res.ok || cancelled) return;
        setMeta((await res.json()) as StageMeta);
      } catch {
        // Non-fatal: the header degrades to a neutral "Interview" label
        // rather than blocking the session or inventing a title.
      }
    })();
    return () => { cancelled = true; };
  }, [isMock, interviewId]);

  useEffect(() => {
    if (!ready) return;

    if (isMock) {
      const controller = startMockSession((e) => dispatch(e));
      controllerRef.current = controller;
      setConnState("connected");
      return () => {
        controller.stop();
        streamRef.current?.getTracks().forEach((t) => t.stop());
      };
    }

    if (!interviewId) {
      setFatalError({ code: "missing_interview", message: "No interview was specified.", retryable: false });
      return;
    }

    let disposed = false;
    let joinTimeout: ReturnType<typeof setTimeout> | undefined;

    const controller = new InterviewRoomController({
      onUiEvent: (e) => {
        if (e.t === "ended") endingRef.current = true;
        if (e.t === "ui_state" && e.state === "ai_speaking" && timingRef.current.firstAudio === undefined) {
          timingRef.current.firstAudio = performance.now();
          const since = timingRef.current.connected ?? timingRef.current.mount;
          console.info(`[interview ${interviewId}] time to first AI audio: ${Math.round(timingRef.current.firstAudio - since)}ms`);
        }
        dispatch(e);
      },
      onConnState: (s, detail) => {
        if (disposed) return;
        setConnState(s);
        console.info(`[interview ${interviewId}] connection state -> ${s}${detail ? ` (${detail})` : ""}`);
        if (s === "connected" && timingRef.current.connected === undefined) {
          timingRef.current.connected = performance.now();
          console.info(`[interview ${interviewId}] connect time: ${Math.round(timingRef.current.connected - timingRef.current.mount)}ms`);
        }
        if (s === "failed") {
          setFatalError({ code: "connection_failed", message: "Couldn't connect to the interview. Check your connection and try again.", retryable: true });
        }
        if (s === "disconnected" && !endingRef.current) {
          setFatalError({
            code: "disconnected",
            message: detail ? `Connection was lost (${detail}).` : "Connection was lost.",
            retryable: true,
          });
        }
      },
      onRemoteAudioTrack: (track) => {
        const el = audioElRef.current;
        if (!el) return;
        el.srcObject = new MediaStream([track.mediaStreamTrack]);
        el.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
      },
      onRemoteAudioTrackEnded: () => {
        if (audioElRef.current) audioElRef.current.srcObject = null;
      },
      onAgentJoined: () => {
        if (joinTimeout) clearTimeout(joinTimeout);
      },
    });
    controllerRef.current = controller;

    void (async () => {
      try {
        const res = await fetch(`/api/interviews/${interviewId}/token`);
        if (disposed) return;
        if (!res.ok) {
          setFatalError(tokenErrorFor(res.status));
          return;
        }
        const data = (await res.json()) as TokenResponse;
        await controller.connect(data.livekitUrl, data.token);
        if (disposed) return;
        joinTimeout = setTimeout(() => {
          if (!disposed) {
            setFatalError({ code: "agent_not_joined", message: "The interviewer didn't join. Please try again.", retryable: true });
          }
        }, AGENT_JOIN_TIMEOUT_MS);
      } catch (err) {
        if (disposed) return;
        if (err instanceof MicPublishError) {
          setFatalError({ code: "mic_publish_failed", message: "Couldn't access your microphone. Please check your device and try again.", retryable: true });
        } else {
          setFatalError({ code: "connection_failed", message: "Couldn't connect to the interview. Please try again.", retryable: true });
        }
      }
    })();

    return () => {
      disposed = true;
      if (joinTimeout) clearTimeout(joinTimeout);
      void controller.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [ready, isMock, interviewId, retryKey]);

  // Best-effort cleanup on a hard refresh/tab close. SPA route changes are
  // already covered by the effect's own cleanup above; this only matters for
  // navigation React never gets a chance to unmount for.
  useEffect(() => {
    if (isMock || !ready) return;
    function onBeforeUnload() {
      void controllerRef.current?.disconnect();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isMock, ready]);

  const handleEnd = useCallback(() => {
    const c = controllerRef.current;
    if (!c) return;
    endingRef.current = true;
    if (c instanceof InterviewRoomController) {
      c.sendEndInterview();
    } else {
      void c.end();
    }
  }, []);

  const retry = useCallback(() => {
    setFatalError(null);
    setConnState("connecting");
    endingRef.current = false;
    timingRef.current = { mount: performance.now() };
    setRetryKey((k) => k + 1);
  }, []);

  const toggleMic = useCallback(() => {
    setMicMuted((muted) => {
      const next = !muted;
      const c = controllerRef.current;
      if (c instanceof InterviewRoomController) {
        c.setMicMuted(next);
      } else {
        // Mock mode has no real published track, but the raw pre-flight
        // stream is still held — muting it is a real, if lower-stakes, mute.
        streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
      }
      return next;
    });
  }, []);

  if (!ready) return <MicPreflight onReady={onMicReady} />;

  if (fatalError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm text-[var(--color-muted)]">{fatalError.message}</p>
        <div className="flex gap-2.5">
          {fatalError.retryable && (
            <button
              onClick={retry}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white"
            >
              Try again
            </button>
          )}
          <a href="/dashboard" className="rounded-lg border border-black/12 px-4 py-2.5 text-sm font-medium hover:bg-black/[0.04]">
            Back to dashboard
          </a>
        </div>
      </main>
    );
  }

  if (state.ended) {
    const completedFully = state.ended.reason === "completed";
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-5 py-12 sm:px-6">
        <div className="animate-rise rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-raised)] p-6 shadow-[var(--shadow-card)] sm:p-8">
          <div className="flex items-center gap-3.5">
            <div
              aria-hidden
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg ${
                completedFully
                  ? "bg-[var(--color-positive-wash)] text-[var(--color-positive)]"
                  : "bg-[var(--color-sunken)] text-[var(--color-ink-soft)]"
              }`}
            >
              ✓
            </div>
            <div>
              <h1 className="text-xl font-semibold">
                {completedFully ? "Interview complete" : "Interview ended"}
              </h1>
              <p className="text-sm text-[var(--color-muted)]">
                {state.ended.reason === "user_ended" && "You ended it early — everything up to that point still counts."}
                {state.ended.reason === "completed" && "You got through every question."}
                {state.ended.reason === "disconnected" && "The connection dropped, so it ended early."}
              </p>
            </div>
          </div>

          {meta && (
            <p className="mt-4 text-sm text-[var(--color-muted)]">
              {meta.title}
              {meta.detail ? ` · ${meta.detail}` : ""} · {mmssElapsed(state.elapsedS)} spoken
            </p>
          )}

          <div className="mt-6 space-y-2.5">
            {interviewId && (
              <a href={`/interview/${interviewId}/report`} className={`${buttonClass.primary} w-full py-3`}>
                See your report
              </a>
            )}
            <p className="text-center text-xs text-[var(--color-muted)]">
              Scored on what you actually said, with the specific things you left out.
            </p>
          </div>

          <div className="mt-6 border-t border-[var(--color-line)] pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
              What next
            </p>
            <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
              <a href="/interview/new" className={`${buttonClass.secondary} flex-1`}>
                Practise another
              </a>
              <a href="/interviews" className={`${buttonClass.secondary} flex-1`}>
                All interviews
              </a>
              <a href="/dashboard" className={`${buttonClass.secondary} flex-1`}>
                Home
              </a>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      {!isMock && <audio ref={audioElRef} autoPlay hidden />}
      {audioBlocked && (
        <button
          onClick={() => { audioElRef.current?.play().then(() => setAudioBlocked(false)).catch(() => {}); }}
          className="fixed inset-x-0 top-0 z-10 w-full bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white"
        >
          Tap to enable interviewer audio
        </button>
      )}
      <InterviewStage
        {...state}
        meta={meta}
        connection={connectionBadgeFor(connState, state.connection)}
        onEnd={handleEnd}
        micMuted={micMuted}
        onToggleMic={toggleMic}
      />
    </>
  );
}

export default function InterviewPage() {
  return (
    <Suspense fallback={null}>
      <InterviewPageInner />
    </Suspense>
  );
}
