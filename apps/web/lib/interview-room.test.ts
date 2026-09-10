import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ConnectionState, RoomEvent, type DisconnectReason, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from "livekit-client";
import { decodeControlEvent, encodeUiEvent } from "@ai/core/browser";
import { InterviewRoomController, MicPublishError, mapConnectionState, type RoomLike } from "./interview-room.js";

/**
 * A fake Room that satisfies RoomLike without opening a real WebSocket. Lets
 * these tests exercise InterviewRoomController's wiring deterministically —
 * no network, no real LiveKit project needed.
 */
class FakeRoom extends EventEmitter implements RoomLike {
  state: ConnectionState = ConnectionState.Disconnected;
  remoteParticipants = new Map<string, RemoteParticipant>();
  connectError: Error | null = null;
  disconnectCalls = 0;

  localParticipant = {
    micEnabled: false,
    failMic: false,
    published: [] as { data: Uint8Array; options: { reliable?: boolean; topic?: string } | undefined }[],
    async setMicrophoneEnabled(enabled: boolean): Promise<unknown> {
      if (this.failMic) throw new Error("device unplugged");
      this.micEnabled = enabled;
      return undefined;
    },
    async publishData(data: Uint8Array, options?: { reliable?: boolean; topic?: string }): Promise<void> {
      this.published.push({ data, options });
    },
    get isMicrophoneEnabled(): boolean {
      return this.micEnabled;
    },
  };

  async connect(): Promise<void> {
    if (this.connectError) throw this.connectError;
    this.state = ConnectionState.Connected;
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls++;
    this.state = ConnectionState.Disconnected;
  }
}

function fakeParticipant(identity: string): RemoteParticipant {
  return { identity } as RemoteParticipant;
}

function fakeAudioTrack(): RemoteTrack {
  return { kind: "audio" } as RemoteTrack;
}

function fakeVideoTrack(): RemoteTrack {
  return { kind: "video" } as RemoteTrack;
}

test("mapConnectionState maps every LiveKit connection state to the browser's 5-state display", () => {
  assert.equal(mapConnectionState(ConnectionState.Connecting), "connecting");
  assert.equal(mapConnectionState(ConnectionState.Connected), "connected");
  assert.equal(mapConnectionState(ConnectionState.Reconnecting), "reconnecting");
  assert.equal(mapConnectionState(ConnectionState.SignalReconnecting), "reconnecting");
  assert.equal(mapConnectionState(ConnectionState.Disconnected), "disconnected");
});

test("connect() rejects a second call on the same controller instance (duplicate connection prevention)", async () => {
  const room = new FakeRoom();
  const events = noopEvents();
  const controller = new InterviewRoomController(events, () => room);

  await controller.connect("wss://example", "token-a");
  await assert.rejects(
    () => controller.connect("wss://example", "token-b"),
    /more than once/,
  );
});

test("connect() reports connecting then connected, and publishes the mic", async () => {
  const room = new FakeRoom();
  const states: string[] = [];
  const events = noopEvents({ onConnState: (s) => states.push(s) });
  const controller = new InterviewRoomController(events, () => room);

  const result = await controller.connect("wss://example", "token");

  assert.deepEqual(states, ["connecting", "connected"]);
  assert.equal(room.localParticipant.micEnabled, true);
  assert.equal(typeof result.connectMs, "number");
});

test("connect() surfaces a room.connect() failure as onConnState('failed') and rethrows", async () => {
  const room = new FakeRoom();
  room.connectError = new Error("server unreachable");
  const states: Array<{ s: string; detail: string | undefined }> = [];
  const events = noopEvents({ onConnState: (s, detail) => states.push({ s, detail }) });
  const controller = new InterviewRoomController(events, () => room);

  await assert.rejects(() => controller.connect("wss://example", "token"), /server unreachable/);
  assert.deepEqual(states, [{ s: "connecting", detail: undefined }, { s: "failed", detail: "server unreachable" }]);
});

test("connect() surfaces a mic publish failure as MicPublishError, distinct from a connection failure", async () => {
  const room = new FakeRoom();
  room.localParticipant.failMic = true;
  const events = noopEvents();
  const controller = new InterviewRoomController(events, () => room);

  await assert.rejects(() => controller.connect("wss://example", "token"), (err: unknown) => {
    assert.ok(err instanceof MicPublishError);
    return true;
  });
});

