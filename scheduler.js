// Scheduling. Everything here is a pure function over plain data, which is
// what makes it testable without a DOM.
//
// This is deliberately not SM-2 or FSRS. Those model day-scale forgetting of
// discrete facts and schedule in intervals of days. What we want is a
// sub-second recognition reflex over ~20 items, most of them seen several
// times a minute. So: weighted interleaving within a session, and a decay
// term between sessions to cover the forgetting that SRS proper is about.

/** Response time we're aiming for. Weights are relative to this. */
export const TARGET_MS = 1000;

/** Assumed response time for a note never seen before. */
export const PRIOR_MS = 2500;

/** EWMA smoothing. Higher reacts faster and is noisier. */
export const ALPHA = 0.3;

/** Minimum weight for an under-sampled note, so new notes get explored. */
export const EXPLORE_FLOOR = 4;

/** Trials over which a just-seen note becomes eligible again. */
export const RECENCY_TAU = 3;

/**
 * Trials after which a note that has not come up is weighted twice — and, the
 * term being quadratic, five times at twice that and ten at three times.
 *
 * The latency weighting is squared, which is the point of it, but it means a
 * note you know well can fall to a couple of percent of the draw and then sit
 * out a whole sitting: middle C at 600ms against notes averaging 1.4s is
 * under 2% of the weight, so a hundred notes will skip it altogether about
 * one time in seven. Measured over 30,000 trials, the median gap between two
 * middle Cs was 29 trials and the worst was 248.
 *
 * So the same gap the recency factor reads from one end is read from the
 * other: recency suppresses what was just asked, starvation lifts what has
 * been waiting. Growth is deliberately unbounded, because a bounded boost
 * cannot overcome a tenfold deficit — and it needs no bound, since being
 * asked resets it. At this setting the worst gap comes down to 131 and the
 * 95th percentile to 80, while the slowest note is still asked five times as
 * often as the fastest, which is the ordering worth keeping.
 */
export const STARVE_TAU = 60;

/**
 * How much a note you get wrong is worth on top of its latency. A note missed
 * every single time is worth 1 + ERROR_WEIGHT of one the same speed you never
 * miss; one miss on a previously clean note is worth 1 + ALPHA * ERROR_WEIGHT,
 * so at these settings a single miss nearly triples it.
 *
 * This is the knob for how hard errors count, and deliberately the only one:
 * pushing the latency average around on a wrong answer would work too, but
 * that average is also what the session median and the breakdown bars report,
 * and those should keep saying how fast you actually answer.
 */
export const ERROR_WEIGHT = 6;

/** Below this, an answer is a key bouncing rather than a reading. Clamped up. */
export const MIN_LATENCY_MS = 120;

/**
 * Above this, nothing was being measured but your absence.
 *
 * Thrown away rather than clamped, which is what used to happen at eight
 * seconds — and clamping was worse than useless. One trip to the kitchen on a
 * note you answer in 700ms pulled its average to 2.9s, and since the weight
 * goes as the square, made it seventeen times more likely to be asked. The
 * answer itself still counts: you got it right or you didn't, whatever you
 * were doing in between. Only the clock is meaningless.
 */
export const IGNORE_ABOVE_MS = 10_000;

/**
 * Was this a measurement of reading, or of something else?
 * @param {number} latencyMs
 * @returns {boolean}
 */
export function isTimed(latencyMs) {
  return Number.isFinite(latencyMs) && latencyMs <= IGNORE_ABOVE_MS;
}

/**
 * `seen` counts trials, `missed` the ones answered wrongly, and `timed` the
 * ones that produced a usable latency — which is neither of the others, since
 * an answer can be right and still not be a measurement.
 * @typedef {{ewma: number, errorRate: number, seen: number, missed: number,
 *   timed: number, lastTrial: number}} Card
 */

/** @returns {Card} */
export function newCard() {
  return { ewma: PRIOR_MS, errorRate: 0, seen: 0, missed: 0, timed: 0, lastTrial: -Infinity };
}

/**
 * Share of trials answered right first time, or NaN before there are any.
 *
 * Kept as plain counts alongside `errorRate`, which is not the same quantity
 * and would make a dishonest percentage: that one is an exponential average,
 * so a note you used to miss and now get right reads as almost perfect within
 * a few trials. Good for deciding what to ask next, misleading as a score.
 *
 * @param {Card} card
 * @returns {number}
 */
export function accuracy(card) {
  return card.seen > 0 ? (card.seen - (card.missed ?? 0)) / card.seen : NaN;
}

