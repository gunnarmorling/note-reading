// Pitch model. Naturals only — accidentals are a separate skill and would
// muddy the latency signal.
//
// German note names: the seventh degree is H, and B is the name of B flat.
// Naturals-only means B flat never comes up, so nothing here is ambiguous.
// Card ids are built from these letters, so ids from before the rename need
// migrating; see storage.js.

/** Letter names in diatonic order, starting at C. */
export const LETTERS = ["C", "D", "E", "F", "G", "A", "H"];

/** Semitones above C for each letter, for MIDI conversion. */
const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, H: 11 };

/**
 * Diatonic number: a single integer that counts letter-steps from C0.
 * C4 = 28, D4 = 29, and so on. Staff position is linear in this, which is
 * the whole reason for using it.
 * @param {string} letter
 * @param {number} octave
 * @returns {number}
 */
export function diatonic(letter, octave) {
  return octave * 7 + LETTERS.indexOf(letter);
}

/** @param {number} dn @returns {{letter: string, octave: number}} */
export function fromDiatonic(dn) {
  return { letter: LETTERS[((dn % 7) + 7) % 7], octave: Math.floor(dn / 7) };
}

/** @param {number} dn @returns {number} MIDI note number */
export function toMidi(dn) {
  const { letter, octave } = fromDiatonic(dn);
  return (octave + 1) * 12 + SEMITONES[letter];
}

/** @param {number} dn @returns {string} e.g. "C4" */
export function label(dn) {
  const { letter, octave } = fromDiatonic(dn);
  return letter + octave;
}

/**
 * A clef: which glyph, where its own staff's top line sits on the grand
 * staff, where the glyph's origin sits, and which notes its staff spans.
 *
 * Both staves are always drawn, so these are absolute positions on the one
 * system rather than each clef's private coordinates. `glyphY` is just the
 * grand-staff position of the note the glyph names — G4 for the treble, F3
 * for the bass — which is what a clef means in the first place.
 */
export const CLEFS = {
  treble: {
    name: "treble",
    glyph: "gClef",
    glyphY: 30, // G4
    top: 0,
    bottomLine: diatonic("E", 4),
    topLine: diatonic("F", 5),
  },
  bass: {
    name: "bass",
    glyph: "fClef",
    glyphY: 90, // F3
    top: 80,
    bottomLine: diatonic("G", 2),
    topLine: diatonic("A", 3),
  },
};

/**
 * Vertical geometry, in the units the staves are drawn in: 10 per staff
 * space, 5 per diatonic step, y increasing downwards. The treble staff's
 * lines run 0 to 40 and the bass staff's 80 to 120.
 *
 * Four staff spaces between them, which is roughly what engraving uses. The
 * first attempt used two, the tightest gap that makes the whole compass one
 * evenly spaced ladder with middle C exactly midway — and two is visibly
 * cramped. Nothing needed it: a reader anchors a note to the nearer staff,
 * not to the page, so the gap is free to be whatever reads well.
 */
export const MIDDLE_C_Y = 50;
export const GRAND_BOTTOM_Y = 120;

/** Both staves, in the order they ascend. The default context for geometry. */
export const BOTH_CLEFS = ["bass", "treble"];

/**
 * Which staff a note is written on.
 *
 * With both clefs in play this is the pitch: middle C and up on the treble,
 * below it on the bass. With one clef it is that clef, whatever the pitch —
 * which is the whole point of choosing one. A drill confined to the bass
 * clef reaches C4 and above by way of ledger lines over the bass staff, and
 * drawing those notes hanging under a treble staff instead put a five-space
 * jump between H3 and C4 and left the bass staff's own ledger lines unused.
 *
 * @param {number} dn
 * @param {string[]} [clefNames]
 * @returns {string}
 */
export function clefFor(dn, clefNames = BOTH_CLEFS) {
  if (clefNames.length === 1) return clefNames[0];
  return isUpper(dn) ? "treble" : "bass";
}

/**
 * Where a note sits on the system.
 *
 * Measured from whichever staff it is written on. With both clefs that is the
 * treble from middle C up and the bass from H3 down, which is the only place
 * the two frames meet and the only place the spacing is not uniform: C4 hangs
 * a ledger line below the treble staff and H3 sits in the space above the
 * bass staff, a step apart in pitch and five staff spaces apart on the page.
 * That is what piano music looks like. What matters is preserved: each pitch
 * has exactly one position and no position is two pitches.
 *
 * @param {number} dn
 * @param {string[]} [clefNames]
 * @returns {number}
 */
export function grandY(dn, clefNames = BOTH_CLEFS) {
  const clef = CLEFS[clefFor(dn, clefNames)];
  return clef.top + 40 - (dn - clef.bottomLine) * 5;
}

/**
 * The top and bottom staff lines of the system these clefs make, which is
 * what everything outside them — ledger lines, the barline, the viewBox — is
 * measured from. One clef is a five-line staff, not a grand staff with an
 * empty half.
 * @param {string[]} [clefNames]
 * @returns {{top: number, bottom: number}}
 */
export function systemLines(clefNames = BOTH_CLEFS) {
  const tops = clefNames.map((name) => CLEFS[name].top);
  return { top: Math.min(...tops), bottom: Math.max(...tops) + 40 };
}

/**
 * Whether a note belongs to the upper staff: middle C and above. The dividing
 * line for which staff to draw a note on, and the same line the two session
 * medians are split at, since the hands divide about here too.
 * @param {number} dn
 * @returns {boolean}
 */