test("ConnectionStateChanged and Disconnected events forward through onConnState", async () => {
  const room = new FakeRoom();
  const states: Array<{ s: string; detail: string | undefined }> = [];
  const events = noopEvents({ onConnState: (s, detail) => states.push({ s, detail }) });
  const controller = new InterviewRoomController(events, () => room);
  await controller.connect("wss://example", "token");
  states.length = 0;

  room.emit(RoomEvent.ConnectionStateChanged, ConnectionState.Reconnecting);
  room.emit(RoomEvent.Disconnected, 1 as DisconnectReason);

  assert.equal(states[0]?.s, "reconnecting");
  assert.equal(states[1]?.s, "disconnected");
  assert.equal(states[1]?.detail, "CLIENT_INITIATED");
});

test("DataReceived on the UI topic decodes and dispatches; other topics are ignored", async () => {
  const room = new FakeRoom();
  const received: unknown[] = [];
  const events = noopEvents({ onUiEvent: (e) => received.push(e) });
  const controller = new InterviewRoomController(events, () => room);
  await controller.connect("wss://example", "token");

  const payload = encodeUiEvent({ t: "ui_state", state: "ai_speaking", at: 123 });
  room.emit(RoomEvent.DataReceived, payload, undefined, undefined, "interview-ui");
  room.emit(RoomEvent.DataReceived, payload, undefined, undefined, "some-other-topic");

  assert.deepEqual(received, [{ t: "ui_state", state: "ai_speaking", at: 123 }]);
});

test("TrackSubscribed/Unsubscribed only fire audio callbacks for audio tracks, and fire agent-joined once", async () => {
  const room = new FakeRoom();
  let agentJoinedCount = 0;
  const audioTracks: RemoteTrack[] = [];
  let audioEnded = 0;
  const events = noopEvents({
    onAgentJoined: () => agentJoinedCount++,
    onRemoteAudioTrack: (t) => audioTracks.push(t),
    onRemoteAudioTrackEnded: () => audioEnded++,
  });
  const controller = new InterviewRoomController(events, () => room);
  await controller.connect("wss://example", "token");

  const agent = fakeParticipant("agent-1");
  room.emit(RoomEvent.ParticipantConnected, agent);
  room.emit(RoomEvent.TrackSubscribed, fakeVideoTrack(), {}, agent);
  room.emit(RoomEvent.TrackSubscribed, fakeAudioTrack(), {}, agent);
  room.emit(RoomEvent.TrackUnsubscribed, fakeAudioTrack(), {}, agent);

  assert.equal(agentJoinedCount, 1, "agent-joined should fire exactly once across ParticipantConnected + TrackSubscribed");
  assert.equal(audioTracks.length, 1, "only the audio track should trigger onRemoteAudioTrack");
  assert.equal(audioEnded, 1);
});

test("sendEndInterview is a no-op when not connected, and publishes a decodable control message when connected", async () => {
  const room = new FakeRoom();
  const events = noopEvents();
  const controller = new InterviewRoomController(events, () => room);

  controller.sendEndInterview();
  assert.equal(room.localParticipant.published.length, 0, "must not publish before connect()");

  await controller.connect("wss://example", "token");
  controller.sendEndInterview();

  assert.equal(room.localParticipant.published.length, 1);
  const published = room.localParticipant.published[0];
  assert.ok(published);
  assert.equal(published.options?.topic, "interview-control");
  assert.equal(published.options?.reliable, true);
  assert.deepEqual(decodeControlEvent(published.data), { t: "end_interview" });
});

test("disconnect() and end-interview cleanup delegate to the underlying room exactly once", async () => {
  const room = new FakeRoom();
  const events = noopEvents();
  const controller = new InterviewRoomController(events, () => room);
  await controller.connect("wss://example", "token");

  await controller.disconnect();

  assert.equal(room.disconnectCalls, 1);
});

function noopEvents(overrides: Partial<{
  onUiEvent: (e: unknown) => void;
  onConnState: (s: string, detail?: string) => void;
  onRemoteAudioTrack: (t: RemoteTrack) => void;
  onRemoteAudioTrackEnded: () => void;
  onAgentJoined: () => void;
}> = {}) {
  return {
    onUiEvent: overrides.onUiEvent ?? (() => {}),
    onConnState: overrides.onConnState ?? (() => {}),
    onRemoteAudioTrack: overrides.onRemoteAudioTrack ?? (() => {}),
    onRemoteAudioTrackEnded: overrides.onRemoteAudioTrackEnded ?? (() => {}),
    onAgentJoined: overrides.onAgentJoined ?? (() => {}),
  } as ConstructorParameters<typeof InterviewRoomController>[0];
}
