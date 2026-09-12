// Drawing: the staff, and a keyboard for finding the notes on the instrument.
// Pure SVG, no font files.
//
// Glyph outlines below were extracted from Bravura (Steinberg, SIL OFL 1.1)
// with fontTools and pre-scaled so that one staff space = 10 user units,
// y increasing downwards. Each glyph's origin sits on the staff line it
// refers to (G clef -> G4, F clef -> F3) or on the note's own line/space.
// They are static shapes and never need regenerating.

export const GLYPH = {
  gClef: "M15.04 -16.6C14.96 -17.08 15.04 -17.12 15.28 -17.36C15.92 -17.96 16.76 -18.8 17.52 -19.64C20.88 -23.32 22.88 -28.08 22.88 -32.6C22.88 -36.08 21.92 -39.52 20.28 -41.92C19.68 -42.8 18.64 -43.92 18.2 -43.92C17.64 -43.92 16.4 -42.88 15.6 -42C12.64 -38.72 11.68 -33.72 11.68 -29.56C11.68 -27.24 11.96 -24.64 12.24 -23C12.32 -22.52 12.36 -22.44 11.88 -22.04C9.32 -19.92 6.56 -17.48 4.48 -14.92C1.72 -11.48 0 -7.76 0 -3.48C0 3.48 4.76 10.08 14.56 10.08C15.48 10.08 16.52 10 17.32 9.84C17.76 9.76 17.84 9.72 17.92 10.2C18.4 12.88 19 16.36 19 18.24C19 24.16 15 24.88 12.64 24.88C10.48 24.88 9.44 24.24 9.44 23.72C9.44 23.44 9.8 23.32 10.72 23.04C11.96 22.68 13.4 21.6 13.4 19.28C13.4 17.08 12 15.2 9.56 15.2C6.88 15.2 5.28 17.32 5.28 19.8C5.28 22.4 6.84 26.32 12.88 26.32C15.56 26.32 20.76 25.12 20.76 18.32C20.76 16.04 20.04 12.24 19.6 9.76C19.52 9.28 19.56 9.32 20.12 9.08C24.16 7.48 26.84 4.08 26.84 -0.44C26.84 -5.56 23.08 -10.08 17.2 -10.08C16.16 -10.08 16.16 -10.08 16.04 -10.8ZM18.8 -37.72C20.12 -37.72 21.2 -36.64 21.2 -34.44C21.2 -31.68 19.88 -29.12 16.76 -26C16.12 -25.36 15.16 -24.44 14.24 -23.64C13.96 -23.4 13.8 -23.44 13.72 -23.96C13.56 -25 13.48 -26.36 13.48 -27.64C13.48 -33.88 16.36 -37.72 18.8 -37.72ZM14.44 -10.48C14.56 -9.72 14.56 -9.76 13.84 -9.52C10.32 -8.32 8.04 -5.16 8.04 -1.76C8.04 1.84 9.92 4.4 12.64 5.32C12.96 5.44 13.44 5.56 13.72 5.56C14.04 5.56 14.2 5.36 14.2 5.12C14.2 4.84 13.88 4.72 13.6 4.6C11.92 3.88 10.72 2.16 10.72 0.32C10.72 -1.96 12.28 -3.68 14.72 -4.36C15.36 -4.52 15.44 -4.48 15.52 -4.04L17.52 7.88C17.6 8.32 17.56 8.32 16.96 8.44C16.32 8.56 15.52 8.64 14.72 8.64C7.72 8.64 3.2 4.76 3.2 -0.8C3.2 -3.16 3.6 -6.32 6.92 -10.08C9.32 -12.76 11.16 -14.24 13.04 -15.76C13.44 -16.08 13.52 -16.04 13.6 -15.6ZM17.2 -4.12C17.12 -4.6 17.16 -4.72 17.64 -4.68C20.88 -4.4 23.56 -1.68 23.56 1.84C23.56 4.36 22.04 6.4 19.8 7.52C19.32 7.76 19.24 7.76 19.16 7.28Z",
  fClef: "M10.08 -10.48C3.12 -10.48 0 -5.4 0 -1.56C0 1.64 1.68 4.4 4.92 4.4C7.44 4.4 9.16 2.64 9.16 0.16C9.16 -2.4 7.28 -4 5.32 -4C4.24 -4 3.84 -3.72 3.32 -3.72C2.8 -3.72 2.68 -4.04 2.68 -4.44C2.68 -6.04 5.08 -8.96 9.16 -8.96C13.4 -8.96 15.24 -4.8 15.24 1.48C15.24 5.6 14.36 10.4 11.88 14.24C9.48 17.96 5.36 21.36 0.4 24.2C0.04 24.4 -0.2 24.6 -0.2 24.92C-0.2 25.16 -0.04 25.4 0.32 25.4C0.52 25.4 0.76 25.32 1 25.2C6.32 22.6 11.44 19.56 15.68 15C19.16 11.24 21.24 6.36 21.24 1.12C21.24 -5.84 17 -10.48 10.08 -10.48ZM25.16 -7.2C23.92 -7.2 22.96 -6.24 22.96 -5C22.96 -3.76 23.92 -2.8 25.16 -2.8C26.4 -2.8 27.36 -3.76 27.36 -5C27.36 -6.24 26.4 -7.2 25.16 -7.2ZM25.2 2.84C23.96 2.84 23.04 3.76 23.04 5C23.04 6.24 23.96 7.16 25.2 7.16C26.44 7.16 27.36 6.24 27.36 5C27.36 3.76 26.44 2.84 25.2 2.84Z",
  wholeNote: "M8.64 -5C3.32 -5 0 -2.8 0 -0.08C0 2.6 2.28 5 8.24 5C14.8 5 16.88 2.72 16.88 -0.08C16.88 -2.92 12.36 -5 8.64 -5ZM4.44 -2.52C4.88 -3.92 6.36 -4.12 7.6 -4.12C10.36 -4.12 12.56 -1.16 12.56 1.24C12.56 1.52 12.52 1.76 12.48 2C12.28 3 11.72 3.68 10.72 3.92C10.32 4.04 9.88 4.08 9.48 4.08C9.12 4.08 8.8 4.04 8.44 3.92C7.76 3.72 7.12 3.36 6.56 2.88C6.24 2.6 5.96 2.32 5.72 2C4.92 1.08 4.32 -0.28 4.32 -1.56C4.32 -1.88 4.36 -2.2 4.44 -2.52Z",
};

