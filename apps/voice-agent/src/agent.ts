/**
 * The real spoken-interview loop, production wiring.
 *
 * Browser mic -> LiveKit -> Deepgram STT -> Claude (via packages/core) ->
 * Cartesia TTS -> browser audio, driving the same InterviewRunner/
 * InterviewBrain/silence-ladder built in M2-A/M2-B. As of M6.1, the brain is
 * the real M3 `AdaptiveBrain` — not the fixed 3-question `ClaudeEvaluationBrain`
 * script — loading the real plan/question pool from Postgres and persisting
 * evidence (asked questions, turns, signal judgments) plus the interview's
 * own lifecycle status (`interviews.status`/`started_at`/`ended_at`/
 * `end_reason`), which previously nothing in this codebase ever wrote —
 * every interview stayed at "configuring" forever regardless of outcome.
 *
 * Design choices worth being explicit about:
 *
 *  - No `llm:` on AgentSessionOptions. AgentSession's LLM slot exists to
 *    drive its OWN auto-reply generation (generateReply()); we never call
 *    that. `session.say()` speaks our own lines directly, and Claude is
 *    called through packages/core's provider seam, inside
 *    `AdaptiveBrain.evaluate()`. @livekit/agents never sees an Anthropic API
 *    key or a ChatContext bound to Claude's wire format.
 *
 *  - turnHandling.turnDetection: 'vad'. Silero is loaded locally (no
 *    credentials needed), so barge-in and end-of-utterance are both handled
 *    NATIVELY by AgentSession's own audio_recognition pipeline — this file
 *    never implements interruption; it only listens.
 *
 *  - A single direct Postgres connection per job process (matching
 *    postgres-evidence-sink.ts's already-established architecture: the
 *    voice agent bypasses RLS on this hot path, so every query is scoped
 *    explicitly by interviewId/userId, never trusted to a policy). Closed in
 *    addShutdownCallback alongside the brain's live LLM session.
 *
 *  - Persistence failures are logged, never silent, and never block the
 *    "ended" UiEvent the browser depends on — see interview-lifecycle.ts's
 *    `finalizeInterview`.
 */
import postgres from "postgres";
import {
  Agent, AgentSession, AgentSessionEventTypes, AutoSubscribe, defineAgent,
  type JobContext, type JobProcess, type VAD,
} from "@livekit/agents";
import { RoomEvent } from "@livekit/rtc-node";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as cartesia from "@livekit/agents-plugin-cartesia";
import * as silero from "@livekit/agents-plugin-silero";
import {
  AdaptiveBrain, createProvider, DEFAULT_LADDER, InterviewRunner,
  encodeUiEvent, UI_TOPIC, CONTROL_TOPIC, decodeControlEvent, deriveUiState,
  type VoiceIO, type UiEvent, type LkAgentState, type LkUserState,
} from "@ai/core";
import { loadEnv } from "./env.js";
import { logLiveKitMetrics, logTurnEvent, TurnTimer } from "./turn-metrics.js";
import { loadPlanData, loadSeenQuestionIds } from "./plan-loader.js";
import { PostgresEvidenceSink } from "./postgres-evidence-sink.js";
import { PostgresLifecycleStore, finalizeInterview, onUiEventForLifecycle } from "./interview-lifecycle.js";
import { newUsageAccumulator, persistUsageEvent } from "./usage-metering.js";

interface ProcessUserData {
  [key: string]: unknown;
  vad?: VAD;
}

/**
 * Built from the plan's own persona rather than hardcoded.
 *
 * This string previously read "You are Priya, a senior Salesforce engineer"
 * for EVERY interview — including resume and custom-document interviews,
 * where it is simply false. It is inert today (see the `llm:` note in the
 * header: AgentSession's LLM slot is never set and generateReply() is never
 * called, so this never reaches a model), but it is exactly the kind of
 * wrong-by-default string that becomes a real bug the moment that slot is
 * wired up. `plan.persona` is already loaded before the Agent is
 * constructed, so there is no reason to guess.
 *
 * The behavioural rules stay identical — only the identity is now real.
 */