export function isUpper(dn) {
  return dn >= diatonic("C", 4);
}

/**
 * The notes both clefs can write, which are the notes with two spellings.
 *
 * Where the clefs' reaches overlap, a pitch can be engraved on either staff —
 * middle C alone at one ledger line, A3 up to E4 at two — and piano music
 * picks whichever suits the hand taking it. The drill draws one of them,
 * because a card is a pitch and a position has to mean one thing; the cheat
 * sheet draws both, because the page you will read does.
 *
 * @param {string[]} clefNames
 * @param {number} ledgers
 * @returns {number[]} ascending
 */
export function sharedNotes(clefNames, ledgers) {
  if (clefNames.length < 2) return [];
  const reaches = clefNames.map((name) => new Set(rangeFor(CLEFS[name], ledgers)));
  return [...reaches[0]].filter((dn) => reaches.every((r) => r.has(dn))).sort((a, b) => a - b);
}

/**
 * Every note in play for a clef at a given difficulty.
 * Each extra ledger level adds two diatonic steps at each end: the space just
 * outside the staff, then the note sitting on the new ledger line.
 * @param {typeof CLEFS.treble} clef
 * @param {number} ledgers 0, 1 or 2
 */
export function rangeFor(clef, ledgers) {
  const out = [];
  const lo = clef.bottomLine - 2 * ledgers;
  const hi = clef.topLine + 2 * ledgers;
  for (let dn = lo; dn <= hi; dn++) out.push(dn);
  return out;
}

/**
 * The nearest note with this letter to the one given.
 *
 * For playing back what was pressed. Typing answers a letter with no octave,
 * so an octave has to be chosen, and the nearest one is the useful choice: a
 * wrong letter then sounds a tone or two from the right answer rather than a
 * seventh away, which is the difference between hearing "not quite" and
 * hearing an unrelated note.
 *
 * @param {number} dn the note on screen
 * @param {string} letter what was pressed
 * @returns {number}
 */
export function nearestWithLetter(dn, letter) {
  const step = LETTERS.indexOf(letter);
  if (step < 0) return dn;
  const above = dn + (((step - (((dn % 7) + 7) % 7)) % 7) + 7) % 7;
  const below = above - 7;
  return above - dn <= dn - below ? above : below;
}

/** Ledger levels the drill offers, and so the widest range it can draw. */
export const MAX_LEDGERS = 2;

/**
 * Every note these clefs can show at this ledger setting, ascending. Note
 * that the result can have a hole in it: with both staves and no ledger
 * lines there is nothing between A3 and E4, because neither staff reaches
 * there. The pitch limits offer exactly this set, so that they can't promise
 * a note the ledger setting has no way to draw.
 * @param {string[]} clefNames
 * @param {number} ledgers
 * @returns {number[]}
 */
export function notesFor(clefNames, ledgers) {
  const all = new Set();
  for (const name of clefNames) {
    for (const dn of rangeFor(CLEFS[name], ledgers)) all.add(dn);
  }
  return [...all].sort((a, b) => a - b);
}

/** The widest the drill ever goes: the bounds a stored pitch limit may take. */
export function everyNote() {
  return notesFor(Object.keys(CLEFS), MAX_LEDGERS);
}

/**
 * The drill's candidate set: every note either staff in play can reach,
 * within the ledger setting and the pitch limits, each appearing once however
 * many staves could show it. Can come back empty — asking for the bass staff
 * and nothing below C4 is a contradiction — and the caller has to say so
 * rather than draw a note.
 *
 * @param {string[]} clefNames
 * @param {number} ledgers
 * @param {number} lowest diatonic number, inclusive
 * @param {number} highest diatonic number, inclusive
 * @param {string} mode which deck the ids belong to
 * @returns {string[]}
 */
export function candidateIds(clefNames, ledgers, lowest, highest, mode) {
  return notesFor(clefNames, ledgers)
    .filter((dn) => dn >= lowest && dn <= highest)
    .map((dn) => cardId(dn, mode));
}

/**
 * The two ways of answering, which are two different skills and so two
 * separate decks.
 *
 * Naming a note and finding it on an instrument are not the same task and
 * cannot share a measurement. Typing checks the letter; playing checks the
 * exact pitch, octave included, so it is a strictly harder test. Typing is a
 * recognition time; playing includes moving your hand there, so the two are
 * on different scales. And a note you can name but cannot place would read as
 * mastered if they were pooled — which is precisely the gap worth seeing.
 */
export const MODES = ["typed", "played"];

/**
 * Stable identifier for one drill item: how it is being answered, and which
 * pitch.
 *
 * The pitch alone, because on a grand staff a position is a pitch — middle C
 * written under the treble staff and middle C written over the bass staff are
 * the same dot in the same place, so there is nothing for a clef to
 * distinguish. Ids from before either rule are migrated on load; see
 * storage.js.
 *
 * @param {number} dn
 * @param {string} mode
 * @returns {string}
 */
export function cardId(dn, mode) {
  return mode + ":" + label(dn);
}

/** @param {string} id @returns {number} */
export function cardPitch(id) {
  const pitch = id.slice(id.indexOf(":") + 1);
  return diatonic(pitch[0], Number(pitch.slice(1)));
}

/** @param {string} id @returns {string} */
export function cardMode(id) {
  return id.slice(0, id.indexOf(":"));
}
