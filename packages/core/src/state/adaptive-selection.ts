/**
 * Question selection policy: coverage, difficulty adaptation, prerequisites,
 * seen-question avoidance, time budget. Pure functions over plain data —
 * generic in the question shape so tests can exercise the policy with
 * synthetic multi-difficulty pools without any real content or provider.
 *
 * Real M1 content is single-band (intermediate only), so difficulty
 * adaptation has nothing to switch INTO at runtime today — the mechanism
 * here is fully general and tested against synthetic pools; it activates
 * for real the day a second difficulty band is authored.
 */
import type { Difficulty } from "../schema/plan.js";

export interface SelectableQuestion {
  id: string;
  topicId: string;
  difficultyBand: Difficulty;
  hardTimeS: number;
}

export interface TopicPrereqInfo {
  id: string;
  prereqs: string[];
}

export interface SelectionState {
  /** Asked this session — always excluded. */
  askedIds: ReadonlySet<string>;
  /** Asked in a PRIOR session by this candidate — excluded unless nothing else is left. */
  seenIds: ReadonlySet<string>;
  /** Topics touched this session, for coverage-diversity scoring. */
  coveredTopics: ReadonlySet<string>;
  difficultyPointer: Difficulty;
  /** Most recent last. Only closed-question ratios, not every evaluate() call. */
  recentRatios: readonly number[];
}

export function initialSelectionState(startingDifficulty: Difficulty): SelectionState {
  return {
    askedIds: new Set(),
    seenIds: new Set(),
    coveredTopics: new Set(),
    difficultyPointer: startingDifficulty,
    recentRatios: [],
  };
}

const DIFFICULTY_ORDER: readonly Difficulty[] = ["beginner", "intermediate", "advanced"];
const STEP_UP_THRESHOLD = 0.8;
const STEP_DOWN_THRESHOLD = 0.35;
const RECENT_WINDOW = 2;

/** Steps at most one band per call, based on the mean of the last two closed ratios. */
export function adaptDifficulty(pointer: Difficulty, recentRatios: readonly number[]): Difficulty {
  const window = recentRatios.slice(-RECENT_WINDOW);
  if (window.length < RECENT_WINDOW) return pointer;
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  const idx = DIFFICULTY_ORDER.indexOf(pointer);
  if (mean >= STEP_UP_THRESHOLD) return DIFFICULTY_ORDER[Math.min(idx + 1, DIFFICULTY_ORDER.length - 1)]!;
  if (mean <= STEP_DOWN_THRESHOLD) return DIFFICULTY_ORDER[Math.max(idx - 1, 0)]!;
  return pointer;
}

/**
 * Called once a question closes. Pure — returns the updated state. Coverage
 * is recorded on close (not on ask) so a question abandoned to a disconnect
 * mid-answer doesn't falsely mark its topic "covered".
 */
export function recordQuestionOutcome(
  state: SelectionState,
  topicId: string,
  questionRatio: number,
): SelectionState {
  const recentRatios = [...state.recentRatios, questionRatio];
  return {
    ...state,
    coveredTopics: new Set([...state.coveredTopics, topicId]),
    recentRatios,
    difficultyPointer: adaptDifficulty(state.difficultyPointer, recentRatios),
  };
}

function difficultyMatch(band: Difficulty, pointer: Difficulty): number {
  const d = Math.abs(DIFFICULTY_ORDER.indexOf(band) - DIFFICULTY_ORDER.indexOf(pointer));
  if (d === 0) return 1;
  if (d === 1) return 0.5;
  return 0.1;
}

const WEIGHTS = { coverage: 0.5, difficulty: 0.35, seenPenalty: 0.4 };

function scoreQuestion<Q extends SelectableQuestion>(q: Q, state: SelectionState): number {
  const uncovered = state.coveredTopics.has(q.topicId) ? 0 : 1;
  const seenPenalty = state.seenIds.has(q.id) ? 1 : 0;
  return (
    WEIGHTS.coverage * uncovered +
    WEIGHTS.difficulty * difficultyMatch(q.difficultyBand, state.difficultyPointer) -
    WEIGHTS.seenPenalty * seenPenalty
  );
}

/**
 * Filters to eligible candidates. Two hard constraints, one soft fallback:
 *   1. asked this session   -> never relaxed; asking the same question twice
 *                              in one interview would be a real bug
 *   2. prerequisite unmet   -> never relaxed; the M1 content generator's own
 *                              validator enforces "never place a topic before
 *                              its prerequisite" at authoring time, so honouring
 *                              it at selection time is the same guarantee, not
 *                              a separate policy. If everything left is
 *                              prereq-locked, the correct outcome is null from
 *                              pickNextQuestion — the interview moves to
 *                              closing rather than violating ordering.
 *   3. seen in prior session -> SOFT: relaxed if excluding seen questions
 *                              would empty the set, since repeating old
 *                              content is far less harmful than ending early.
 *   4. does not fit the clock -> never relaxed; a genuine hard constraint.
 */
export function eligibleQuestions<Q extends SelectableQuestion>(
  pool: readonly Q[],
  topics: readonly TopicPrereqInfo[],
  state: SelectionState,
  timeLeftS: number,
): Q[] {
  const topicById = new Map(topics.map((t) => [t.id, t]));
  const fitsClock = pool.filter((q) => q.hardTimeS <= timeLeftS);
  const notAskedThisSession = fitsClock.filter((q) => !state.askedIds.has(q.id));

  const prereqSatisfied = (q: Q) =>
    (topicById.get(q.topicId)?.prereqs ?? []).every((p) => state.coveredTopics.has(p));
  const prereqPool = notAskedThisSession.filter(prereqSatisfied);

  const unseen = prereqPool.filter((q) => !state.seenIds.has(q.id));
  return unseen.length > 0 ? unseen : prereqPool;
}

export function pickNextQuestion<Q extends SelectableQuestion>(
  pool: readonly Q[],
  topics: readonly TopicPrereqInfo[],
  state: SelectionState,
  timeLeftS: number,
): Q | null {
  const eligible = eligibleQuestions(pool, topics, state, timeLeftS);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, q) =>
    scoreQuestion(q, state) > scoreQuestion(best, state) ? q : best,
  );
}
