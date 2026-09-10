"use client";

/**
 * Real LiveKit browser client — replaces the mock session's role for a real
 * interview. Deliberately thin: this file owns ONLY connection lifecycle,
 * mic publish, remote audio playback, and translating the wire protocol
 * (UiEvent / ControlEvent) to and from LiveKit's data channel. It holds no
 * interview logic of its own — no second InterviewRunner, no state machine.
 * Every decision about what phase the interview is in, what to say next, or
 * when to advance lives entirely in the voice-agent's real InterviewRunner;
 * this controller only reflects what that runner publishes.
 *
 * Barge-in, end-of-turn, and interruption are NOT reimplemented here either
 * — AgentSession's turnHandling on the agent side is authoritative. This
 * file's only job during a candidate interruption is passive: keep the
 * agent's audio track subscribed and let LiveKit's own audio pipeline stop
 * playback when the agent stops sending frames.
 */
import {
  ConnectionState, DisconnectReason, Room, RoomEvent,
  Track, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication,
} from "livekit-client";
import {
  decodeUiEvent, encodeControlEvent, CONTROL_TOPIC, UI_TOPIC, type UiEvent,
} from "@ai/core/browser";

export type BrowserConnState = "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";

export interface InterviewRoomEvents {
  onUiEvent(e: UiEvent): void;
  onConnState(state: BrowserConnState, detail?: string): void;
  /** A subscribed remote audio track arrived — attach it to play the agent's voice. */
  onRemoteAudioTrack(track: RemoteTrack): void;
  onRemoteAudioTrackEnded(): void;
  /** Fired once, the first time the agent participant is actually present. */
  onAgentJoined(): void;
}

export interface ConnectResult {
  connectMs: number;
}

/**
 * The exact slice of livekit-client's `Room` this file drives. Narrowing to
 * an interface — rather than depending on the `Room` class directly inside
 * the controller — is what lets deterministic tests inject a fake room
 * instead of opening a real WebSocket/WebRTC connection. A real `Room`
 * satisfies this structurally with no adapter needed.
 */
