/**
 * Interview state machine.
 *
 * Pure reducer: (state, event) -> { state, effects }. It performs no I/O, so
 * every transition is testable without LiveKit, a model, or a clock. The
 * voice agent interprets the returned effects.
 */

export type Phase =
  | "INIT"
  | "INTRO"
  | "ASK"
  | "LISTEN"
  | "EVALUATE"
  | "PROBE"
  | "SELECT_NEXT"
  | "CLOSING"
  | "GRADING"
  | "COMPLETE"
  | "ABANDONED";

export interface MachineState {
  phase: Phase;
  questionIndex: number;
  probesUsed: number;
  /** Set when the phase was reached, for elapsed-time effects. */
  enteredAt: number;
  endReason: EndReason | null;
}

export type EndReason =
  | "completed"
  | "user_ended"
  | "timeout"
  | "disconnected"
  | "error";

export type Event =
  | { t: "CONNECTED"; at: number }
  | { t: "INTRO_SPOKEN"; at: number }
  | { t: "QUESTION_SPOKEN"; at: number }
  | { t: "UTTERANCE_FINAL"; at: number; text: string }
  | {
      t: "EVALUATED";
      at: number;
      hasUnresolvedSignals: boolean;
      probesRemaining: number;
      /** Seconds left before the closing reserve must begin. */
      timeLeftS: number;
      /** Shortest hard time of any remaining candidate question. */
      minNextQuestionS: number;
    }
  | { t: "PROBE_SPOKEN"; at: number }
  | { t: "SILENCE_ADVANCE"; at: number }
  | { t: "SKIP_REQUESTED"; at: number }
  | { t: "NEXT_SELECTED"; at: number; questionIndex: number }
  | { t: "NO_QUESTION_AVAILABLE"; at: number }
  | { t: "CLOSING_SPOKEN"; at: number }
  | { t: "GRADED"; at: number }
  | { t: "GRADING_FAILED"; at: number }
  | { t: "END_REQUESTED"; at: number }
  | { t: "DISCONNECTED"; at: number }
  | { t: "ERROR"; at: number };

export type Effect =
  | { do: "speak_intro" }
  | { do: "speak_question"; questionIndex: number }
  | { do: "speak_probe" }
  | { do: "speak_closing" }
  | { do: "start_silence_ladder" }
  | { do: "cancel_silence_ladder" }
  | { do: "evaluate_utterance"; text: string }
  | { do: "select_next_question" }
  | { do: "close_question"; reason: CloseReason }
  | { do: "start_grading" }
  | { do: "publish_phase"; phase: Phase }
  | { do: "teardown"; reason: EndReason };

export type CloseReason =
  | "covered"
  | "time"
  | "probes_exhausted"
  | "candidate_stuck"
  | "interview_ended";

export interface Transition {
  state: MachineState;
  effects: Effect[];
}

export function initialState(now = 0): MachineState {
  return { phase: "INIT", questionIndex: -1, probesUsed: 0, enteredAt: now, endReason: null };
}

/** Phases after which grading is still worth attempting. */
const TERMINAL: ReadonlySet<Phase> = new Set(["COMPLETE", "ABANDONED"]);