export const NOTEHEAD_WIDTH = 16.88;

import {
  BOTH_CLEFS, CLEFS, MIDDLE_C_Y, clefFor, diatonic, everyNote, fromDiatonic, grandY, label,
  sharedNotes, systemLines,
} from "./notes.js";

const LINE_THICKNESS = 1.3; // Bravura engravingDefaults, in staff-space/10
const LEDGER_THICKNESS = 1.6;
const LEDGER_EXTENSION = 4;

const CLEF_X = 10;
const STAFF_LEFT = 0;
/**
 * Wider than one staff needed, because the system is now twice as tall and
 * the drawing is scaled to the page's width: a narrow system would be a very
 * tall picture. At this width it comes out about the height the single staff
 * used to be.
 */
const STAFF_RIGHT = 300;

const NOTE_X = (STAFF_LEFT + STAFF_RIGHT) / 2 - NOTEHEAD_WIDTH / 2;

/** The barline joining the two staves into one system. */
const SYSTEM_THICKNESS = 1.6;

// --- cheat sheet ----------------------------------------------------------

// The reference stave is a fixed width whatever the range, so the engraving
// comes out the same size at every difficulty and the notes spread to fill it.
//
// Wide enough that the widest range still has room: at two ledger lines there
// are 29 notes, and a notehead is 16.88 units with three more of ledger line
// either side, so anything under about 23 units of spacing has them touching
// and under 17 has the noteheads themselves overlapping. This leaves 28.5.
// The consequence is that the reference is engraved smaller than the drill —
// more user units in the same paper — which is the right way round for
// something you read between notes rather than while answering one.
export const SCALE_WIDTH = 880;
const SCALE_NOTE_LEFT = 46; // clear of the clef
export const SCALE_NOTE_RIGHT = 20;
// Tighter than the drill's, because at seventeen notes to the stave the
// ledger lines of neighbouring notes would otherwise run into one another.
const SCALE_LEDGER_EXTENSION = 3;

