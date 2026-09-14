// Every assertion, in one module so that the browser page and the command line
// runner check exactly the same things. `run` takes a reporter and returns the
// tally; it touches no DOM of its own, and the only browser API anything below
// needs is `document.createElementNS`, which `staff.js` uses to build SVG —
// see tests/dom-stub.js for what that costs outside a browser.

import {
  ALPHA, ERROR_WEIGHT, PRIOR_MS, STARVE_TAU, TARGET_MS, accuracy, decay, isTimed, median,
  newCard, pick, record, weight,
} from "../scheduler.js";
import {
  BOTH_CLEFS, CLEFS, GRAND_BOTTOM_Y, LETTERS, MAX_LEDGERS, MIDDLE_C_Y, MODES, candidateIds,
  cardId, cardMode, cardPitch, clefFor, diatonic, everyNote, fromDiatonic, grandY, isUpper,
  label, nearestWithLetter, notesFor, rangeFor, sharedNotes, systemLines, toMidi,
} from "../notes.js";
import {
  GLYPH, NOTEHEAD_WIDTH, SCALE_NOTE_RIGHT, SCALE_WIDTH, grandScale, hasBlackKeyAbove, inkExtent,
  LINE_SPACING, lineXs, ledgerLines, markLive, noteXs, renderLine, viewBox,
} from "../staff.js";
import {
  LEAP, SEQUENCE_SPAN, arrange, chooseLine, contourWeight, permutations,
} from "../sequence.js";
import { mergeClefIds, renameLegacyIds, tagUntaggedIds } from "../storage.js";
import {
  SESSION_GAP_MS, WINDOWS, continuesSession, newSession, overall, previousRange, recordAnswer,
  sessionsBetween, sessionsIn, startOfDay, summarise, totalsByCard,
} from "../history.js";
import {
  AMBIGUOUS_CENTS, NOISE_INITIAL, ONSET_RATIO, SILENCE_FLOOR, TUNING_DEADBAND_CENTS, WINDOW,
  analyse, analyseOver, attackIndex, centsBetween, centsOff, createDetector, harmonicShare,
  decodeWav, encodeWav, followLine, magnitudes, onsetBar,
  detectPitch, envelope, isOnset, midiFor, nextNoiseFloor, nextPeak, onsetThreshold, rms,
  tuningOffset,
} from "../audio.js";

/**
 * @typedef {(name: string, ok: boolean, detail: string) => void} Reporter
 *
 * @param {Reporter} report
 * @returns {{passed: number, failed: number}}
 */
