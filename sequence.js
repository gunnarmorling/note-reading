// Lines of notes: which the scheduler asks for, and in what order they are
// written. Pure functions over plain data, like scheduler.js, which this sits
// on top of rather than inside — the weights say how badly each note needs
// practice, and nothing here second-guesses them.
//
// Musical coherence pulls against measurement. A stepwise diatonic line is
// guessable: the reader infers the next note instead of reading it, and the
// drill quietly measures pattern completion. Demanding musical sense of the
// choice itself would take that choice away from the scheduler. So the
// scheduler chooses the notes and only their order is constrained. The line
// stops sounding like noise without the next note becoming inferable.
//
// No harmonic model: for a single line, sounding well is almost entirely
// interval distribution and contour. Three rules do most of it — mostly steps
// and thirds, never two leaps in the same direction, the whole line inside a
// tenth — and they are a sort over notes already chosen, not a theory engine.

import { pick } from "./scheduler.js";
import { cardPitch } from "./notes.js";

/** Line lengths the drill offers. One is a single note, exactly as before. */
export const SEQUENCE_LENGTHS = [1, 2, 3, 4];

/**
 * Three by default: two trains the interval, four starts training the eyes to
 * run ahead of the hands, and three has a little of both.
 */
export const DEFAULT_SEQUENCE = 3;

/**
 * The widest a line may be, in diatonic steps: a tenth. Comfortable to read
 * at a glance, and wide enough that the scheduler still has something to
 * choose from at the edges of the range.
 */
export const SEQUENCE_SPAN = 9;

/** An interval of this many steps or more is a leap: a fourth and up. */
export const LEAP = 3;

/**
 * How much each interval size is worth to an ordering, in diatonic steps.
 * Steps and thirds are what a line is mostly made of; a fourth is a leap
 * worth hearing now and then; anything wider is the occasional one.
 * @param {number} steps absolute size of the interval
 * @returns {number}
 */
export function intervalWeight(steps) {
  if (steps <= 2) return 3;
  if (steps === LEAP) return 1;
  return 0.5;
}

/**
 * How likely this order is to be written, relative to the others over the
 * same notes. Zero where it breaks a rule: two leaps in a row in the same
 * direction, which is the one shape that stops a line reading as a line.
 *
 * A straight run of steps is marked down too. It is the most singable shape
 * there is and also the most guessable — after C D, E is not being read — so
 * it is allowed, and made rare.
 *
 * @param {number[]} dns in the order they would be written
 * @returns {number}
 */
export function contourWeight(dns) {
  let w = 1;
  for (let i = 1; i < dns.length; i++) {
    const move = dns[i] - dns[i - 1];
    w *= intervalWeight(Math.abs(move));
    if (i >= 2) {
      const before = dns[i - 1] - dns[i - 2];
      const leaps = Math.abs(move) >= LEAP && Math.abs(before) >= LEAP;
      if (leaps && Math.sign(move) === Math.sign(before)) return 0;
    }
  }
  const moves = dns.slice(1).map((dn, i) => dn - dns[i]);
  const run =
    moves.length >= 2 &&
    moves.every((m) => Math.abs(m) === 1) &&
    moves.every((m) => Math.sign(m) === Math.sign(moves[0]));
  return run ? w / 3 : w;
}

/**
 * Every order of a handful of notes. At four notes that is 24, which is why
 * this can simply enumerate them.
 * @template T
 * @param {T[]} xs
 * @returns {T[][]}
 */
export function permutations(xs) {
  if (xs.length <= 1) return [xs.slice()];
  const out = [];
  xs.forEach((x, i) => {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}

/**
 * Put chosen notes in an order worth reading. Drawn at random in proportion
 * to each order's contour weight rather than taking the best one, so the
 * same notes do not always come out the same way — which would be one more
 * thing to recognise instead of read.
 *
 * @param {number[]} dns
 * @param {() => number} [rand]
 * @returns {number[]}
 */
export function arrange(dns, rand = Math.random) {
  const orders = permutations(dns);
  const weights = orders.map(contourWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  // Nothing passes: keep the scheduler's order rather than inventing notes.
  if (!(total > 0)) return dns.slice();
  let r = rand() * total;
  for (let i = 0; i < orders.length; i++) {
    r -= weights[i];
    if (r <= 0) return orders[i];
  }
  return orders[orders.length - 1];
}

/**
 * The notes for one line, as card ids in the order they are to be read.
 *
 * Each is chosen by the scheduler's own weighted draw, from what is left
 * inside a tenth of the notes already chosen. Distinct, because a note
 * repeated inside a line is primed the second time — the reason the
 * scheduler never asks one twice in a row — and a line of a single pitch is
 * no line. So a range holding fewer notes than the setting asks for gets a
 * shorter line rather than a repeat.
 *
 * @param {Map<string, import("./scheduler.js").Card>} cards
 * @param {string[]} ids eligible this trial
 * @param {number} trial
 * @param {number} length
 * @param {() => number} [rand]
 * @returns {string[]}
 */
export function chooseLine(cards, ids, trial, length, rand = Math.random) {
  /** @type {string[]} */
  const chosen = [];
  let lo = Infinity;
  let hi = -Infinity;
  while (chosen.length < length) {
    const left = ids.filter((id) => {
      if (chosen.includes(id)) return false;
      const dn = cardPitch(id);
      return Math.max(hi, dn) - Math.min(lo, dn) <= SEQUENCE_SPAN;
    });
    if (left.length === 0) break;
    const id = pick(cards, left, trial, rand);
    const dn = cardPitch(id);
    lo = Math.min(lo, dn);
    hi = Math.max(hi, dn);
    chosen.push(id);
  }
  const byPitch = new Map(chosen.map((id) => [cardPitch(id), id]));
  return arrange([...byPitch.keys()], rand).map((dn) => /** @type {string} */ (byPitch.get(dn)));
}