/**
 * How far a glyph's outline reaches above and below its own origin.
 *
 * Every one of these paths uses absolute M, L and C only, so the numbers come
 * in x,y pairs and the odd ones out are the y coordinates. Read off the
 * outlines rather than written down beside them: the clefs are the reason the
 * system needs more room than its staff lines, and a hand-copied number for
 * that is a number that goes stale the first time a glyph is regenerated.
 *
 * @param {string} d
 * @returns {{top: number, bottom: number}}
 */
export function inkExtent(d) {
  let top = Infinity;
  let bottom = -Infinity;
  for (const piece of d.split(/[MLCZ]/)) {
    const nums = piece.match(/-?\d+(?:\.\d+)?/g);
    if (!nums) continue;
    for (let i = 1; i < nums.length; i += 2) {
      top = Math.min(top, Number(nums[i]));
      bottom = Math.max(bottom, Number(nums[i]));
    }
  }
  return { top, bottom };
}

/**
 * Where each clef's glyph actually reaches, in system coordinates. The G clef
 * curls nearly fourteen units above the line it names — a staff space and a
 * half above the top of the treble staff — and the twelve units of margin the
 * viewBox used to allow was not enough for it, so on the staves alone the top
 * of the curl was cut off.
 */
const CLEF_INK = Object.fromEntries(
  Object.entries(CLEFS).map(([name, clef]) => {
    const ink = inkExtent(GLYPH[clef.glyph]);
    return [name, { top: clef.glyphY + ink.top, bottom: clef.glyphY + ink.bottom }];
  }),
);

/** Breathing room outside whatever reaches furthest. */
const MARGIN = 8;

/**
 * The vertical span a system needs: its staff lines, its clefs' outlines, and
 * the notes on it, whichever of the three reaches furthest each way.
 * @param {number[]} ys
 * @param {string[]} clefNames
 * @returns {{top: number, bottom: number}}
 */
