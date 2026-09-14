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
 * `from` lines up with `ms`: for each timed answer, the note before it in the
 * line, spelt the way the card id spells it ("A4"), or null when there was
 * none — the first note of a line is never timed, so null means a note on its
 * own. `missedFrom` is the same for each wrong answer that would have been
 * timed. Both are missing from a tally recorded before they existed, which
 * means unknown, not null.
 *
 * @typedef {{n: number, correct: number, ms: number[],
 *   from?: (string | null)[], missedFrom?: (string | null)[]}} Tally
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
 * `previous` goes into `from` under exactly the condition the latency goes
 * into `ms`, so the two cannot come apart, and into `missedFrom` under the
 * mirror of it. An untimed answer records neither, wrong or right: counting
 * its misses and not its hits would let an answer count against a distance
 * that could never have counted for it.
 *
 * @param {Session} session
 * @param {{id: string, correct: boolean, latencyMs: number, at: number,
 *   previous?: string | null}} answer
 * @returns {Session}
 */
export function recordAnswer(session, { id, correct, latencyMs, at, previous = null }) {
  const before = session.cards[id] ?? { n: 0, correct: 0, ms: [], from: [], missedFrom: [] };
  const timed = isTimed(latencyMs);
  const tally = {
    n: before.n + 1,
    correct: before.correct + (correct ? 1 : 0),
    ms: correct && timed ? [...before.ms, Math.round(latencyMs)] : before.ms,
    from: correct && timed ? [...(before.from ?? []), previous] : (before.from ?? []),
    missedFrom: !correct && timed ? [...(before.missedFrom ?? []), previous] : (before.missedFrom ?? []),
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
      const running = out.get(id) ?? { n: 0, correct: 0, ms: [], from: [], missedFrom: [] };
      const ms = tally.ms ?? [];
      out.set(id, {
        n: running.n + (Number(tally.n) || 0),
        correct: running.correct + (Number(tally.correct) || 0),
        ms: running.ms.concat(ms),
        // A session whose notes before are missing or do not line up with
        // its times contributes its times and nothing about where they came
        // from: undefined, unknown, so that one damaged session cannot pair
        // the times of every other with the wrong notes.
        from: running.from.concat(aligned(tally) ? tally.from : ms.map(() => undefined)),
        missedFrom: running.missedFrom.concat(aligned(tally) ? (tally.missedFrom ?? []) : []),
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

/** Is this tally's `from` one entry per timing, and so safe to read against it? */
function aligned(tally) {
  return Array.isArray(tally.from) && Array.isArray(tally.ms) && tally.from.length === tally.ms.length;
}

/**
 * How far one note is from another, as the deck would feel it: staff steps on
 * the naming deck, which is how far the eye jumped, and semitones on the
 * playing deck, which is how far the hand moved. Signed, upward positive.
 *
 * Parses the pitches itself rather than through `cardPitch`, which reads a
 * letter and an octave into a staff position and would silently drop an
 * accidental. NaN for anything it cannot read.
 *
 * @param {string} from e.g. "A4"
 * @param {string} to
 * @param {string} deck "typed" or "played"
 * @returns {number}
 */
export function distance(from, to, deck) {
  const a = parsePitch(from);
  const b = parsePitch(to);
  if (!a || !b) return NaN;
  return deck === "played" ? b.midi - a.midi : b.step - a.step;
}

const STEPS = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, H: 6 };
const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, H: 11 };

/** @param {unknown} pitch @returns {{step: number, midi: number} | null} */
function parsePitch(pitch) {
  const m = /^([CDEFGAH])(-?\d+)$/.exec(String(pitch));
  if (!m) return null;
  const octave = Number(m[2]);
  return { step: octave * 7 + STEPS[m[1]], midi: (octave + 1) * 12 + SEMITONES[m[1]] };
}

/**
 * The distances a note's record is split into, by size, each band holding
 * everything up to its bound. Placeholders: where the edges belong is for
 * recordings to say. No band for the same note twice, which a line never
 * asks.
 */
export const BANDS = [
  { key: "near", label: "a step or two", steps: 2, semitones: 4 },
  { key: "mid", label: "up to a fifth", steps: 4, semitones: 7 },
  { key: "wide", label: "wider", steps: Infinity, semitones: Infinity },
];

/**
 * One tally's timed answers and misses, grouped by the note before them.
 * Answers with no note before (null) or an unknown one are left out, and so is
 * the whole of a tally whose notes before do not line up with its times.
 * @param {Tally} tally
 * @returns {Map<string, {ms: number[], missed: number}>}
 */
export function byPrevious(tally) {
  /** @type {Map<string, {ms: number[], missed: number}>} */
  const out = new Map();
  const entry = (pitch) => {
    if (!out.has(pitch)) out.set(pitch, { ms: [], missed: 0 });
    return /** @type {{ms: number[], missed: number}} */ (out.get(pitch));
  };
  if (!aligned(tally)) return out;
  tally.from.forEach((pitch, i) => {
    if (typeof pitch === "string") entry(pitch).ms.push(tally.ms[i]);
  });
  for (const pitch of tally.missedFrom ?? []) {
    if (typeof pitch === "string") entry(pitch).missed += 1;
  }
  return out;
}

/**
 * One note's record split by how far the note before it was: per band, the
 * median latency, how many were timed and missed, and accuracy over the two —
 * both counted from the same answers, those that would have been timed.
 *
 * @param {string} pitch the note answered, e.g. "C5"
 * @param {Tally} tally
 * @param {string} deck
 * @param {typeof BANDS} [bands]
 * @returns {{key: string, label: string, timed: number, missed: number,
 *   accuracy: number, medianMs: number}[]}
 */
export function byBand(pitch, tally, deck, bands = BANDS) {
  const bound = deck === "played" ? "semitones" : "steps";
  const rows = bands.map((b) => ({ key: b.key, label: b.label, ms: /** @type {number[]} */ ([]), missed: 0 }));
  for (const [from, got] of byPrevious(tally)) {
    const size = Math.abs(distance(from, pitch, deck));
    if (!Number.isFinite(size)) continue;
    const row = rows[bands.findIndex((b) => size <= b[bound])];
    if (!row) continue;
    row.ms.push(...got.ms);
    row.missed += got.missed;
  }
  return rows.map(({ ms, missed, ...row }) => ({
    ...row,
    timed: ms.length,
    missed,
    accuracy: ms.length + missed > 0 ? ms.length / (ms.length + missed) : NaN,
    medianMs: median(ms),
  }));
}