export function transition(state: MachineState, event: Event): Transition {
  // Terminal phases absorb everything — a late event must not resurrect a
  // finished interview.
  if (TERMINAL.has(state.phase)) return { state, effects: [] };

  // Universal exits, checked before per-phase handling.
  if (event.t === "DISCONNECTED") {
    return end(state, event.at, "ABANDONED", "disconnected");
  }
  if (event.t === "ERROR") {
    return end(state, event.at, "ABANDONED", "error");
  }
  if (event.t === "END_REQUESTED") {
    // The user pressed End. Go to CLOSING so the interview is graded on what
    // was actually covered rather than discarded.
    if (state.phase === "CLOSING" || state.phase === "GRADING") return { state, effects: [] };
    return {
      state: { ...state, phase: "CLOSING", enteredAt: event.at, endReason: "user_ended" },
      effects: [
        { do: "cancel_silence_ladder" },
        { do: "close_question", reason: "interview_ended" },
        { do: "publish_phase", phase: "CLOSING" },
        { do: "speak_closing" },
      ],
    };
  }

  switch (state.phase) {
    case "INIT":
      if (event.t === "CONNECTED") {
        return move(state, event.at, "INTRO", [{ do: "speak_intro" }]);
      }
      return { state, effects: [] };

    case "INTRO":
      if (event.t === "INTRO_SPOKEN") {
        return move(state, event.at, "SELECT_NEXT", [{ do: "select_next_question" }]);
      }
      return { state, effects: [] };

    case "ASK":
      if (event.t === "QUESTION_SPOKEN") {
        // The ladder starts only once the question has finished playing —
        // starting it earlier would count the agent's own speech as silence.
        return move(state, event.at, "LISTEN", [{ do: "start_silence_ladder" }]);
      }
      return { state, effects: [] };

    case "LISTEN":
      if (event.t === "UTTERANCE_FINAL") {
        return move(state, event.at, "EVALUATE", [
          { do: "cancel_silence_ladder" },
          { do: "evaluate_utterance", text: event.text },
        ]);
      }
      if (event.t === "SILENCE_ADVANCE" || event.t === "SKIP_REQUESTED") {
        return move(state, event.at, "SELECT_NEXT", [
          { do: "cancel_silence_ladder" },
          { do: "close_question", reason: "candidate_stuck" },
          { do: "select_next_question" },
        ]);
      }
      return { state, effects: [] };

    case "EVALUATE": {
      if (event.t !== "EVALUATED") return { state, effects: [] };
      const canProbe =
        event.hasUnresolvedSignals &&
        event.probesRemaining > 0 &&
        event.timeLeftS > event.minNextQuestionS;
      if (canProbe) {
        return {
          state: { ...state, phase: "PROBE", probesUsed: state.probesUsed + 1, enteredAt: event.at },
          effects: [{ do: "publish_phase", phase: "PROBE" }, { do: "speak_probe" }],
        };
      }
      const reason: CloseReason = event.hasUnresolvedSignals
        ? event.probesRemaining > 0
          ? "time"
          : "probes_exhausted"
        : "covered";
      return move(state, event.at, "SELECT_NEXT", [
        { do: "close_question", reason },
        { do: "select_next_question" },
      ]);
    }

    case "PROBE":
      if (event.t === "PROBE_SPOKEN") {
        return move(state, event.at, "LISTEN", [{ do: "start_silence_ladder" }]);
      }
      return { state, effects: [] };

    case "SELECT_NEXT":
      if (event.t === "NEXT_SELECTED") {
        return {
          state: {
            ...state,
            phase: "ASK",
            questionIndex: event.questionIndex,
            probesUsed: 0,
            enteredAt: event.at,
          },
          effects: [
            { do: "publish_phase", phase: "ASK" },
            { do: "speak_question", questionIndex: event.questionIndex },
          ],
        };
      }
      if (event.t === "NO_QUESTION_AVAILABLE") {
        return {
          state: { ...state, phase: "CLOSING", enteredAt: event.at, endReason: "completed" },
          effects: [{ do: "publish_phase", phase: "CLOSING" }, { do: "speak_closing" }],
        };
      }
      return { state, effects: [] };

    case "CLOSING":
      if (event.t === "CLOSING_SPOKEN") {
        return move(state, event.at, "GRADING", [{ do: "start_grading" }]);
      }
      return { state, effects: [] };

    case "GRADING":
      if (event.t === "GRADED") {
        return end(state, event.at, "COMPLETE", state.endReason ?? "completed");
      }
      if (event.t === "GRADING_FAILED") {
        // The interview still happened. Complete it so the transcript and the
        // deterministic ledger score survive a narrative-pass failure.
        return end(state, event.at, "COMPLETE", state.endReason ?? "completed");
      }
      return { state, effects: [] };

    default:
      return { state, effects: [] };
  }
}

function move(state: MachineState, at: number, phase: Phase, effects: Effect[]): Transition {
  return {
    state: { ...state, phase, enteredAt: at },
    effects: [{ do: "publish_phase", phase }, ...effects],
  };
}

function end(state: MachineState, at: number, phase: Phase, reason: EndReason): Transition {
  return {
    state: { ...state, phase, enteredAt: at, endReason: reason },
    effects: [
      { do: "cancel_silence_ladder" },
      { do: "publish_phase", phase },
      { do: "teardown", reason },
    ],
  };
}