/** @param {number} ms */
export function clampLatency(ms) {
  return Math.max(MIN_LATENCY_MS, ms);
}

/**
 * How badly this note needs practice right now.
 *
 * The ratio is squared because a linear weight barely separates a 700ms note
 * from a 1400ms one, and that separation is the entire point.
 *
 * On top of that, getting a note wrong is its own signal, independent of how
 * long it took — see ERROR_WEIGHT.
 *
 * The recency factor is 0 for a note just shown and approaches 1 over a few
 * trials. It stops immediate repeats, which matters for measurement as much
 * as for teaching: a note shown twice in a row is primed, so its second
 * latency isn't telling you what you think it is.
 *
 * The starvation factor is the same gap read from the other end — see
 * STARVE_TAU. A note never asked at all is not starving but new, and the
 * explore floor already has it covered, so an infinite gap contributes
 * nothing here.
 *
 * @param {Card} card
 * @param {number} trial current trial index
 * @returns {number}
 */
export function weight(card, trial) {
  const ratio = card.ewma / TARGET_MS;
  let w = ratio * ratio * (1 + ERROR_WEIGHT * card.errorRate);
  if (card.seen < 3) w = Math.max(w, EXPLORE_FLOOR);
  const gap = trial - card.lastTrial;
  const waited = Number.isFinite(gap) ? gap / STARVE_TAU : 0;
  return w * (1 - Math.exp(-gap / RECENCY_TAU)) * (1 + waited * waited);
}

/**
 * Weighted random choice over card ids.
 * @param {Map<string, Card>} cards
 * @param {string[]} ids ids eligible this session
 * @param {number} trial
 * @param {() => number} rand injectable for tests
 * @returns {string}
 */
export function pick(cards, ids, trial, rand = Math.random) {
  if (ids.length === 0) throw new Error("pick called with no candidates");
  const weights = ids.map((id) => weight(cards.get(id) ?? newCard(), trial));
  const total = weights.reduce((a, b) => a + b, 0);
  // Degenerate case: first trial of a one-note range, or all weights zero.
  if (!(total > 0)) return ids[Math.floor(rand() * ids.length)];

  let r = rand() * total;
  for (let i = 0; i < ids.length; i++) {
    r -= weights[i];
    if (r <= 0) return ids[i];
  }
  return ids[ids.length - 1];
}

/**
 * Fold one answer into a card. Returns a new card; does not mutate.
 *
 * A wrong answer moves the error rate but not the latency average: the time
 * taken to produce a wrong answer says nothing useful about how fast you can
 * produce a right one. Nor does a right one that took longer than
 * IGNORE_ABOVE_MS, or one the caller declines to time at all by passing no
 * finite latency — the first answer of a sitting, where the clock is really
 * measuring you finding the keys.
 *
 * @param {Card} card
 * @param {{correct: boolean, latencyMs: number, trial: number}} answer
 * @returns {Card}
 */
export function record(card, { correct, latencyMs, trial }) {
  const measured = correct && isTimed(latencyMs);
  const next = {
    ewma: card.ewma,
    errorRate: card.errorRate + ALPHA * ((correct ? 0 : 1) - card.errorRate),
    seen: card.seen + 1,
    // ?? 0 because cards stored before these were counted have no such field.
    missed: (card.missed ?? 0) + (correct ? 0 : 1),
    timed: (card.timed ?? 0) + (measured ? 1 : 0),
    lastTrial: trial,
  };
  if (measured) {
    const l = clampLatency(latencyMs);
    // The first measurement replaces the prior outright rather than blending
    // with it, so one good answer doesn't leave the note looking hard. Keyed
    // off timed answers, not trials: a note whose first trial went untimed
    // would otherwise spend the next few looking twice as slow as it is.
    next.ewma = (card.timed ?? 0) === 0 ? l : card.ewma + ALPHA * (l - card.ewma);
  }
  return next;
}

/** Fraction of the gap to the prior that is forgotten per day. */
export const DECAY_PER_DAY = 0.08;

/**
 * Pull a card back toward the prior to account for time away. This is the
 * spaced-repetition part: without it a note you once got fast and have since
 * forgotten would never come up again.
 * @param {Card} card
 * @param {number} days
 * @returns {Card}
 */
export function decay(card, days) {
  if (!(days > 0)) return card;
  const lost = 1 - Math.pow(1 - DECAY_PER_DAY, days);
  return { ...card, ewma: card.ewma + (PRIOR_MS - card.ewma) * lost };
}

/** @param {number[]} xs @returns {number} */
export function median(xs) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