function systemBox(ys, clefNames) {
  const lines = systemLines(clefNames);
  const ink = clefNames.map((name) => CLEF_INK[name]);
  // Outwards to whole units: the margin is a judgement, not a measurement,
  // and a viewBox reading "-17.92 ... 145.92000000000002" is nobody's friend.
  return {
    top: Math.floor(
      Math.min(lines.top - MARGIN, ...ink.map((i) => i.top - 4), ...ys.map((y) => y - MARGIN)),
    ),
    bottom: Math.ceil(
      Math.max(
        lines.bottom + MARGIN,
        ...ink.map((i) => i.bottom + 4),
        ...ys.map((y) => y + MARGIN),
      ),
    ),
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

function el(name, attrs) {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

function line(y, thickness, x1, x2, cls = "rule") {
  return el("rect", {
    x: x1,
    y: y - thickness / 2,
    width: x2 - x1,
    height: thickness,
    class: cls,
  });
}

/**
 * Which ledger lines a note at this vertical position needs.
 *
 * Counted outwards from the staff the note is written on, at every second
 * step: a note in the space just outside a staff needs no line, the next one
 * out needs one, and so on. On a grand staff that gives the three places they
 * occur — above the treble staff, below the bass staff, and the line between
 * them that middle C sits on, which is one ledger below the treble staff and
 * nothing to do with the bass. Confined to one clef, the same rule puts them
 * above or below that staff instead, which is where the bass clef's C4 and
 * the treble clef's A3 belong.
 *
 * @param {number} y
 * @param {string} [clefName] the staff the note is on; inferred from y if the
 *   caller is drawing both.
 * @returns {number[]}
 */
export function ledgerLines(y, clefName = y <= MIDDLE_C_Y ? "treble" : "bass") {
  const top = CLEFS[clefName].top;
  const out = [];
  for (let ly = top + 50; ly <= y; ly += 10) out.push(ly);
  for (let ly = top - 10; ly >= y; ly -= 10) out.push(ly);
  return out;
}

/**
 * The staves in play, their clefs, and — when there are two of them — the
 * barline that makes them one system. One clef draws one staff: an empty
 * treble staff over a bass-clef drill is furniture, and worse than furniture
 * once the notes are placed against the staff they are actually written on.
 * @param {SVGElement} svg
 * @param {number} right
 * @param {string[]} [clefNames]
 */
function drawSystem(svg, right, clefNames = BOTH_CLEFS) {
  for (const name of clefNames) {
    const clef = CLEFS[name];
    for (let i = 0; i < 5; i++) {
      svg.appendChild(line(clef.top + i * 10, LINE_THICKNESS, STAFF_LEFT, right));
    }
    const group = el("g", { transform: `translate(${CLEF_X} ${clef.glyphY})` });
    group.appendChild(el("path", { d: GLYPH[clef.glyph], class: "clef" }));
    svg.appendChild(group);
  }
  if (clefNames.length < 2) return;
  const { top, bottom } = systemLines(clefNames);
  svg.appendChild(
    el("rect", {
      x: STAFF_LEFT,
      y: top,
      width: SYSTEM_THICKNESS,
      height: bottom - top,
      class: "rule",
    }),
  );
}

/**
 * The viewBox a system needs to hold these notes: both staves always, plus
 * however far outside them the range reaches. Sized to the range rather than
 * to the widest possible one, so a drill on the staves alone isn't drawn
 * small to leave room for ledger lines it will never use.
 * @param {number[]} dns
 * @param {string[]} [clefNames]
 * @param {number} [width]
 * @returns {string}
 */
export function viewBox(dns, clefNames = BOTH_CLEFS, width = STAFF_RIGHT) {
  const { top, bottom } = systemBox(
    dns.map((dn) => grandY(dn, clefNames)),
    clefNames,
  );
  return `-4 ${top} ${width + 8} ${bottom - top}`;
}

/**
 * Draw one note on the grand staff. Returns the notehead element so the
 * caller can colour it for feedback.
 *
 * With both clefs there is nothing to say about which one: both are on
 * screen, and a position on the system is a pitch. Which is the point — the
 * clef used to change silently half the time, and no amount of flashing a
 * glyph at the edge of the page fixes a thing you have to remember rather
 * than see.
 *
 * @param {SVGElement} svg
 * @param {number} dn
 * @param {string[]} [clefNames]
 * @returns {SVGElement}
 */
export function render(svg, dn, clefNames = BOTH_CLEFS) {
  svg.replaceChildren();
  drawSystem(svg, STAFF_RIGHT, clefNames);

  const y = grandY(dn, clefNames);
  for (const ly of ledgerLines(y, clefFor(dn, clefNames))) {
    svg.appendChild(
      line(
        ly,
        LEDGER_THICKNESS,
        NOTE_X - LEDGER_EXTENSION,
        NOTE_X + NOTEHEAD_WIDTH + LEDGER_EXTENSION,
      ),
    );
  }

  const head = el("path", {
    d: GLYPH.wholeNote,
    transform: `translate(${NOTE_X} ${y})`,
    class: "notehead",
  });
  svg.appendChild(head);
  return head;
}

/**
 * Where each notehead's left edge goes on the reference stave: evenly spread
 * between the clef and the right margin, whatever the range.
 * @param {number} count
 * @returns {number[]}
 */
export function noteXs(count) {
  const last = SCALE_WIDTH - SCALE_NOTE_RIGHT - NOTEHEAD_WIDTH;
  const step = count > 1 ? (last - SCALE_NOTE_LEFT) / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => SCALE_NOTE_LEFT + i * step);
}

/**
 * The whole range drawn ascending across one grand staff, every note named
 * underneath — the cheat sheet. Returns a new system; unlike the drill's, it
 * isn't in the document already.
 *
 * One picture rather than one per clef, because that is what the notes are:
 * a single ladder from the bottom of the bass staff to the top of the treble,
 * through the middle C that joins them. `dns` is the whole range the ledger
 * setting reaches, and the notes the pitch limits leave out are faded rather
 * than dropped, so the spacing doesn't shift about as the limits change.
 * Faded rather than tinted because the default here is black ink — on the
 * keyboard, where the default is a white key, it goes the other way round.
 *
 * @param {number[]} dns ascending
 * @param {number[]} [inRange] which of them the drill is actually asking
 * @param {string[]} [clefNames]
 * @param {number} [ledgers] how far past the staves the range reaches, which
 *   is what settles which notes have two spellings. Nought by default: with
 *   the staves alone the clefs' reaches do not meet.
 * @returns {SVGSVGElement}
 */
export function grandScale(dns, inRange = dns, clefNames = BOTH_CLEFS, ledgers = 0) {
  const svg = /** @type {SVGSVGElement} */ (
    el("svg", {
      class: "stave",
      role: "img",
      "aria-label":
        inRange.length === dns.length
          ? `A grand staff, ${label(dns[0])} up to ${label(dns.at(-1))}`
          : `A grand staff, ${label(dns[0])} up to ${label(dns.at(-1))}, of which ` +
            `${label(inRange[0])} up to ${label(inRange.at(-1))} is in play`,
    })
  );

  const ys = dns.map((dn) => grandY(dn, clefNames));
  const box = systemBox(ys, clefNames);
  // Room under the lowest of everything for the row of note names.
  const labelY = box.bottom + 12;
  svg.setAttribute("viewBox", `-4 ${box.top} ${SCALE_WIDTH + 8} ${labelY + 8 - box.top}`);
  drawSystem(svg, SCALE_WIDTH, clefNames);

  const xs = noteXs(dns.length);
  const playing = new Set(inRange);
  dns.forEach((dn, i) => {
    const x = xs[i];
    const y = ys[i];
    const out = playing.has(dn) ? "" : " is-out";
    for (const ly of ledgerLines(y, clefFor(dn, clefNames))) {
      svg.appendChild(
        line(
          ly,
          LEDGER_THICKNESS,
          x - SCALE_LEDGER_EXTENSION,
          x + NOTEHEAD_WIDTH + SCALE_LEDGER_EXTENSION,
          "rule" + out,
        ),
      );
    }
    svg.appendChild(
      el("path", {
        d: GLYPH.wholeNote,
        transform: `translate(${x} ${y})`,
        class: "notehead" + out,
      }),
    );
    const text = el("text", { x: x + NOTEHEAD_WIDTH / 2, y: labelY, class: "note-label" + out });
    text.textContent = label(dn);
    svg.appendChild(text);
  });

  // The notes both clefs can write, written both ways.
  //
  // The one exception the reference makes to a pitch having a single
  // position, and it makes it because the page does: piano music engraves
  // these on whichever staff suits the hand taking them. Drawing one spelling
  // only leaves a staff's own ledger lines unused — lines you will certainly
  // meet — and makes the gap between the staves read as a mistake rather than
  // as the place the two frames join. Both, in one column, under one name.
  for (const dn of sharedNotes(clefNames, ledgers)) {
    const i = dns.indexOf(dn);
    if (i === -1) continue;
    const other = clefFor(dn, clefNames) === "treble" ? "bass" : "treble";
    const x = xs[i];
    const y = grandY(dn, [other]);
    const out = playing.has(dn) ? "" : " is-out";
    for (const ly of ledgerLines(y, other)) {
      svg.appendChild(
        line(
          ly,
          LEDGER_THICKNESS,
          x - SCALE_LEDGER_EXTENSION,
          x + NOTEHEAD_WIDTH + SCALE_LEDGER_EXTENSION,
          "rule" + out,
        ),
      );
    }
    svg.appendChild(
      el("path", {
        d: GLYPH.wholeNote,
        transform: `translate(${x} ${y})`,
        class: "notehead" + out,
      }),
    );
  }

  return svg;
}

// --- the keyboard ---------------------------------------------------------

const KEY_W = 14;
const KEY_H = 72;
const BLACK_W = 8;
const BLACK_H = 45;
const KEY_LABEL_Y = 85;

/** Letters with a black key immediately above them. */
const BLACK_ABOVE = new Set(["C", "D", "F", "G", "A"]);

/**
 * Is there a black key between this note and the white key above it? The
 * two places there isn't — E to F, H to C — are the whole reason a keyboard
 * is navigable by eye, so it is worth being sure of them.
 * @param {number} dn
 * @returns {boolean}
 */
export function hasBlackKeyAbove(dn) {
  return BLACK_ABOVE.has(fromDiatonic(dn).letter);
}

/**
 * A keyboard spanning the drill's whole compass, for finding a note on the
 * instrument rather than on the staff.
 *
 * The octave number is the part of a note's name with nothing in the picture
 * to hang it on — "D3" says nothing about where D3 is — so the drawing does
 * that work instead: the black keys give the pattern you actually navigate
 * by, every C is named, middle C carries a dot, and one key can be called out.
 *
 * @param {{marked?: number | null, inRange?: number[]}} [opts]
 * @returns {SVGSVGElement}
 */
export function keyMap({ marked = null, inRange = [] } = {}) {
  const notes = everyNote();
  const width = notes.length * KEY_W;
  const svg = /** @type {SVGSVGElement} */ (
    el("svg", {
      class: "keys",
      viewBox: `-1 -1 ${width + 2} ${KEY_LABEL_Y + 6}`,
      role: "img",
      "aria-label":
        marked === null
          ? `A keyboard from ${label(notes[0])} to ${label(notes.at(-1))}`
          : `A keyboard with ${label(marked)} marked`,
    })
  );
  const lit = new Set(inRange);

  notes.forEach((dn, i) => {
    const classes = ["key"];
    if (lit.has(dn)) classes.push("is-in-range");
    if (dn === marked) classes.push("is-marked");
    svg.appendChild(
      el("rect", { x: i * KEY_W, y: 0, width: KEY_W, height: KEY_H, class: classes.join(" ") }),
    );
  });

  // All the black keys after all the white ones, so they lie over them.
  notes.forEach((dn, i) => {
    if (i === notes.length - 1 || !hasBlackKeyAbove(dn)) return;
    svg.appendChild(
      el("rect", {
        x: (i + 1) * KEY_W - BLACK_W / 2,
        y: 0,
        width: BLACK_W,
        height: BLACK_H,
        class: "key-black",
      }),
    );
  });

  notes.forEach((dn, i) => {
    const middle = i * KEY_W + KEY_W / 2;
    if (dn === diatonic("C", 4)) {
      svg.appendChild(el("circle", { cx: middle, cy: KEY_H - 9, r: 2.2, class: "key-dot" }));
    }
    if (fromDiatonic(dn).letter !== "C" && dn !== marked) return;
    const text = el("text", {
      x: middle,
      y: KEY_LABEL_Y,
      class: dn === marked ? "key-label is-marked" : "key-label",
    });
    text.textContent = label(dn);
    svg.appendChild(text);
  });

  return svg;
}
