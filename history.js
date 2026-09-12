// What was actually answered, when. Kept apart from the scheduler's own view
// of each note, which is a decaying average built to decide what to ask next
// and is no use as a record: it forgets on purpose, and it forgets faster the
// better you get. This is the opposite — nothing here is ever revised.
//
// Everything in this file is a pure function over plain data, so the windows
// and the arithmetic can be tested without a browser.

import { isTimed, median } from "./scheduler.js";

/**
 * Silence for this long ends a session.
 *
 * Half an hour, which is long enough that reloading the page, fixing a
 * setting or going to answer the door all leave you in the same session, and
 * short enough that tomorrow morning is a new one. Boundaries by page load
 * would have been simpler and would have chopped a practice into fragments
 * every time the tab was refreshed.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/**
 * @typedef {{n: number, correct: number, ms: number[]}} Tally
 * @typedef {{started: number, lastAt: number, cards: Record<string, Tally>}} Session
 */

/**
 * Does an answer now belong to the session last answered at `lastAt`?
 * @param {number} lastAt
 * @param {number} now
 * @returns {boolean}
 */
export function continuesSession(lastAt, now) {
  return Number.isFinite(lastAt) && now - lastAt <= SESSION_GAP_MS && now >= lastAt;
}

/** @param {number} now @returns {Session} */
export function newSession(now) {
  return { started: now, lastAt: now, cards: {} };
}

/**
 * Fold one answer into a session. Returns a new session; does not mutate.
 *
 * `n` counts trials, `correct` the ones answered right, and `ms` holds only
 * the latencies worth keeping — the same rule the scheduler uses, so a wrong
 * answer, a trip to the kitchen and the first note of a sitting all count as
 * answers without counting as times.
 *
 * @param {Session} session
 * @param {{id: string, correct: boolean, latencyMs: number, at: number}} answer
 * @returns {Session}
 */
export function recordAnswer(session, { id, correct, latencyMs, at }) {
  const before = session.cards[id] ?? { n: 0, correct: 0, ms: [] };
  const tally = {
    n: before.n + 1,
    correct: before.correct + (correct ? 1 : 0),
    ms: correct && isTimed(latencyMs) ? [...before.ms, Math.round(latencyMs)] : before.ms,
  };
  return {
    started: session.started,
    lastAt: at,
    cards: { ...session.cards, [id]: tally },
  };
}

const DAY_MS = 86_400_000;

/**
 * The windows the history can be read over.
 *
 * Today, then rolling weeks and months — rather than calendar ones, which on
 * a Monday morning would show an empty week after a weekend of practice. The
 * labels say days for that reason. A sitting is not among them: practice here
 * comes in short bursts several times a day, so the burst is too small a unit
 * to mean anything and the day is the one worth counting.
 */
export const WINDOWS = [
  { key: "today", label: "Today", compare: "yesterday" },
  { key: "week", label: "Last 7 days", days: 7, compare: "the 7 days before" },
  { key: "month", label: "Last 30 days", days: 30, compare: "the 30 days before" },
  { key: "all", label: "All time" },
];

/** Local midnight of the day containing `now`. */
export function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The span of time a window covers.
 * @param {string} windowKey
 * @param {number} now
 * @returns {{from: number, to: number}}
 */
export function windowRange(windowKey, now) {
  if (windowKey === "today") return { from: startOfDay(now), to: Infinity };
  const days = WINDOWS.find((w) => w.key === windowKey)?.days;
  return days ? { from: now - days * DAY_MS, to: Infinity } : { from: -Infinity, to: Infinity };
}

/**
 * The span immediately before a window, of the same length — what "faster
 * than last week" is measured against. Null for all time, which has nothing
 * before it.
 * @param {string} windowKey
 * @param {number} now
 * @returns {{from: number, to: number} | null}
 */
export function previousRange(windowKey, now) {
  if (windowKey === "today") {
    const midnight = startOfDay(now);
    return { from: midnight - DAY_MS, to: midnight };
  }
  const days = WINDOWS.find((w) => w.key === windowKey)?.days;
  return days ? { from: now - 2 * days * DAY_MS, to: now - days * DAY_MS } : null;
}

/**
 * @param {Session[]} sessions oldest first
 * @param {{from: number, to: number} | null} range
 * @returns {Session[]}
 */
export function sessionsBetween(sessions, range) {
  if (!range) return [];
  return sessions.filter((s) => s.started >= range.from && s.started < range.to);
}

/**
 * @param {Session[]} sessions oldest first
 * @param {string} windowKey
 * @param {number} now
 * @returns {Session[]}
 */
export function sessionsIn(sessions, windowKey, now) {
  return sessionsBetween(sessions, windowRange(windowKey, now));
}

/**
 * Add up what each card did across these sessions.
 * @param {Session[]} sessions
 * @returns {Map<string, Tally>}
 */
export function totalsByCard(sessions) {
  /** @type {Map<string, Tally>} */
  const out = new Map();
  for (const session of sessions) {
    for (const [id, tally] of Object.entries(session.cards ?? {})) {
      const running = out.get(id) ?? { n: 0, correct: 0, ms: [] };
      out.set(id, {
        n: running.n + (Number(tally.n) || 0),
        correct: running.correct + (Number(tally.correct) || 0),
        ms: running.ms.concat(tally.ms ?? []),
      });
    }
  }
  return out;
}

/**
 * One card's record, reduced to what the panel shows. The median is of the
 * answers themselves rather than of anything averaged, which is the reason
 * for keeping every latency instead of a running mean.
 * @param {Tally} tally
 * @returns {{n: number, correct: number, accuracy: number, medianMs: number}}
 */
export function summarise(tally) {
  return {
    n: tally.n,
    correct: tally.correct,
    accuracy: tally.n > 0 ? tally.correct / tally.n : NaN,
    medianMs: median(tally.ms),
  };
}

/**
 * Totals across every card in a window: trials, accuracy, and the median of
 * all of them pooled.
 * @param {Map<string, Tally>} totals
 * @returns {{n: number, correct: number, accuracy: number, medianMs: number, cards: number}}
 */
export function overall(totals) {
  let n = 0;
  let correct = 0;
  /** @type {number[]} */
  let ms = [];
  for (const tally of totals.values()) {
    n += tally.n;
    correct += tally.correct;
    ms = ms.concat(tally.ms);
  }
  return {
    n,
    correct,
    accuracy: n > 0 ? correct / n : NaN,
    medianMs: median(ms),
    cards: totals.size,
  };
}
