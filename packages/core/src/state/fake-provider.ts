/**
 * Deterministic LlmProvider/LiveSession test double.
 *
 * Conforms exactly to the real interfaces in providers/types.ts — a drop-in
 * for AdaptiveBrain, not a shortcut. Tests script exact tool-call sequences
 * so signal-ledger transitions, probe selection, and degrade paths are all
 * verifiable without a network call or a real model.
 */
import {
  ZERO_USAGE, addUsage,
  type LiveSession, type LiveSessionInit, type LlmProvider,
  type StructuredRequest, type StructuredResult, type TurnEvent, type TurnInput, type Usage,
} from "../providers/types.js";

export interface ScriptedTurn {
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  text?: string;
  error?: { message: string; retryable: boolean };
}

export class FakeLiveSession implements LiveSession {
  readonly turnInputs: TurnInput[] = [];
  readonly settledCalls: Array<Array<{ id: string; content: string }>> = [];
  private index = 0;
  private usage: Usage = ZERO_USAGE;
  disposed = false;

  constructor(
    private readonly script: ScriptedTurn[],
    readonly init: LiveSessionInit,
  ) {}

  async *turn(input: TurnInput): AsyncIterable<TurnEvent> {
    this.turnInputs.push(input);
    const step = this.script[this.index] ?? {};
    this.index += 1;

    if (step.error) {
      yield { type: "error", error: new Error(step.error.message), retryable: step.error.retryable };
      return;
    }
    if (step.text) yield { type: "text", delta: step.text };
    for (const call of step.toolCalls ?? []) yield { type: "tool_call", ...call };

    const usage: Usage = { inputTokens: 20, cachedInputTokens: 10, outputTokens: 8, costCents: 0.02 };
    this.usage = addUsage(this.usage, usage);
    yield { type: "done", usage, stopReason: "end_turn" };
  }

  settleToolCalls(results: Array<{ id: string; content: string }>): void {
    this.settledCalls.push(results);
  }

  totalUsage(): Usage {
    return this.usage;
  }

  dispose(): void {
    this.disposed = true;
  }
}

export class FakeProvider implements LlmProvider {
  readonly id = "fake";
  readonly liveModel = "fake-live";
  readonly batchModel = "fake-batch";
  /** Set after the first openLiveSession() call, for test assertions. */
  session: FakeLiveSession | null = null;
  openSessionCount = 0;

  constructor(private readonly script: ScriptedTurn[]) {}

  openLiveSession(init: LiveSessionInit): LiveSession {
    this.openSessionCount += 1;
    this.session = new FakeLiveSession(this.script, init);
    return this.session;
  }

  async generateStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new Error("FakeProvider.generateStructured is not used by AdaptiveBrain");
  }
}

const FAKE_USAGE: Usage = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, costCents: 0.1 };

/**
 * Deterministic LlmProvider test double for the generateStructured() path —
 * document analysis, plan generation, ClaudeEvaluationBrain. A queue of
 * scripted results, consumed in call order; either a value to return or an
 * error to throw, so both the happy path and a provider failure are
 * testable without a network call.
 */
export class FakeStructuredProvider implements LlmProvider {
  readonly id = "fake-structured";
  readonly liveModel = "fake-live";
  readonly batchModel = "fake-batch";
  readonly calls: StructuredRequest<unknown>[] = [];
  private index = 0;

  constructor(private readonly script: Array<{ value: unknown } | { error: Error }>) {}

  openLiveSession(): LiveSession {
    throw new Error("FakeStructuredProvider.openLiveSession is not used by the document pipeline");
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    const step = this.script[this.index];
    this.index += 1;
    if (!step) throw new Error(`FakeStructuredProvider: no scripted result for call ${this.index}`);
    if ("error" in step) throw step.error;
    // Trust the test to have supplied a value the caller's schema accepts —
    // real generateStructured() implementations validate via the schema;
    // this fake mirrors what a passing call returns, not the validation
    // itself (tests that need a schema-rejection path throw here instead).
    return { value: step.value as T, usage: FAKE_USAGE };
  }
}