export interface RoomLike {
  readonly state: ConnectionState;
  readonly remoteParticipants: ReadonlyMap<string, RemoteParticipant>;
  readonly localParticipant: {
    setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
    publishData(data: Uint8Array, options?: { reliable?: boolean; topic?: string }): Promise<void>;
    readonly isMicrophoneEnabled: boolean;
  };
  connect(url: string, token: string, opts?: { autoSubscribe?: boolean }): Promise<void>;
  disconnect(): Promise<void>;
  on(event: RoomEvent.ParticipantConnected, cb: (p: RemoteParticipant) => void): this;
  on(event: RoomEvent.ConnectionStateChanged, cb: (state: ConnectionState) => void): this;
  on(event: RoomEvent.Disconnected, cb: (reason?: DisconnectReason) => void): this;
  on(event: RoomEvent.DataReceived, cb: (payload: Uint8Array, participant?: RemoteParticipant, kind?: unknown, topic?: string) => void): this;
  on(event: RoomEvent.TrackSubscribed, cb: (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => void): this;
  on(event: RoomEvent.TrackUnsubscribed, cb: (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => void): this;
}

/**
 * Maps LiveKit's own `ConnectionState` (from `connectionStateChanged`) onto
 * the browser's 5-state display. Pulled out as a pure function so the
 * mapping is testable without a real Room/WebSocket.
 */
export function mapConnectionState(state: ConnectionState): BrowserConnState | null {
  switch (state) {
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return "reconnecting";
    case ConnectionState.Connected:
      return "connected";
    case ConnectionState.Disconnected:
      return "disconnected";
    case ConnectionState.Connecting:
      return "connecting";
    default:
      return null;
  }
}

/**
 * One controller per interview attempt. Not reused across interviews or
 * across a reconnect that needs a fresh token — callers construct a new
 * instance and call connect() exactly once; a second connect() call on the
 * same instance throws rather than silently producing two connections to
 * the same room, which LiveKit itself would otherwise allow.
 */
export class InterviewRoomController {
  private room: RoomLike | null = null;
  private connectAttempted = false;
  private agentJoinedFired = false;

  constructor(
    private readonly events: InterviewRoomEvents,
    private readonly roomFactory: () => RoomLike = () => new Room(),
  ) {}

  async connect(url: string, token: string): Promise<ConnectResult> {
    if (this.connectAttempted) {
      throw new Error("InterviewRoomController.connect() called more than once on the same instance");
    }
    this.connectAttempted = true;

    const room = this.roomFactory();
    this.room = room;
    this.wireRoomEvents(room);

    const started = performance.now();
    this.events.onConnState("connecting");
    try {
      await room.connect(url, token, { autoSubscribe: true });
    } catch (err) {
      this.events.onConnState("failed", err instanceof Error ? err.message : String(err));
      throw err;
    }
    const connectMs = performance.now() - started;
    this.events.onConnState("connected");

    // Mic permission was already confirmed by the pre-flight screen, so this
    // resolves immediately without a second permission prompt — it publishes
    // the actual track, which getUserMedia alone (used only for the meter)
    // never does.
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (err) {
      // Surfaced distinctly from a connection failure — the room is fine,
      // only the mic publish failed (e.g. device was unplugged between
      // pre-flight and this call).
      throw new MicPublishError(err instanceof Error ? err.message : String(err));
    }

    // If the agent participant is already in the room by the time we finish
    // connecting (a slow browser, a fast agent), TrackSubscribed for its
    // audio may have already fired before our listeners were attached to
    // THIS event in particular — but RoomEvent listeners are registered
    // before room.connect() resolves via wireRoomEvents() above, so no
    // ordering gap exists here. Included for clarity, not as a real race.
    for (const participant of room.remoteParticipants.values()) {
      this.maybeFireAgentJoined(participant);
    }

    return { connectMs };
  }

  /** The one message the candidate can send: end the interview gracefully. */
  sendEndInterview(): void {
    if (!this.room || this.room.state !== ConnectionState.Connected) return;
    // Re-wrapped in `new Uint8Array(...)`: TextEncoder().encode() inside
    // encodeControlEvent types as Uint8Array<ArrayBufferLike> under this
    // project's lib target, but publishData requires the narrower
    // ArrayBuffer-backed form — the copy is free at this payload size.
    void this.room.localParticipant.publishData(
      new Uint8Array(encodeControlEvent({ t: "end_interview" })),
      { reliable: true, topic: CONTROL_TOPIC },
    );
  }

  async disconnect(): Promise<void> {
    await this.room?.disconnect();
  }

  get isMicMuted(): boolean {
    return !(this.room?.localParticipant.isMicrophoneEnabled ?? false);
  }

  setMicMuted(muted: boolean): void {
    void this.room?.localParticipant.setMicrophoneEnabled(!muted);
  }

  private maybeFireAgentJoined(participant: RemoteParticipant): void {
    // The agent's identity is set server-side in agent.ts's Agent config;
    // absent an explicit convention, "not the candidate" is sufficient here
    // since a room has exactly two participants by design.
    if (this.agentJoinedFired) return;
    this.agentJoinedFired = true;
    this.events.onAgentJoined();
  }

  private wireRoomEvents(room: RoomLike): void {
    room.on(RoomEvent.ParticipantConnected, (p) => this.maybeFireAgentJoined(p));

    room.on(RoomEvent.ConnectionStateChanged, (state) => {
      const mapped = mapConnectionState(state);
      if (mapped) this.events.onConnState(mapped);
    });

    room.on(RoomEvent.Disconnected, (reason) => {
      const detail = reason !== undefined ? DisconnectReason[reason] : undefined;
      this.events.onConnState("disconnected", detail);
    });

    room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      if (topic !== UI_TOPIC) return;
      const event = decodeUiEvent(payload);
      if (event) this.events.onUiEvent(event);
    });

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant) => {
      this.maybeFireAgentJoined(participant);
      if (track.kind === Track.Kind.Audio) this.events.onRemoteAudioTrack(track);
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) this.events.onRemoteAudioTrackEnded();
    });
  }
}

export class MicPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MicPublishError";
  }
}