function personaInstructions(persona: { name: string; style: string }): string {
  return (
    `You are ${persona.name}, conducting a live interview. ${persona.style} ` +
    "Never praise an answer, never teach, never summarise what the candidate just said."
  );
}

export default defineAgent<ProcessUserData>({
  // Silero VAD is a local ONNX model — no API key, only a one-time model
  // download on first use. Loading it in prewarm means it's ready before
  // any job needs it, and it's shared across jobs in this worker process.
  prewarm: async (proc: JobProcess<ProcessUserData>) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext<ProcessUserData>) => {
    const env = loadEnv();
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);

    const participant = await ctx.waitForParticipant();
    const interviewId = participant.attributes["interviewId"];
    if (!interviewId) {
      throw new Error("participant joined with no interviewId attribute — refusing to start an untracked interview");
    }
    logTurnEvent({ interviewId, event: "job_started", identity: participant.identity });

    const sql = postgres(env.DATABASE_URL, { max: 1 });
    const lifecycle = new PostgresLifecycleStore(sql);
    const usage = newUsageAccumulator();
    const jobStartedAt = Date.now();

    try {
      const [interviewRow] = await sql<{ user_id: string; plan_id: string }[]>`
        select user_id, plan_id from public.interviews where id = ${interviewId}`;
      if (!interviewRow) {
        throw new Error(`no interviews row for id=${interviewId} — the token was minted for a row that doesn't exist`);
      }

      const [{ plan, questions, topics }, seenQuestionIds] = await Promise.all([
        loadPlanData(sql, interviewRow.plan_id),
        loadSeenQuestionIds(sql, interviewRow.user_id),
      ]);

      const vad = ctx.proc.userData.vad;
      if (!vad) throw new Error("VAD failed to load in prewarm — refusing to start without it");

      const stt = new deepgram.STT({
        apiKey: env.DEEPGRAM_API_KEY,
        model: "nova-3",
        interimResults: true,
        smartFormat: true,
      });
      const tts = new cartesia.TTS({ apiKey: env.CARTESIA_API_KEY });
      usage.sttProvider = "deepgram";
      usage.ttsProvider = "cartesia";

      const agent = new Agent({ instructions: personaInstructions(plan.persona) });
      const session = new AgentSession({
        stt,
        tts,
        vad,
        turnHandling: {
          turnDetection: "vad",
          // The framework default (minDelay: 500ms) is tuned for casual
          // back-and-forth, not a technical interview: a candidate thinking
          // out loud mid-answer routinely pauses longer than that. 500ms was
          // firing false "end of turn" events on ordinary thinking pauses,
          // so the agent started the next question and immediately got
          // barge-in-interrupted when the candidate resumed talking a
          // moment later. 1500ms gives real thinking room while still
          // feeling responsive once someone actually stops.
          endpointing: { minDelay: 1500 },
        },
      });

      // ── failure boundaries: STT / TTS / LLM(realtime, unused) / interruption
      // detection errors all surface here. Never silent.
      session.on(AgentSessionEventTypes.Error, (ev) => {
        const err = ev.error;
        const isWrapped = !(err instanceof Error);
        // `source.label` is a method on LLM but a plain string field on
        // STT/TTS/RealtimeModel — normalize both.
        const sourceLabel =
          typeof ev.source?.label === "function" ? ev.source.label() : (ev.source?.label ?? "unknown");
        logTurnEvent({
          interviewId, event: "session_error",
          errorType: isWrapped ? err.type : "interruption_detection_error",
          message: isWrapped ? err.error.message : err.message,
          recoverable: isWrapped ? err.recoverable : false,
          source: sourceLabel,
        });
      });
      session.on(AgentSessionEventTypes.MetricsCollected, (ev) => {
        if (ev.metrics.type === "stt_metrics") usage.sttAudioS += ev.metrics.audioDurationMs / 1000;
        logLiveKitMetrics(interviewId, ev.metrics);
      });

      const onLifecycleError = (context: string, err: unknown) => {
        logTurnEvent({
          interviewId, event: context,
          message: err instanceof Error ? err.message : String(err),
        });
      };
      const lifecycleHook = onUiEventForLifecycle(lifecycle, interviewId, onLifecycleError);

      // ── VoiceIO: the only place this file bridges into packages/core ──────
      const io: VoiceIO = {
        now: () => Date.now(),
        async speak(text: string) {
          usage.ttsCharacters += text.length;
          logTurnEvent({ interviewId, event: "speak_start", chars: text.length });
          try {
            const handle = session.say(text, { allowInterruptions: true });
            // Resolves whether the speech completed OR was interrupted —
            // AgentSession owns that distinction, we just wait for the turn
            // to be over so the state machine can advance.
            await handle.waitForPlayout();
            logTurnEvent({ interviewId, event: "speak_done", interrupted: handle.interrupted });
          } catch (err) {
            // TTS failure boundary. Surfaced, not swallowed — the machine
            // still advances because a stuck ASK/PROBE state is worse than a
            // silently-skipped line.
            logTurnEvent({
              interviewId, event: "speak_failed",
              message: err instanceof Error ? err.message : String(err),
            });
          }
        },
        interrupt() {
          // Administrative cut only (End Interview, shutdown). Real barge-in
          // never reaches this — AgentSession already handled it via VAD.
          void (async () => {
            try {
              await session.interrupt().await;
            } catch {
              // Best-effort — nothing further to do if the cut itself fails.
            }
          })();
        },
        publishUi(event: UiEvent) {
          // The only server-side record of which phases actually ran in a
          // session — without it, PROBE (adaptive follow-up) can only be
          // inferred indirectly from timing in the log.
          if (event.t === "phase") {
            logTurnEvent({ interviewId, event: "phase", phase: event.phase });
          }
          lifecycleHook(event);
          const p = ctx.room.localParticipant;
          if (!p) return;
          void p.publishData(encodeUiEvent(event), { reliable: true, topic: UI_TOPIC }).catch((err) => {
            logTurnEvent({
              interviewId, event: "ui_publish_failed",
              message: err instanceof Error ? err.message : String(err),
            });
          });
        },
      };

      // ── the adaptive brain: real content pool, real signal ledger, real
      // probes, real evidence persistence — direct through packages/core,
      // never through AgentSession's llm slot ────────────────────────────
      const turnTimer = new TurnTimer(interviewId);
      const sink = new PostgresEvidenceSink(sql, interviewId, interviewRow.plan_id);
      const llmProvider = createProvider(env.AI_PROVIDER as "anthropic");
      usage.llmProvider = llmProvider.id;
      usage.llmModel = llmProvider.liveModel;
      const brain = new AdaptiveBrain({
        provider: llmProvider,
        plan, questions, topics, sink,
        seenQuestionIds,
        onDegraded: (reason, err) => {
          logTurnEvent({
            interviewId, event: "claude_degraded", reason,
            message: err instanceof Error ? err.message : String(err),
          });
        },
        onEvaluated: (info) => {
          turnTimer.markClaudeDone({ hadProbe: false }); // hadProbe logged separately via claude_eval
          usage.llmCostCents += info.costCents;
          logTurnEvent({ interviewId, event: "claude_usage", ...info });
        },
      });

      const runner = new InterviewRunner(brain, io, {
        durationS: plan.durationS, closingReserveS: 120, ladder: DEFAULT_LADDER,
      });

      // ── feed real LiveKit events into the same runner M2-A proved ─────────
      session.on(AgentSessionEventTypes.UserStateChanged, (ev) => {
        logTurnEvent({ interviewId, event: "user_state", from: ev.oldState, to: ev.newState });
        if (ev.newState === "speaking") void runner.onCandidateSpeaking();
        else void runner.onCandidateSilent();
        publishDerivedUiState();
      });

      session.on(AgentSessionEventTypes.UserInputTranscribed, (ev) => {
        if (!ev.isFinal || !ev.transcript.trim()) return;
        turnTimer.markUtteranceEnd();
        logTurnEvent({ interviewId, event: "utterance_final", chars: ev.transcript.length });
        void runner.onUtteranceFinal(ev.transcript);
      });

      // The browser's four-state display (connecting/ai_speaking/listening/
      // processing) is derived from AgentSession's own state, not tracked
      // separately.
      function publishDerivedUiState(): void {
        const state = deriveUiState(session.agentState as LkAgentState, session.userState as LkUserState);
        io.publishUi({ t: "ui_state", state, at: Date.now() });
      }
      session.on(AgentSessionEventTypes.AgentStateChanged, () => publishDerivedUiState());

      // The browser's one control message: an explicit "end the interview
      // now" from the candidate, routed to the graceful CLOSING path
      // (requestEnd()) rather than a bare disconnect, which the Close handler
      // below would otherwise treat as an abandoned session.
      ctx.room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== CONTROL_TOPIC) return;
        const event = decodeControlEvent(payload);
        if (event?.t === "end_interview") {
          logTurnEvent({ interviewId, event: "end_interview_requested" });
          void runner.requestEnd();
        }
      });

      // Declared before the Close handler below so that handler can stop it
      // the instant the session closes — clearing it only in
      // addShutdownCallback (which fires well after teardown starts) left the
      // ticker calling publishUi() against an already-disconnected room for a
      // couple of seconds, logging a stream of spurious ui_publish_failed.
      let ticker: NodeJS.Timeout | undefined;

      // ── LiveKit disconnect / session close — one of the required failure
      // boundaries. CloseReason maps directly onto our EndReason vocabulary.
      session.on(AgentSessionEventTypes.Close, (ev) => {
        logTurnEvent({ interviewId, event: "session_close", reason: ev.reason });
        if (ticker) clearInterval(ticker);
        if (ev.reason !== "user_initiated") void runner.onDisconnected();
      });

      await session.start({ agent, room: ctx.room });
      publishDerivedUiState(); // AgentStateChanged only fires on a change — the
                                // browser needs the starting value too.
      await lifecycle.markLive(interviewId);
      await runner.start();

      // Silence-ladder poll. Same 250ms cadence M2-A's mock used.
      ticker = setInterval(() => void runner.tick(), 250);

      ctx.addShutdownCallback(async () => {
        if (ticker) clearInterval(ticker);
        brain.dispose();
        // Last-resort net: if the room disconnected in a way that never
        // reached the Close handler above (e.g. the process is being killed
        // outright), an interview still sitting at 'live'/'configuring' at
        // shutdown is a bug, not a legitimate outcome — record it as an
        // abandonment rather than leaving it stuck forever.
        await finalizeInterview(lifecycle, interviewId, "error", onLifecycleError);
        usage.durationS = Math.round((Date.now() - jobStartedAt) / 1000);
        usage.livekitMinutes = usage.durationS / 60;
        await persistUsageEvent(sql, interviewId, interviewRow.user_id, usage).catch((err) => {
          logTurnEvent({ interviewId, event: "usage_persist_failed", message: err instanceof Error ? err.message : String(err) });
        });
        await sql.end({ timeout: 3 });
        logTurnEvent({ interviewId, event: "job_shutdown" });
      });
    } catch (err) {
      logTurnEvent({
        interviewId, event: "job_failed",
        message: err instanceof Error ? err.message : String(err),
      });
      await finalizeInterview(lifecycle, interviewId, "error", (context, e) => {
        logTurnEvent({ interviewId, event: context, message: e instanceof Error ? e.message : String(e) });
      });
      await sql.end({ timeout: 3 }).catch(() => {});
      throw err;
    }
  },
});