export function run(report) {
  let passed = 0;
  let failed = 0;

  function check(name, ok, detail = "") {
    report(name, ok, ok ? "" : detail);
    ok ? passed++ : failed++;
  }

  const eq = (name, actual, expected) =>
    check(name, Object.is(actual, expected), `got ${actual}, want ${expected}`);
  const near = (name, actual, expected, tol = 1e-6) =>
    check(name, Math.abs(actual - expected) < tol, `got ${actual}, want ~${expected}`);
  const ok = (name, cond, detail) => check(name, !!cond, detail);

  /** Deterministic RNG so the sampling tests don't flake. */
  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

    // --- pitch model -----------------------------------------------------

    eq("C4 is diatonic 28", diatonic("C", 4), 28);
    eq("diatonic round-trips", label(diatonic("A", 3)), "A3");
    eq("middle C is MIDI 60", toMidi(diatonic("C", 4)), 60);
    eq("A4 is MIDI 69", toMidi(diatonic("A", 4)), 69);
    eq("card ids round-trip", cardPitch(cardId(28, "typed")), 28);
    eq("and carry the deck they belong to", cardId(diatonic("C", 4), "played"), "played:C4");
    eq("which comes back out", cardMode(cardId(28, "played")), "played");
    eq("there are two decks", MODES.join(), "typed,played");

    // German naming: H is the seventh degree, and B is not a note name here.
    eq("the octave runs C to H", LETTERS.join(""), "CDEFGAH");
    eq("H4 is the step above A4", diatonic("H", 4) - diatonic("A", 4), 1);
    eq("H4 is MIDI 71", toMidi(diatonic("H", 4)), 71);
    eq("H names itself", label(diatonic("H", 3)), "H3");
    eq("H4 sits on the middle line of the treble staff", grandY(diatonic("H", 4)), 20);
    ok("B is not a letter name", !LETTERS.includes("B"));

    // --- legacy card ids -------------------------------------------------

    {
      const renamed = renameLegacyIds({ "treble:B4": 1, "bass:F3": 2 });
      eq("an old B card keeps its history under H", renamed["treble:H4"], 1);
      ok("and the old id is gone", !("treble:B4" in renamed));
      eq("other cards are untouched", renamed["bass:F3"], 2);
    }
    {
      const renamed = renameLegacyIds({ "treble:B4": 1, "treble:H4": 2 });
      eq("a card already renamed wins over the stale one", renamed["treble:H4"], 2);
    }
    eq("bass cards rename too", Object.keys(renameLegacyIds({ "bass:B2": 1 }))[0], "bass:H2");
    eq("ids without a trailing B are untouched", Object.keys(renameLegacyIds({ "bass:C4": 1 }))[0], "bass:C4");

    // --- dropping the clef from card ids ---------------------------------

    {
      // The same dot in the same place, so one card: the two histories are
      // pooled by how much each was based on rather than one winning.
      const merged = mergeClefIds({
        "treble:C4": { ewma: 800, errorRate: 0.1, seen: 10, missed: 2 },
        "bass:C4": { ewma: 1200, errorRate: 0.3, seen: 30, missed: 9 },
      });
      eq("the two become one", Object.keys(merged).join(), "C4");
      eq("trials add up", merged.C4.seen, 40);
      eq("misses too", merged.C4.missed, 11);
      near("the average is weighted by trials", merged.C4.ewma, 1100, 1e-9);
      near("and so is the error rate", merged.C4.errorRate, 0.25, 1e-9);
    }
    {
      const merged = mergeClefIds({ "treble:G4": { ewma: 620, errorRate: 0, seen: 20, missed: 1 } });
      eq("a pitch only one staff could reach keeps its history", merged.G4.seen, 20);
      eq("and loses only the clef from its name", Object.keys(merged).join(), "G4");
    }
    eq("an already-migrated id is left alone", Object.keys(mergeClefIds({ C4: {} })).join(), "C4");
    eq(
      "and a deck prefix is not mistaken for a clef",
      Object.keys(mergeClefIds({ "played:C4": {}, "typed:C4": {} })).sort().join(),
      "played:C4,typed:C4",
    );

    // --- tagging ids with the deck they belong to ------------------------

    {
      const tagged = tagUntaggedIds({ C4: { seen: 5 }, G4: { seen: 3 } }, "typed");
      eq("everything recorded before the split is typed", Object.keys(tagged).sort().join(), "typed:C4,typed:G4");
      eq("and keeps its history", tagged["typed:C4"].seen, 5);
    }
    eq(
      "ids that already say which deck are untouched",
      Object.keys(tagUntaggedIds({ "played:E4": {} }, "typed")).join(),
      "played:E4",
    );

    // --- staff geometry --------------------------------------------------

    // One system: the treble staff's lines run 0 to 40, the bass staff's 60
    // to 100, and middle C is the line between them at 50. Every pitch has
    // one position and every position one pitch.
    eq("the treble staff's bottom line is E4", grandY(diatonic("E", 4)), 40);
    eq("its top line is F5", grandY(diatonic("F", 5)), 0);
    eq("the bass staff's top line is A3", grandY(diatonic("A", 3)), GRAND_BOTTOM_Y - 40);
    eq("its bottom line is G2", grandY(diatonic("G", 2)), GRAND_BOTTOM_Y);
    eq("the F clef names the line it sits on", grandY(diatonic("F", 3)), CLEFS.bass.glyphY);
    eq("and the G clef likewise", grandY(diatonic("G", 4)), CLEFS.treble.glyphY);
    eq("middle C hangs a ledger below the treble staff", grandY(diatonic("C", 4)), MIDDLE_C_Y);
    eq("four staff spaces between the staves", grandY(diatonic("A", 3)) - grandY(diatonic("E", 4)), 40);

    // Each note is measured from the staff it is written on, so the one
    // place the frames meet is the one place the spacing is not uniform.
    eq("H3 sits in the space above the bass staff", grandY(diatonic("H", 3)), GRAND_BOTTOM_Y - 45);
    ok(
      "C4 and H3 are a step apart in pitch and further on the page",
      grandY(diatonic("H", 3)) - grandY(diatonic("C", 4)) > 5,
    );
    {
      // What the gap must not cost: two pitches sharing a position.
      const ys = everyNote().map(grandY);
      eq("no two pitches land in the same place", new Set(ys).size, ys.length);
      ok("and they still ascend", ys.every((y, i) => i === 0 || y < ys[i - 1]));
    }

    eq("a note on a staff needs no ledger", ledgerLines(20).length, 0);
    eq("nor one in a space just outside a staff", ledgerLines(45).length, 0);
    eq("nor H3, above the bass staff", ledgerLines(grandY(diatonic("H", 3))).length, 0);
    eq("middle C gets the one line between the staves", ledgerLines(MIDDLE_C_Y).join(), "50");
    eq("above the treble staff they stack up", ledgerLines(-20).length, 2);
    eq("and below the bass staff too", ledgerLines(GRAND_BOTTOM_Y + 20).length, 2);
    // One clef means one staff, and the notes reaching past it belong to
    // that staff. Drawn by pitch alone, a bass-clef drill put C4 hanging
    // under a treble staff — five spaces from the H3 a step below it, with
    // the bass staff's own ledger lines never used and the C that sits on
    // them missing from the cheat sheet.
    {
      const bass = ["bass"];
      const treble = ["treble"];
      eq("with one clef in play, every note is on it", clefFor(diatonic("C", 4), bass), "bass");
      eq("with two, the pitch decides", clefFor(diatonic("C", 4), BOTH_CLEFS), "treble");
      eq("bass alone: C4 sits on the first ledger above the staff",
        grandY(diatonic("C", 4), bass), GRAND_BOTTOM_Y - 50);
      eq("and gets that ledger line",
        ledgerLines(grandY(diatonic("C", 4), bass), "bass").join(), String(GRAND_BOTTOM_Y - 50));
      eq("treble alone: A3 sits two ledgers below the staff", grandY(diatonic("A", 3), treble), 60);
      eq("and gets both of them", ledgerLines(60, "treble").join(), "50,60");
      for (const clefs of [bass, treble]) {
        const ys = notesFor(clefs, 2).map((dn) => grandY(dn, clefs));
        ok(
          `${clefs[0]} alone is evenly spaced throughout`,
          ys.every((y, i) => i === 0 || ys[i - 1] - y === 5),
        );
      }
      const height = (clefs) => Number(viewBox(notesFor(clefs, 0), clefs).split(" ")[3]);
      ok("one staff is not drawn tall enough for two", height(bass) < height(BOTH_CLEFS));
      eq("one clef's system is one staff", systemLines(bass).bottom - systemLines(bass).top, 40);
      eq("two clefs' is both and the gap", systemLines(BOTH_CLEFS).bottom - systemLines(BOTH_CLEFS).top, 120);
    }

    // The clefs are why a system needs more room than its staff lines. The G
    // clef's curl reaches nearly a staff space and a half above the treble
    // staff and its tail a staff space and a half below it, and a viewBox
    // that allowed twelve units either side of the lines cut the top of the
    // curl off — on the staves alone, which is the setting you start in.
    {
      const gClef = inkExtent(GLYPH.gClef);
      const fClef = inkExtent(GLYPH.fClef);
      ok("the G clef reaches above its own staff", CLEFS.treble.glyphY + gClef.top < -10);
      ok("and below it", CLEFS.treble.glyphY + gClef.bottom > 40);
      for (const clefs of [BOTH_CLEFS, ["treble"], ["bass"]]) {
        const glyph = clefs.includes("treble") ? gClef : fClef;
        const name = clefs.includes("treble") ? "treble" : "bass";
        const reach = {
          top: CLEFS[name].glyphY + glyph.top,
          bottom: CLEFS[clefs.includes("bass") ? "bass" : "treble"].glyphY +
            (clefs.includes("bass") ? fClef.bottom : gClef.bottom),
        };
        for (const ledgers of [0, 1, 2]) {
          const box = viewBox(notesFor(clefs, ledgers), clefs).split(" ").map(Number);
          ok(
            `${clefs.join("+")} at ${ledgers} ledgers: the clef is inside the view`,
            box[1] <= reach.top && box[1] + box[3] >= reach.bottom,
          );
        }
      }
      eq(
        "and the view is in whole units",
        viewBox(notesFor(BOTH_CLEFS, 0), BOTH_CLEFS),
        "-4 -18 308 146",
      );
    }

    // The cheat sheet's one exception to a pitch having a single position:
    // where the clefs' reaches overlap, piano music engraves a note on either
    // staff, and a reference showing one spelling leaves a staff's own ledger
    // lines unused and the gap between the staves unexplained.
    //
    // Checked by column rather than by height, because at two ledger lines
    // the staves' ledger regions land on the same lines: y=60 is E4 read
    // against the bass clef and A3 read against the treble. Two noteheads at
    // one height, in different columns, meaning different notes — which is
    // what the clefs are for, and the best argument for drawing both.
    {
      const noteheads = (svg) =>
        svg.childNodes.filter((c) => (c.getAttribute("class") ?? "").startsWith("notehead"));
      const place = (c) => c.getAttribute("transform").match(/-?[\d.]+/g).map(Number);

      eq("with the staves alone the clefs do not meet", sharedNotes(BOTH_CLEFS, 0).length, 0);
      eq("one ledger line and they share middle C", sharedNotes(BOTH_CLEFS, 1).map(label).join(), "C4");
      eq("two and they share five", sharedNotes(BOTH_CLEFS, 2).map(label).join(), "A3,H3,C4,D4,E4");
      eq("one clef shares nothing", sharedNotes(["bass"], 2).length, 0);

      for (const ledgers of [0, 1, 2]) {
        const all = notesFor(BOTH_CLEFS, ledgers);
        const svg = grandScale(all, all, BOTH_CLEFS, ledgers);
        const shared = sharedNotes(BOTH_CLEFS, ledgers);
        const xs = noteXs(all.length);
        eq(
          `at ${ledgers} ledger lines every shared note is drawn twice`,
          noteheads(svg).length,
          all.length + shared.length,
        );
        for (const dn of shared) {
          const x = xs[all.indexOf(dn)];
          const ys = noteheads(svg)
            .map(place)
            .filter(([cx]) => Math.abs(cx - x) < 0.01)
            .map(([, cy]) => cy)
            .sort((p, q) => p - q);
          const want = [grandY(dn, ["bass"]), grandY(dn, ["treble"])].sort((p, q) => p - q);
          eq(`${label(dn)} is written twice in its own column`, ys.join(), want.join());
        }
      }

      const bass = notesFor(["bass"], 2);
      eq(
        "with one clef nothing is drawn twice",
        noteheads(grandScale(bass, bass, ["bass"], 2)).length,
        bass.length,
      );
    }

    ok("C4 counts as the upper half", isUpper(diatonic("C", 4)));
    ok("H3 as the lower", !isUpper(diatonic("H", 3)));
    eq("the staff alone has nine notes", rangeFor(CLEFS.treble, 0).length, 9);
    eq("one ledger level adds four notes", rangeFor(CLEFS.treble, 1).length, 13);

    // --- playing back what was pressed ----------------------------------

    {
      const at = (l, o) => diatonic(l, o);
      eq("the right letter sounds the note itself", nearestWithLetter(at("G", 4), "G"), at("G", 4));
      eq("a letter just above goes up", nearestWithLetter(at("G", 4), "A"), at("A", 4));
      eq("a letter just below goes down", nearestWithLetter(at("G", 4), "F"), at("F", 4));
      // The interesting ones are across an octave boundary: C pressed for
      // H4 should sound the C above it, not the C a seventh below.
      eq("C for H4 is the C above", nearestWithLetter(at("H", 4), "C"), at("C", 5));
      eq("H for C4 is the H below", nearestWithLetter(at("C", 4), "H"), at("H", 3));
      ok(
        "nothing is ever more than three steps away",
        LETTERS.every((l) =>
          everyNote().every((dn) => Math.abs(nearestWithLetter(dn, l) - dn) <= 3),
        ),
      );
      ok(
        "and it always has the letter asked for",
        LETTERS.every((l) => fromDiatonic(nearestWithLetter(at("E", 3), l)).letter === l),
      );
    }

    // --- the candidate set, and the pitch limits -------------------------

    {
      const lo = everyNote()[0];
      const hi = everyNote().at(-1);
      eq("the widest range runs C2 to C6", `${label(lo)}–${label(hi)}`, "C2–C6");

      // What the ledger setting can actually draw, which is what the pitch
      // limits are allowed to offer. Promising C2 at one ledger line was
      // the bug: the drill could not draw it and never asked for it.
      const span = (clefs, ledgers) => {
        const ns = notesFor(clefs, ledgers);
        return `${label(ns[0])}–${label(ns.at(-1))} (${ns.length})`;
      };
      eq("both staves, no ledger lines", span(["bass", "treble"], 0), "G2–F5 (18)");
      eq("both staves, one ledger line", span(["bass", "treble"], 1), "E2–A5 (25)");
      eq("both staves, two ledger lines", span(["bass", "treble"], 2), "C2–C6 (29)");
      eq("the bass staff alone", span(["bass"], 0), "G2–A3 (9)");
      ok(
        "the widest setting is the whole compass",
        notesFor(["bass", "treble"], 2).join() === everyNote().join(),
      );
      ok(
        "with no ledger lines neither staff reaches middle C",
        !notesFor(["bass", "treble"], 0).includes(diatonic("C", 4)),
      );
      eq(
        "and the overlap is not counted twice",
        candidateIds(["bass", "treble"], 2, lo, hi, "typed").length,
        notesFor(["bass", "treble"], 2).length,
      );
      eq(
        "both staves on the staff alone",
        candidateIds(["treble", "bass"], 0, lo, hi, "typed").length,
        18,
      );

      // Two decks over the same notes, never the same card.
      const typed = candidateIds(["treble", "bass"], 2, lo, hi, "typed");
      const played = candidateIds(["treble", "bass"], 2, lo, hi, "played");
      eq("each deck holds the whole range", typed.length, 29);
      eq("both of them", played.length, 29);
      eq("and they share not one id", typed.filter((id) => played.includes(id)).length, 0);
      ok("though they cover the same pitches", typed.every((id, i) => cardPitch(id) === cardPitch(played[i])));

      const fromC4 = candidateIds(["treble", "bass"], 1, diatonic("C", 4), hi, "typed");
      ok(
        "a floor drops everything below it",
        fromC4.every((id) => cardPitch(id) >= diatonic("C", 4)),
      );
      ok("and keeps what is above it", fromC4.length > 0);
      eq(
        "middle C appears once, not once per staff",
        fromC4.filter((id) => cardPitch(id) === diatonic("C", 4)).length,
        1,
      );
      eq(
        "a ceiling below the floor of the staff leaves nothing",
        candidateIds(["bass"], 0, diatonic("C", 4), hi, "typed").length,
        0,
      );
      eq(
        "one note can be asked for on its own",
        candidateIds(["treble"], 0, diatonic("G", 4), diatonic("G", 4), "typed").length,
        1,
      );
    }

    // --- the keyboard diagram --------------------------------------------

    eq(
      "the black keys fall in the two groups they do on a piano",
      LETTERS.map((l) => (hasBlackKeyAbove(diatonic(l, 4)) ? l.toLowerCase() : l)).join(""),
      "cdEfgaH",
    );

    // --- cheat sheet spacing ---------------------------------------------

    {
      const xs = noteXs(9);
      eq("one x per note", xs.length, 9);
      ok("the first note clears the clef", xs[0] >= 40, `got ${xs[0]}`);
      ok("ascending", xs.every((x, i) => i === 0 || x > xs[i - 1]));
      const gaps = xs.slice(1).map((x, i) => x - xs[i]);
      ok("evenly spread", Math.max(...gaps) - Math.min(...gaps) < 1e-9);
    }
    {
      // At the widest range — 29 notes, both clefs and two ledger lines — the
      // ledger lines of neighbouring notes must still not touch. This is what
      // the reference stave's width is for.
      const xs = noteXs(notesFor(BOTH_CLEFS, MAX_LEDGERS).length);
      const gap = xs[1] - xs[0] - (NOTEHEAD_WIDTH + 2 * 3);
      ok("ledger lines stay apart at the widest range", gap > 1, `gap was ${gap.toFixed(1)}`);
      ok(
        "the last note stays on the stave",
        xs.at(-1) + NOTEHEAD_WIDTH < SCALE_WIDTH,
        `got ${xs.at(-1)}`,
      );
    }
    eq("a single note doesn't divide by zero", noteXs(1).length, 1);
    ok("and sits at the left", Number.isFinite(noteXs(1)[0]));
    {
      // Every stave is drawn over a whole range, so the same note count
      // gives the same spacing whichever clef it is — which is the point of
      // fading the excluded notes rather than leaving them out.
      for (const count of [9, 13, 17]) {
        const xs = noteXs(count);
        near(
          `${count} notes reach the end of the stave`,
          xs.at(-1) + NOTEHEAD_WIDTH,
          SCALE_WIDTH - SCALE_NOTE_RIGHT,
          0.5,
        );
      }
    }

    // --- recording answers -----------------------------------------------

    eq("a new card starts at the prior", newCard().ewma, PRIOR_MS);

    {
      const c = record(newCard(), { correct: true, latencyMs: 800, trial: 0 });
      eq("the first correct answer replaces the prior outright", c.ewma, 800);
      eq("and counts as seen", c.seen, 1);
    }
    {
      let c = record(newCard(), { correct: true, latencyMs: 1000, trial: 0 });
      c = record(c, { correct: true, latencyMs: 2000, trial: 1 });
      near("later answers blend in at alpha", c.ewma, 1000 + ALPHA * 1000);
    }
    {
      let c = record(newCard(), { correct: true, latencyMs: 900, trial: 0 });
      const before = c.ewma;
      c = record(c, { correct: false, latencyMs: 4000, trial: 1 });
      eq("a wrong answer leaves the latency average alone", c.ewma, before);
      ok("but it moves the error rate", c.errorRate > 0);
    }
    {
      const c = record(newCard(), { correct: true, latencyMs: 5, trial: 0 });
      ok("implausibly fast answers are clamped", c.ewma >= 120, `got ${c.ewma}`);
    }
    eq("record does not mutate its input", newCard().seen, 0);

    // --- accuracy per note -----------------------------------------------

    ok("a note never asked has no accuracy", Number.isNaN(accuracy(newCard())));
    {
      let c = newCard();
      for (const correct of [true, true, false, true]) {
        c = record(c, { correct, latencyMs: 900, trial: 0 });
      }
      eq("three right out of four", accuracy(c), 0.75);
      eq("and the miss was counted once", c.missed, 1);
    }
    {
      // A note missed once and then got right four times running: the error
      // rate has all but forgotten it, which is the point of keeping counts
      // as well. 80% is the honest figure; the error rate implies 93%.
      let c = newCard();
      for (const correct of [false, true, true, true, true]) {
        c = record(c, { correct, latencyMs: 900, trial: 0 });
      }
      eq("four right out of five", accuracy(c), 0.8);
      ok(
        "the error rate flatters it, which is why it isn't the column",
        1 - c.errorRate - accuracy(c) > 0.1,
        `errorRate says ${(100 - c.errorRate * 100).toFixed(0)}%, counts say 80%`,
      );
    }
    {
      // Cards stored before misses were counted have no such field.
      const legacy = { ewma: 800, errorRate: 0.2, seen: 5, lastTrial: 0 };
      eq("a card from before this reads as unmissed", accuracy(legacy), 1);
      eq("and starts counting from the next miss", record(legacy, { correct: false, latencyMs: 900, trial: 1 }).missed, 1);
    }

    // --- not every answer is a measurement -------------------------------

    {
      const c = record(newCard(), { correct: true, latencyMs: 999999, trial: 0 });
      eq("a trip to the kitchen is not timed", c.ewma, PRIOR_MS);
      eq("but it was still a trial", c.seen, 1);
      eq("and still a correct answer", c.errorRate, 0);
      eq("it just isn't counted as a measurement", c.timed, 0);
    }
    {
      // Passing no finite latency is how the page declines to time one —
      // the first answer of a sitting, where the clock is measuring you
      // finding your place rather than reading.
      let c = record(newCard(), { correct: true, latencyMs: NaN, trial: 0 });
      eq("an untimed answer leaves the average at the prior", c.ewma, PRIOR_MS);
      c = record(c, { correct: true, latencyMs: 700, trial: 1 });
      eq("and the first real one still replaces it outright", c.ewma, 700);
      eq("rather than blending with a prior it never earned", c.timed, 1);
    }
    {
      // The bug this rule exposed: a card asked but never timed keeps its
      // average at the prior, which is not a measurement and must not be
      // shown as one. Trials and measurements are separate counts for
      // exactly this reason.
      const c = record(newCard(), { correct: true, latencyMs: NaN, trial: 0 });
      eq("asked once", c.seen, 1);
      eq("measured never", c.timed, 0);
      eq("so its average is still just the prior", c.ewma, PRIOR_MS);
      near("but it has an accuracy, because it was answered", accuracy(c), 1, 1e-9);
    }
    ok("a plausible answer is timed", isTimed(3000));
    ok("an implausible one is not", !isTimed(60000));
    ok("nor is a missing one", !isTimed(NaN) && !isTimed(undefined));

    // --- the record ------------------------------------------------------

    {
      const t0 = 1_700_000_000_000;
      ok("a moment later is the same sitting", continuesSession(t0, t0 + 60_000));
      ok("half an hour later, just", continuesSession(t0, t0 + SESSION_GAP_MS));
      ok("an hour later is not", !continuesSession(t0, t0 + SESSION_GAP_MS + 1));
      ok("and nor is a first ever answer", !continuesSession(undefined, t0));

      let s = newSession(t0);
      s = recordAnswer(s, { id: "typed:C4", correct: true, latencyMs: 800, at: t0 + 1000 });
      s = recordAnswer(s, { id: "typed:C4", correct: false, latencyMs: 900, at: t0 + 2000 });
      s = recordAnswer(s, { id: "typed:C4", correct: true, latencyMs: 700, at: t0 + 3000 });
      s = recordAnswer(s, { id: "typed:C4", correct: true, latencyMs: NaN, at: t0 + 4000 });
      eq("a session starts with nothing in it", Object.keys(newSession(t0).cards).length, 0);
      eq("four trials on the one note", s.cards["typed:C4"].n, 4);
      eq("three of them right", s.cards["typed:C4"].correct, 3);
      eq("two of them timed", s.cards["typed:C4"].ms.join(), "800,700");
      eq("and the session moves with the last answer", s.lastAt, t0 + 4000);
      eq("recordAnswer does not mutate", newSession(t0).cards.hasOwnProperty("typed:C4"), false);

      const summary = summarise(s.cards["typed:C4"]);
      eq("accuracy is over trials, not over timings", summary.accuracy, 0.75);
      eq("the median is of the timings", summary.medianMs, 750);
    }
    {
      const day = 86_400_000;
      // Anchored to the day the test runs on, so "today" means the same
      // thing wherever in the world it is run.
      const now = startOfDay(Date.now()) + 15 * 3_600_000;
      const at = (when, id) => ({
        started: when,
        lastAt: when,
        cards: { [id]: { n: 10, correct: 8, ms: [500, 700, 900] } },
      });
      const sessions = [
        at(now - 40 * day, "typed:C4"),
        at(now - 20 * day, "typed:D4"),
        at(now - 3 * day, "typed:E4"),
        at(now - 4 * 3_600_000, "typed:F4"),
      ];
      eq("today is the last one only", sessionsIn(sessions, "today", now).length, 1);
      eq("last 7 days", sessionsIn(sessions, "week", now).length, 2);
      eq("last 30 days", sessionsIn(sessions, "month", now).length, 3);
      eq("all time", sessionsIn(sessions, "all", now).length, 4);
      eq("four windows offered", WINDOWS.length, 4);
      ok("and a sitting is not one of them", !WINDOWS.some((w) => w.key === "session"));

      // Yesterday is what today is measured against, and it starts at the
      // midnight before the one today starts at.
      const yesterday = previousRange("today", now);
      eq("yesterday ends where today begins", yesterday.to, startOfDay(now));
      eq("and lasts a day", startOfDay(now) - yesterday.from, day);
      eq("the week before the week", previousRange("week", now).to, now - 7 * day);
      eq("and it is a week long", previousRange("week", now).to - previousRange("week", now).from, 7 * day);
      eq("all time has nothing before it", previousRange("all", now), null);
      eq("and nothing in it", sessionsBetween(sessions, null).length, 0);

      const totals = totalsByCard(sessionsIn(sessions, "month", now));
      eq("one row per note touched", totals.size, 3);
      const sum = overall(totals);
      eq("trials add up across sessions", sum.n, 30);
      eq("and so do the right ones", sum.correct, 24);
      eq("the median pools every timing", sum.medianMs, 700);
    }
    {
      // The same note in two sessions is one row, with both lots of times.
      const totals = totalsByCard([
        { started: 1, lastAt: 1, cards: { "typed:C4": { n: 2, correct: 2, ms: [900, 800] } } },
        { started: 2, lastAt: 2, cards: { "typed:C4": { n: 3, correct: 1, ms: [600] } } },
      ]);
      const c = summarise(totals.get("typed:C4"));
      eq("trials from both", c.n, 5);
      eq("timings from both", c.medianMs, 800);
      eq("and accuracy over the lot", c.accuracy, 0.6);
    }

    // --- weighting -------------------------------------------------------

    const settled = (ewma, errorRate = 0) => ({ ewma, errorRate, seen: 10, lastTrial: 0 });

    ok(
      "a slow note outweighs a fast one",
      weight(settled(2000), 100) > weight(settled(500), 100),
    );
    {
      const ratio = weight(settled(2000), 100) / weight(settled(1000), 100);
      near("the weight is quadratic in latency, not linear", ratio, 4, 0.01);
    }
    ok(
      "errors add weight on top of latency",
      weight(settled(1000, 0.5), 100) > weight(settled(1000, 0), 100),
    );
    near(
      "a note always missed is worth 1 + ERROR_WEIGHT of one never missed",
      weight(settled(1000, 1), 1000) / weight(settled(1000, 0), 1000),
      1 + ERROR_WEIGHT,
    );
    {
      // A single miss on a note you had been getting right. Three clean
      // answers first, because at two the explore floor is still holding the
      // weight up and the ratio would be measuring that instead. Both cards
      // are read at the same gap, because the recency and starvation factors
      // are both functions of it and neither is what this is measuring —
      // weighed one trial apart, the starvation terms differ and the ratio
      // comes out 0.2% off.
      let c = record(newCard(), { correct: true, latencyMs: 700, trial: 0 });
      c = record(c, { correct: true, latencyMs: 700, trial: 1 });
      c = record(c, { correct: true, latencyMs: 700, trial: 2 });
      const missed = record(c, { correct: false, latencyMs: 900, trial: 3 });
      const atSameGap = (card) => weight({ ...card, lastTrial: 0 }, 1000);
      near(
        "one miss multiplies a note's weight by 1 + ALPHA * ERROR_WEIGHT",
        atSameGap(missed) / atSameGap(c),
        1 + ALPHA * ERROR_WEIGHT,
      );
      ok(
        "a miss leaves a fast note below a much slower clean one",
        weight(missed, 1000) < weight(settled(2000), 1000),
      );
    }
    eq("a note just shown has zero weight", weight(settled(9000), 0), 0);

    // Waiting counts for something, or a note you know well can sit out a
    // whole sitting: the squared latency term puts middle C at under 2% of
    // the draw, and 2% of a hundred notes is sometimes none of them.
    {
      const waiting = (gap) => weight(settled(1000), gap);
      near(
        "waiting three times the starve time is worth five times waiting once",
        waiting(3 * STARVE_TAU) / waiting(STARVE_TAU),
        5,
        0.01,
      );
      ok("and waiting longer is always worth more", waiting(300) > waiting(200));
      ok(
        "a note never asked is new rather than starving",
        Number.isFinite(weight(newCard(), 0)) && weight(newCard(), 0) > 0,
      );
      ok(
        "a note just shown is still worth nothing, however long it waited before",
        weight({ ewma: 1000, errorRate: 0, seen: 10, lastTrial: 500 }, 500) === 0,
      );
    }

    {
      // The guarantee, as behaviour: the fastest note in a set cannot be
      // skipped indefinitely. Without the starvation term this run leaves it
      // unseen for 248 trials at worst; the bound below is what the term
      // holds it to, with room for the constants to move a little.
      const ids = ["fast", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
      const ewmas = { fast: 600, a: 900, b: 950, c: 1000, d: 1100, e: 1200,
        f: 1400, g: 1500, h: 1600, i: 1700, j: 1800 };
      const cards = new Map(
        ids.map((id) => [id, { ewma: ewmas[id], errorRate: 0, seen: 40, lastTrial: -1 }]),
      );
      const rand = seeded(7);
      let worst = 0;
      let shown = 0;
      for (let t = 0; t < 3000; t++) {
        const hit = pick(cards, ids, t, rand);
        worst = Math.max(worst, t - cards.get("fast").lastTrial);
        cards.set(hit, { ...cards.get(hit), lastTrial: t });
        if (hit === "fast") shown += 1;
      }
      ok(`the fastest note is never starved out (worst gap ${worst})`, worst < 150);
      ok("but it is still asked for least often", shown / 3000 < 0.05);
    }
    {
      // At this ewma the base weight is exactly 1, so dividing the starvation
      // factor back out leaves the recency factor on its own — which is the
      // one being asserted, and which a comparison against a far-off trial
      // would no longer isolate.
      const starve = (gap) => 1 + (gap / STARVE_TAU) ** 2;
      const recency = (gap) => weight(settled(1000), gap) / starve(gap);
      ok("a note just shown is suppressed", recency(1) < 0.4);
      near("and is eligible again within a few trials", recency(12), 1, 0.05);
    }
    ok(
      "an unseen note is explored even though it looks cheap",
      weight({ ewma: 200, errorRate: 0, seen: 0, lastTrial: -Infinity }, 100) >= 4,
    );

    // --- hearing a piano -------------------------------------------------

    const SR = 48000;

    /** A pure tone, for the cases where the harmonics are beside the point. */
    function sine(hz, n = WINDOW, sr = SR) {
      const buf = new Float32Array(n);
      for (let i = 0; i < n; i++) buf[i] = Math.sin((2 * Math.PI * hz * i) / sr);
      return buf;
    }

    /**
     * Something close enough to a piano string to be a fair test: harmonics
     * at 1/n, stretched by the inharmonicity a real string has, each at its
     * own phase, decaying, over a noise floor. `fundamental` scales the
     * first partial alone — a low piano note's fundamental is often quieter
     * than the harmonics above it, which is what breaks naive detectors.
     */
    function pianoish(hz, { fundamental = 1, B = 2e-4, noise = 0.02, seed = 1, n = WINDOW, sr = SR } = {}) {
      const rand = seeded(seed);
      const buf = new Float32Array(n);
      const phases = Array.from({ length: 12 }, () => rand() * 2 * Math.PI);
      for (let p = 1; p <= 12; p++) {
        const fn = p * hz * Math.sqrt(1 + B * p * p);
        if (fn > sr * 0.475) break;
        const amp = (p === 1 ? fundamental : 1) / p;
        for (let i = 0; i < n; i++) {
          buf[i] += amp * Math.sin((2 * Math.PI * fn * i) / sr + phases[p - 1]);
        }
      }
      let peak = 0;
      for (let i = 0; i < n; i++) {
        buf[i] *= Math.exp((-1.5 * i) / sr);
        buf[i] += noise * (rand() * 2 - 1);
        peak = Math.max(peak, Math.abs(buf[i]));
      }
      for (let i = 0; i < n; i++) buf[i] /= peak;
      return buf;
    }

    near("rms of a full-scale sine is 1/√2", rms(sine(440)), Math.SQRT1_2, 1e-3);
    eq("rms of silence is zero", rms(new Float32Array(WINDOW)), 0);
    near("a pure tone is found exactly", detectPitch(sine(440), SR), 440, 0.5);
    near("and so is one at the bottom of the range", detectPitch(sine(65.41), SR), 65.41, 0.5);

    eq("concert A is MIDI 69", midiFor(440), 69);
    near("and is dead in tune", centsOff(440), 0, 1e-9);

    // A piano well off concert pitch: without allowing for it, the nearest
    // note is the wrong one, which is a half step of error out of nowhere.
    {
      const flat = 440 * Math.pow(2, -70 / 1200);
      eq("70 cents flat reads as the note below", midiFor(flat), 68);
      eq("unless the instrument's tuning is known", midiFor(flat, -70), 69);
      near("and then it is in tune with itself", centsOff(flat, -70), 0, 1e-9);
    }

    {
      const { hz, clarity } = analyse(sine(440), SR);
      near("analyse agrees with detectPitch", hz, 440, 0.5);
      ok("a pure tone is as clear as it gets", clarity > 0.99, `got ${clarity}`);
    }
    {
      const rand = seeded(23);
      const noise = new Float32Array(WINDOW);
      for (let i = 0; i < WINDOW; i++) noise[i] = rand() * 2 - 1;
      ok("noise is not remotely clear", analyse(noise, SR).clarity < 0.2);
    }
    eq("middle C is MIDI 60 by ear", midiFor(261.626), 60);
    eq("a note 30 cents sharp is still that note", midiFor(440 * Math.pow(2, 0.3 / 12)), 69);
    ok("nothing has no pitch", Number.isNaN(midiFor(0)) && Number.isNaN(midiFor(NaN)));

    ok("silence is not a note", Number.isNaN(detectPitch(new Float32Array(WINDOW), SR)));
    {
      const rand = seeded(11);
      const noise = new Float32Array(WINDOW);
      for (let i = 0; i < WINDOW; i++) noise[i] = rand() * 2 - 1;
      ok("noise is not a note", Number.isNaN(detectPitch(noise, SR)));
    }

    // The whole point: every note the drill can draw, heard correctly, in
    // the octave it was played in. An octave error is the failure that would
    // make answering from a real piano useless.
    {
      const dns = [...rangeFor(CLEFS.bass, 2), ...rangeFor(CLEFS.treble, 2)];
      const cases = [
        ["a piano tone", {}],
        ["a weak fundamental", { fundamental: 0.15 }],
        ["a very inharmonic string", { B: 1e-3, fundamental: 0.3, seed: 5 }],
      ];
      for (const [what, opts] of cases) {
        const wrong = [];
        for (const dn of new Set(dns)) {
          const expected = toMidi(dn);
          const hz = 440 * Math.pow(2, (expected - 69) / 12);
          const heard = midiFor(detectPitch(pianoish(hz, opts), SR));
          if (heard !== expected) wrong.push(`${label(dn)} heard as ${heard}`);
        }
        check(`every note in range is heard right: ${what}`, wrong.length === 0, wrong.join("; "));
      }
    }

    // --- what the tuning run concludes -----------------------------------

    {
      // Readings a few cents apart are a piano at concert pitch: a stretched
      // tuning varies by more than this between registers on its own.
      const small = tuningOffset([0, -5, -9, -2, -7]);
      eq("a handful of cents is nothing to correct", small.cents, 0);
      eq("but what was measured is still reported", small.measured, -5);
      eq("along with how much the notes disagreed", small.spread, 9);
    }
    {
      const flat = tuningOffset([-46, -38, -41, -35, -44]);
      eq("a properly flat piano is corrected", flat.cents, -41);
      eq("and the spread says how trustworthy that is", flat.spread, 11);
    }
    ok(
      "the deadband is wide enough to cover octave stretch",
      TUNING_DEADBAND_CENTS >= 15 && TUNING_DEADBAND_CENTS < 50,
    );
    ok(
      "a reading has to be nearer one note than the next to count as it",
      AMBIGUOUS_CENTS > TUNING_DEADBAND_CENTS && AMBIGUOUS_CENTS < 50,
    );
    {
      // Halfway between F4 and F sharp 4 is nobody's note.
      const between = 349.23 * Math.pow(2, 48 / 1200);
      ok("a reading halfway up a semitone is refused", Math.abs(centsOff(between)) > AMBIGUOUS_CENTS);
      const nearly = 349.23 * Math.pow(2, 20 / 1200);
      ok("one a fifth of the way is accepted", Math.abs(centsOff(nearly)) <= AMBIGUOUS_CENTS);
    }
    {
      // One wild note must not drag the answer: the median ignores it.
      const odd = tuningOffset([-40, -38, 180, -42, -39]);
      eq("a single bad reading is outvoted", odd.cents, -39);
      ok("though the spread gives it away", odd.spread > 200);
    }

    // --- hearing when it was played --------------------------------------

    ok("a strike out of silence is an onset", isOnset(0.2, 0.001, 0.001));
    ok("the room's own hiss is not", !isOnset(0.0009, 0.0008, 0.0008));
    ok("a note struck over a ringing one is an onset", isOnset(0.29, 0.15, 0.001));

    ok("the room estimate follows quiet down quickly", nextNoiseFloor(0.001, 0.05) < 0.04);
    ok("and loud up slowly", nextNoiseFloor(0.3, 0.001) < 0.002);
    eq("the threshold never falls to nothing", onsetThreshold(0), SILENCE_FLOOR);

    /** Frames an onset fired on, for a sequence of per-frame levels. */
    function onsets(levels) {
      let peak = 0;
      let floor = NOISE_INITIAL;
      const fired = [];
      levels.forEach((level, frame) => {
        if (isOnset(level, peak, floor)) fired.push(frame);
        peak = nextPeak(level, peak);
        floor = nextNoiseFloor(level, floor);
      });
      return fired;
    }

    {
      // A microphone across the room from a quiet upright. Every level here
      // is below the fixed threshold this used to have, which is the whole
      // reason the threshold is no longer fixed.
      const room = 0.0008;
      const levels = Array(120).fill(room);
      for (let i = 0; i < 90; i++) levels.push(room + 0.004 * Math.exp((-1.5 * i) / 60));
      const fired = onsets(levels);
      eq("a quiet microphone still hears a note struck", fired.length, 1);
      eq("on the frame it was struck", fired[0], 120);
    }
    {
      // A note decaying on its own must never read as a new note, however
      // long it rings: that would answer the next trial by itself.
      let peak = 0.3;
      let level = 0.3;
      let floor = 0.001;
      let spurious = 0;
      for (let frame = 0; frame < 120; frame++) {
        level *= Math.exp(-1.5 / 60);
        if (isOnset(level, peak, floor)) spurious++;
        peak = nextPeak(level, peak);
        floor = nextNoiseFloor(level, floor);
      }
      eq("a decaying note never re-triggers", spurious, 0);
    }

    {
      const n = WINDOW;
      const attack = 3000;
      const buf = new Float32Array(n);
      const tone = sine(220, n - attack);
      for (let i = 0; i < tone.length; i++) buf[attack + i] = tone[i] * Math.exp((-1.5 * i) / SR);
      const found = attackIndex(buf, SR);
      ok(
        "the attack is located within a block or two",
        Math.abs(found - attack) <= 2 * 128,
        `found ${found}, want ${attack}`,
      );
    }
    eq("an envelope covers the window", envelope(new Float32Array(WINDOW)).length, WINDOW / 128);

    // --- strikes, over time ----------------------------------------------
    //
    // The detector fed a performance: notes struck at given times and
    // loudnesses, each ringing on (or damped when released) over a little
    // room noise, handed over a frame at a time the way the page does.
    // What is asserted is what the strike log depends on — that a strike is
    // answered or explained, and not silently dropped.

    {
      const FRAME = 800; // 60 frames a second at 48kHz
      const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

      /**
       * @param {{midi?: number, knock?: boolean, at: number, loud?: number, off?: number,
       *   rise?: number}[]} notes
       *   times in seconds; `loud` scales the note, `off` damps it, `rise` is
       *   how long its attack takes — a soft hammer is slow. A knock is
       *   no note but 20ms of noise — a key going down before its hammer
       *   reaches the string, or a damper landing.
       * @param {number} seconds
       * @param {{noise?: number, fps?: number}} [room] peak amplitude of the
       *   noise under it all, and the display's frame rate
       */
      function perform(notes, seconds, { noise = 0.002, fps = 60 } = {}) {
        const sig = new Float32Array(Math.ceil(seconds * SR));
        const knocks = seeded(4);
        for (const { midi, knock, at, loud = 1, off = Infinity, rise = 0.004 } of notes) {
          if (knock) {
            for (let i = Math.floor(at * SR); i < Math.min(sig.length, (at + 0.02) * SR); i++) {
              sig[i] += 0.1 * loud * (knocks() * 2 - 1) * Math.exp(-(i / SR - at) / 0.006);
            }
            continue;
          }
          const hz = midiHz(midi);
          for (let i = Math.floor(at * SR); i < sig.length; i++) {
            const t = i / SR - at;
            let env = loud * Math.exp(-t / 0.8) * Math.min(1, t / rise);
            if (i / SR > off) env *= Math.exp(-(i / SR - off) / 0.06);
            let s = 0;
            for (let p = 1; p <= 6; p++) s += Math.sin(2 * Math.PI * hz * p * Math.sqrt(1 + 2e-4 * p * p) * t) / p;
            sig[i] += 0.1 * env * s;
          }
        }
        const rand = seeded(9);
        for (let i = 0; i < sig.length; i++) sig[i] += (rand() - 0.5) * noise;

        const detector = createDetector(SR);
        const strikes = [];
        for (let f = 0; ; f++) {
          const end = Math.round(WINDOW + (f * SR) / fps);
          if (end > sig.length) break;
          const now = (end / SR) * 1000;
          for (const s of detector.frame(sig.subarray(end - WINDOW, end), now).strikes) {
            strikes.push({ ...s, now });
          }
        }
        return strikes;
      }
      const kinds = (strikes) =>
        strikes.map((s) => (s.kind === "heard" ? `heard ${midiFor(s.hz)}` : s.kind)).join(", ");

      eq("the room on its own is never a strike", perform([], 2).length, 0);

      const one = perform([{ midi: 60, at: 1 }], 3);
      eq("a note over silence is one strike, the note", kinds(one), "heard 60");
      ok("timed at its attack", Math.abs(one[0].at - 1000) < 20, `at ${one[0].at}`);
      eq("and ringing on for two seconds adds nothing", one.length, 1);

      eq("a note too quiet to answer is said to be", kinds(perform([{ midi: 60, at: 1, loud: 0.01 }], 2)),
        "quiet");

      eq("a note after the last has been let go is heard",
        kinds(perform([{ midi: 60, at: 1, off: 1.5 }, { midi: 64, at: 1.9 }], 3)), "heard 60, heard 64");

      // Struck as hard as the note still ringing, the next note enters the
      // level a few frames at a time and never jumps by ONSET_RATIO in one.
      // The spectrum is what sees it, and the rise in the spectrum is what
      // reads it: the period finder alone called E4 over C4 C2.
      for (const gap of [0.15, 0.25, 0.4, 0.6]) {
        const line = perform([{ midi: 60, at: 1 }, { midi: 64, at: 1 + gap }], 3);
        eq(`a note struck ${gap * 1000}ms into a ringing one is heard`, kinds(line), "heard 60, heard 64");
      }
      {
        const line = perform([{ midi: 60, at: 1 }, { midi: 64, at: 1.4 }], 3);
        ok("timed at its own attack, not the ringing note's", Math.abs(line[1].at - 1400) < 15,
          `at ${line[1].at}`);
        ok("and in tune", Math.abs(centsOff(line[1].hz)) < 10, `${centsOff(line[1].hz)}¢`);
      }
      eq("so is one a quarter as loud as the note it is struck over",
        kinds(perform([{ midi: 60, at: 1 }, { midi: 64, at: 1.4, loud: 0.25 }], 3)), "heard 60, heard 64");
      eq("and the same note struck again",
        kinds(perform([{ midi: 60, at: 1 }, { midi: 60, at: 1.5 }], 3)), "heard 60, heard 60");
      eq("and every note of a line played legato",
        kinds(perform([60, 64, 62, 67].map((midi, i) => ({ midi, at: 1 + i * 0.35 })), 3.5)),
        "heard 60, heard 64, heard 62, heard 67");
      // A clean signal is not an easy one. With next to no noise, ordinary
      // frames' flux falls to 2 or 3, and 2.5 times that is a note decaying:
      // without a floor under it every note set off phantom strikes, read off
      // a partial — F4 as C6.
      eq("a line over a silent room is its notes and nothing else",
        kinds(perform([60, 62, 64, 65].map((midi, i) => ({ midi, at: 0.5 + i * 0.3 })), 3, { noise: 0 })),
        "heard 60, heard 62, heard 64, heard 65");
      // What a real piano, recorded, taught.
      eq("a display refreshing at 120Hz hears a legato line as well as one at 60",
        kinds(perform([60, 64, 62, 67].map((midi, i) => ({ midi, at: 1 + i * 0.35 })), 3.5, { fps: 120 })),
        "heard 60, heard 64, heard 62, heard 67");
      // At 120Hz a slow attack's rise in the spectrum comes a little per frame,
      // each frame's share under FLUX_MIN. Measured from 15ms back, it is one.
      eq("a soft, slow strike over a ringing note is heard at 120Hz",
        kinds(perform([{ midi: 60, at: 1 }, { midi: 64, at: 1.4, loud: 0.05, rise: 0.02 }], 3, { fps: 120 })),
        "heard 60, heard 64");
      {
        // Played softly, a key and its hammer are heard a tenth of a second
        // before the string.
        const soft = perform([
          { midi: 60, at: 1 },
          { knock: true, at: 1.5, loud: 0.06 },
          { midi: 64, at: 1.6, loud: 0.3 },
        ], 3);
        eq("a key heard before its string is one note, not two", kinds(soft), "heard 60, heard 64");
        ok("timed from the string, not the key", Math.abs((soft[1]?.at ?? 0) - 1600) < 20, `at ${soft[1]?.at}`);
      }
      ok("a damper landing on a ringing note names no note",
        !kinds(perform([{ midi: 60, at: 1 }, { knock: true, at: 1.5, loud: 0.15 }], 3)).includes("heard 60, heard"),
        kinds(perform([{ midi: 60, at: 1 }, { knock: true, at: 1.5, loud: 0.15 }], 3)));
      eq("a soft note on a quiet signal, barely over the room, is heard",
        kinds(perform([{ midi: 60, at: 1, loud: 0.05 }, { midi: 64, at: 1.5, loud: 0.03 }], 3, { noise: 0.004 })),
        "heard 60, heard 64");
      eq("and of one falling through the bass clef",
        kinds(perform([55, 52, 48, 45].map((midi, i) => ({ midi, at: 1 + i * 0.4 })), 3.5)),
        "heard 55, heard 52, heard 48, heard 45");

      // The pieces, on their own. E4's harmonics account for what E4 added;
      // so do C2's, which include every one of them, and C2 is marked down
      // for the harmonics it has that are not there.
      {
        const sig = new Float32Array(SR);
        const add = (midi, from, loud) => {
          const hz = midiHz(midi);
          for (let i = Math.floor(from * SR); i < sig.length; i++) {
            const t = i / SR - from;
            let s = 0;
            for (let p = 1; p <= 6; p++) s += Math.sin(2 * Math.PI * hz * p * t) / p;
            sig[i] += 0.1 * loud * Math.exp(-t / 0.8) * s;
          }
        };
        add(60, 0, 1);
        add(64, 0.5, 1);
        const at = (s) => sig.slice(Math.round(s * SR) - WINDOW, Math.round(s * SR));
        const before = at(0.49);
        const now = at(0.62);
        const over = analyseOver(now, before, SR);
        ok("a note struck over another is read against what it added",
          Math.abs(centsBetween(over.hz, midiHz(64))) < 10, `${over.hz.toFixed(1)}Hz`);
        ok("where the period finder alone hears the chord's common period",
          midiFor(analyse(now, SR).hz) !== 64, `${analyse(now, SR).hz.toFixed(1)}Hz`);
        const rise = magnitudes(now).map((m, i) => Math.max(0, m - magnitudes(before)[i]));
        ok("and the true note accounts for more of the rise than its subharmonic",
          harmonicShare(rise, midiHz(64), SR) > harmonicShare(rise, midiHz(64) / 5, SR));
      }

      // A debug recording: the audio, with the log in a chunk of its own.
      {
        const pcm = Int16Array.from({ length: 1000 }, (_, i) => Math.round(Math.sin(i / 10) * 20000));
        const file = decodeWav(encodeWav(pcm, 44100, JSON.stringify({ frames: [[1, 2]], note: "E4 é" })));
        eq("a recording keeps its sample rate", file.samples.length === 1000 && file.sampleRate, 44100);
        near("and its samples", file.samples[123], pcm[123] / 32768, 1e-6);
        eq("and carries its log", JSON.parse(file.log).note, "E4 é");
        eq("an odd-length log is padded and still read back",
          JSON.parse(decodeWav(encodeWav(pcm, 48000, '{"x":"ab"}')).log).x, "ab");
        eq("a recording with no log has an empty one", decodeWav(encodeWav(pcm, 48000)).log, "");
      }

      // Following a known line round and round, for testing by ear.
      {
        const line = [60, 62, 64, 65];
        const marks = (index, midi) =>
          followLine(line, index, midi).marks.map((m) => `${m.at}:${m.result}`).join(" ");
        eq("the note expected is heard", marks(0, 60), "0:heard");
        eq("and the line moves on", followLine(line, 0, 60).index, 1);
        eq("the note after it means the one expected was missed", marks(1, 64), "1:missed 2:heard");
        eq("and moves on past both", followLine(line, 1, 64).index, 3);
        eq("anything else was heard wrong", marks(2, 67), "2:wrong");
        eq("and does not hold the line up", followLine(line, 2, 67).index, 3);
        eq("the last note leads back to the first", followLine(line, 3, 65).index, 0);
        eq("and a miss there wraps too", marks(3, 60), "3:missed 0:heard");
      }

      near("the bar is the room's threshold with nothing ringing", onsetBar(0, NOISE_INITIAL),
        NOISE_INITIAL * 3);
      near("and a step over what is", onsetBar(0.5, 0), 0.5 * ONSET_RATIO);
    }

    // --- picking ---------------------------------------------------------

    {
      const cards = new Map([
        ["fast", settled(400)],
        ["slow", settled(2400)],
      ]);
      cards.get("fast").lastTrial = -Infinity;
      cards.get("slow").lastTrial = -Infinity;
      const rand = seeded(42);
      let slowCount = 0;
      for (let i = 0; i < 2000; i++) {
        if (pick(cards, ["fast", "slow"], 100, rand) === "slow") slowCount++;
      }
      const share = slowCount / 2000;
      ok("the slow note comes up far more often", share > 0.9, `share was ${share.toFixed(3)}`);
    }
    {
      // Everything identical and one of them just shown: it must not repeat.
      const cards = new Map([
        ["a", { ewma: 1000, errorRate: 0, seen: 5, lastTrial: 9 }],
        ["b", { ewma: 1000, errorRate: 0, seen: 5, lastTrial: 2 }],
        ["c", { ewma: 1000, errorRate: 0, seen: 5, lastTrial: 2 }],
      ]);
      const rand = seeded(7);
      let repeats = 0;
      for (let i = 0; i < 500; i++) if (pick(cards, ["a", "b", "c"], 9, rand) === "a") repeats++;
      eq("a note is never shown twice in a row", repeats, 0);
    }
    {
      // Single-note range, just shown: all weights are zero, so fall back
      // rather than throwing.
      const cards = new Map([["a", { ewma: 1000, errorRate: 0, seen: 5, lastTrial: 3 }]]);
      eq("a single-note range still returns something", pick(cards, ["a"], 3, seeded(1)), "a");
    }
    {
      const cards = new Map();
      ok("unseen ids are handled without pre-seeding", pick(cards, ["x", "y"], 0, seeded(3)) !== undefined);
    }

    // --- decay -----------------------------------------------------------

    {
      const c = settled(600);
      eq("no elapsed time means no decay", decay(c, 0).ewma, 600);
      ok("a week away makes a note look harder", decay(c, 7).ewma > 600);
      ok("more time decays further", decay(c, 30).ewma > decay(c, 7).ewma);
      ok("but never past the prior", decay(c, 10000).ewma <= PRIOR_MS + 1e-9);
      ok("a note already at the prior stays there", Math.abs(decay(settled(PRIOR_MS), 50).ewma - PRIOR_MS) < 1e-9);
    }

    // --- lines of notes --------------------------------------------------

    {
      const C4 = diatonic("C", 4);
      eq("four notes have 24 orders", permutations([1, 2, 3, 4]).length, 24);
      eq("and all of them are different", new Set(permutations([1, 2, 3, 4]).map(String)).size, 24);
      ok("two leaps up in a row are never written",
        contourWeight([C4, C4 + LEAP, C4 + 2 * LEAP]) === 0);
      ok("nor two down", contourWeight([C4 + 2 * LEAP, C4 + LEAP, C4]) === 0);
      ok("a leap and back is fine", contourWeight([C4, C4 + 4, C4 + 1]) > 0);
      ok("a third is worth more than a sixth",
        contourWeight([C4, C4 + 2]) > contourWeight([C4, C4 + 5]));
      ok("a straight run of steps is allowed but made rare",
        contourWeight([C4, C4 + 1, C4 + 2]) > 0 &&
          contourWeight([C4, C4 + 1, C4 + 2]) < contourWeight([C4, C4 + 2, C4 + 1]));

      // Arranged over many draws, the forbidden shape never appears and the
      // same notes do not always come out in the same order.
      const rand = seeded(11);
      const spread = [C4, C4 + 3, C4 + 6, C4 + 9];
      const seen = new Set();
      let broken = 0;
      for (let i = 0; i < 500; i++) {
        const order = arrange(spread, rand);
        seen.add(String(order));
        if (contourWeight(order) === 0) broken += 1;
        if (order.slice().sort((a, b) => a - b).join() !== spread.join()) broken += 1;
      }
      eq("arranging only reorders, and never into a forbidden contour", broken, 0);
      ok("and does not always pick the same order", seen.size > 3, `${seen.size} orders`);
    }
    {
      const ids = candidateIds(BOTH_CLEFS, 2, 0, 1000, "typed");
      const rand = seeded(5);
      let wide = 0;
      let repeated = 0;
      let short = 0;
      for (let t = 0; t < 300; t++) {
        const line = chooseLine(new Map(), ids, t, 4, rand);
        const dns = line.map(cardPitch);
        if (Math.max(...dns) - Math.min(...dns) > SEQUENCE_SPAN) wide += 1;
        if (new Set(line).size !== line.length) repeated += 1;
        if (line.length !== 4) short += 1;
        if (!line.every((id) => ids.includes(id))) repeated += 1;
      }
      eq("a line stays inside a tenth", wide, 0);
      eq("holds no note twice, and only eligible ones", repeated, 0);
      eq("and is as long as asked when the range allows", short, 0);

      const two = ids.slice(0, 2);
      eq("a range smaller than the line gives a shorter line", chooseLine(new Map(), two, 0, 4, rand).length, 2);
      eq("a line of one is one note", chooseLine(new Map(), ids, 0, 1, rand).length, 1);

      // The scheduler still chooses: a note far slower than the rest turns up
      // in most lines.
      const cards = new Map(ids.map((id) => [id, { ...newCard(), ewma: 600, seen: 10, timed: 10 }]));
      const slow = cardId(diatonic("G", 4), "typed");
      cards.set(slow, { ...newCard(), ewma: 3000, seen: 10, timed: 10 });
      let hits = 0;
      for (let t = 0; t < 200; t++) if (chooseLine(cards, ids, t, 3, rand).includes(slow)) hits += 1;
      // Evenly weighted, one note of 29 would be in about one line in eight.
      ok("the scheduler's weights still choose the notes", hits > 100, `${hits} of 200 lines`);
    }
    {
      const inkRight = 10 + Math.max(inkExtent(GLYPH.gClef).right, inkExtent(GLYPH.fClef).right);
      const middle = (xs) => (xs[0] + xs.at(-1) + NOTEHEAD_WIDTH) / 2;
      near("a single note sits in the middle of the staff", middle(lineXs(1)), 150);
      near("and so do two", middle(lineXs(2)), 150);
      near("three are centred between the clef and the end of the staff",
        lineXs(3)[0] - inkRight, 300 - (lineXs(3)[2] + NOTEHEAD_WIDTH));
      near("and so are four", lineXs(4)[0] - inkRight, 300 - (lineXs(4)[3] + NOTEHEAD_WIDTH));
      near("spaced evenly", lineXs(3)[2] - lineXs(3)[1], LINE_SPACING);
      ok("the first of four clears the clefs, ledger lines and all",
        lineXs(4)[0] - 4 > inkRight, `${lineXs(4)[0] - 4} against ${inkRight}`);
      ok("and the last of four ends inside the staff, ledger lines and all",
        lineXs(4)[3] + NOTEHEAD_WIDTH + 4 < 300, `${lineXs(4)[3] + NOTEHEAD_WIDTH + 4}`);
      eq("a clef's ink is measured sideways too", inkExtent(GLYPH.fClef).right, 27.36);

      const svg = document.createElementNS("", "svg");
      const dns = [diatonic("C", 4), diatonic("E", 4), diatonic("A", 3)];
      const drawn = renderLine(svg, dns, BOTH_CLEFS);
      eq("every note of the line is drawn", drawn.heads.length, 3);
      eq("the cursor starts on the first", drawn.heads.map((h) => h.getAttribute("aria-current")).join(),
        "true,false,false");
      markLive(drawn, 2);
      eq("and moves along", drawn.heads.map((h) => h.getAttribute("aria-current")).join(), "false,false,true");
      near("sitting behind the note it marks",
        Number(drawn.cursor?.getAttribute("x")) + Number(drawn.cursor?.getAttribute("width")) / 2,
        lineXs(3)[2] + NOTEHEAD_WIDTH / 2);
      eq("a single note has no cursor", renderLine(svg, [dns[0]], BOTH_CLEFS).cursor, null);
    }

    // --- median ----------------------------------------------------------

    eq("median of an odd-length list", median([3, 1, 2]), 2);
    eq("median of an even-length list", median([4, 1, 2, 3]), 2.5);
    ok("median of nothing is NaN", Number.isNaN(median([])));
    {
      const xs = [3, 1, 2];
      median(xs);
      eq("median does not sort its argument in place", xs[0], 3);
    }

  return { passed, failed };
}
