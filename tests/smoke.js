// Boot the whole app against the fiction in browser-stub.js and check that it
// comes up, then answer a few notes and check the record follows.
//
// Not a substitute for opening the page: it cannot see a pixel of CSS. What it
// is for is the mistake that a browser would show you only by drawing nothing
// — an element index.html no longer has, a function an edit deleted, a paint
// that throws on a fresh record.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { install } from "./browser-stub.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "index.html"), "utf8");
const dom = install(page);

const problems = [];
let checked = 0;
const check = (what, ok, detail = "") => {
  checked += 1;
  if (!ok) problems.push(detail ? `${what}  — ${detail}` : what);
};

// One MIDI keyboard, for the app to find when it asks.
const keyboard = { name: "Stub keys", onmidimessage: null };
navigator.requestMIDIAccess = async () => ({ inputs: new Map([["k", keyboard]]), onstatechange: null });
const pressMidi = (note) => keyboard.onmidimessage({ data: [0x90, note, 100] });

// Importing app.js is what boots it: the module ends by calling init().
await import("../app.js");
dom.flushFrames();

const text = (id) => dom.el(id)?.textContent ?? "";

check("the page starts up", !text("verdict").startsWith("Could not start"), text("verdict"));
check("the answer keyboard is built", dom.el("answers").children.length === 7,
  `${dom.el("answers").children.length} keys`);
check("a note is drawn", dom.el("staff").children.length > 0);
check("the staff is sized", (dom.el("staff").getAttribute("viewBox") ?? "").split(" ").length === 4);
check("the record invites a first answer", text("stats").includes("Press a letter"), text("stats"));
check("the tabs are built", dom.el("tabstrip").children.length === 4);
check("the player has a name", text("player-name").length > 0);
check("nothing is listening, so the strike log is hidden", dom.el("listen").hidden);
check("and there is nothing to test with", dom.el("check").disabled && dom.el("checking").hidden);
check("the menus start shut", dom.el("settings-menu").hidden && dom.el("play-menu").hidden);
check("the cheat sheet says what is in play", text("cheat-count").includes("in play"), text("cheat-count"));

// Which letter is being asked: the notehead the cursor is on, its y read back
// through the pitch model.
const notes = await import("../notes.js");
const heads = () =>
  dom.el("staff").children.filter((c) => (c.getAttribute("class") ?? "").startsWith("notehead"));
function shownPitch() {
  const head = heads().find((c) => c.getAttribute("aria-current") === "true");
  const y = Number(head.getAttribute("transform").split(" ")[1].replace(")", ""));
  return notes
    .notesFor(notes.BOTH_CLEFS, 2)
    .find((d) => Math.abs(notes.grandY(d) - y) < 0.01);
}
const shownLetter = () => notes.fromDiatonic(shownPitch()).letter;
const stored = () => JSON.parse(Object.entries(dom.store).find(([k]) => k.includes("current"))[1]);
/** Every timed answer as "note<-note before", in no particular order. */
const pairs = (session) =>
  Object.entries(session.cards)
    .flatMap(([id, t]) => (t.from ?? []).map((from) => `${id.split(":")[1]}<-${from}`))
    .sort()
    .join(" ");
const press = (key) => document.dispatch("keydown", { key, preventDefault() {}, target: null });

check("a line of three is drawn by default", heads().length === 3, `${heads().length} noteheads`);

// Six answers: two lines of three. Timers are flushed only at the end of a
// line, which is the one place the drill waits.
const expectedPairs = [];
let lastPitch = null;
for (let i = 0; i < 6; i++) {
  dom.advance(700 + i * 100);
  const pitch = notes.label(shownPitch());
  if (i % 3 !== 0) expectedPairs.push(`${pitch}<-${lastPitch}`);
  lastPitch = pitch;
  press(shownLetter());
  if (i % 3 === 2) {
    dom.flushTimers();
    dom.flushFrames();
  }
}

// The first note of each line is recorded and not timed: the session's first
// answer is not timed anyway, so of six answers over two lines, four are.
{
  const session = stored();
  const tallies = Object.values(session.cards);
  const answered = tallies.reduce((n, t) => n + t.n, 0);
  const timed = tallies.reduce((n, t) => n + t.ms.length, 0);
  check("the first note of a line is not timed", answered === 6 && timed === 4,
    `${answered} answered, ${timed} timed`);
  check("the rest are timed from the answer before", tallies.flatMap((t) => t.ms).every((ms) => ms >= 800),
    tallies.flatMap((t) => t.ms).join(", "));
  check("the first note of a line keeps no note before, the rest the one before them",
    pairs(session) === expectedPairs.sort().join(" "), `${pairs(session)}, want ${expectedPairs.join(" ")}`);
}

// A miss holds the line: the cursor stays until the note is answered.
{
  const wrong = notes.LETTERS.find((l) => l !== shownLetter());
  const before = heads().findIndex((c) => c.getAttribute("aria-current") === "true");
  press(wrong);
  const held = heads().findIndex((c) => c.getAttribute("aria-current") === "true");
  press(shownLetter());
  const after = heads().findIndex((c) => c.getAttribute("aria-current") === "true");
  check("a miss holds the cursor where it is", held === before, `${before} → ${held}`);
  check("and the right answer moves it on", after === before + 1, `${before} → ${after}`);
  // The note after the miss, missed as well: neither it nor its correction is
  // a measurement, and nor is the note after that.
  const before6 = stored();
  press(notes.LETTERS.find((l) => l !== shownLetter()));
  // Finish the line, so the rows below count what they expect.
  for (let left = heads().length - after; left > 0; left--) press(shownLetter());
  dom.flushTimers();
  dom.flushFrames();
  const missedFrom = (session) => Object.values(session.cards).flatMap((t) => t.missedFrom ?? []);
  check("the notes after a miss keep no note before, right or wrong",
    pairs(stored()) === pairs(before6) && missedFrom(stored()).length === 0,
    `${pairs(stored())} · missed after ${missedFrom(stored()).join(",")}`);
}

// One note at a time is still there, and is still timed from the paint.
{
  const sequence = dom.el("sequence");
  sequence.value = "1";
  sequence.dispatch("change");
  dom.flushFrames();
  check("a line of one is a single note", heads().length === 1, `${heads().length} noteheads`);
  check("with no cursor", !dom.el("staff").children.some((c) => c.getAttribute("class") === "cursor"));
  const nulls = (session) => Object.values(session.cards).flatMap((t) => t.from ?? []).filter((f) => f === null);
  dom.advance(800);
  press(shownLetter());
  dom.flushTimers();
  dom.flushFrames();
  check("a note on its own keeps null for the note before", nulls(stored()).length === 1,
    `${nulls(stored()).length} nulls`);
}

// The cheat sheet's doubled spellings. Asserted here rather than only over
// grandScale, because what broke twice was not the engraver but the wiring:
// the ledger setting has to reach it, and a missing argument silently fell
// back to a default that doubles nothing.
{
  const ledgers = dom.el("ledgers");
  ledgers.value = "2";
  ledgers.dispatch("change");
  dom.el("cheat-toggle").dispatch("click");
  const drawn = dom.el("cheat-sheet").children[0]?.children[0]?.children[0];
  const heads = (drawn?.childNodes ?? []).filter((c) =>
    (c.getAttribute("class") ?? "").startsWith("notehead"),
  ).length;
  const all = notes.notesFor(notes.BOTH_CLEFS, 2).length;
  const shared = notes.sharedNotes(notes.BOTH_CLEFS, 2).length;
  check(
    "the cheat sheet draws both spellings of the shared notes",
    heads === all + shared,
    `${heads} noteheads for ${all} notes and ${shared} shared`,
  );
}

// The rows of the record for notes, not the breakdown open under one of them.
const noteRows = () => dom.el("breakdown").children.filter((r) => r.getAttribute("role") === "button");

// Rows for notes the range no longer asks for, faded rather than dropped.
{
  const before = noteRows().length;
  const set = (id, value) => {
    const s = dom.el(id);
    s.value = value;
    s.dispatch("change");
  };
  // Narrowed to the highest note answered so far, which is certain to leave
  // one row in and — no note being asked twice running — at least one out.
  // A fixed range used to miss every answered note now and then. What the
  // limits actually become is whatever the clef and ledger settings can draw,
  // so the test reads them back rather than assuming it got what it asked for.
  const top = Math.max(
    ...noteRows().map((r) => {
      const name = r.children[1].textContent;
      return notes.diatonic(name[0], Number(name.slice(1)));
    }),
  );
  set("lowest", String(top));
  set("highest", String(top));
  const lowest = Number(dom.el("lowest").value);
  const highest = Number(dom.el("highest").value);

  const rows = noteRows().map((r) => {
    const name = r.children[1].textContent;
    const dn = notes.diatonic(name[0], Number(name.slice(1)));
    return { name, dn, faded: (r.getAttribute("class") ?? "").includes("is-out") };
  });
  const misfiled = rows.filter((r) => r.faded !== (r.dn < lowest || r.dn > highest));

  check("no row is dropped when the range narrows", rows.length === before,
    `${rows.length} rows, was ${before}`);
  check("the narrowed range leaves some rows out", rows.some((r) => r.faded) && rows.some((r) => !r.faded),
    rows.map((r) => r.name + (r.faded ? "(faded)" : "")).join(" "));
  check("and exactly the ones outside it are faded", misfiled.length === 0,
    misfiled.map((r) => r.name).join(", "));
}

// A row opens to its note split by distance, one row at a time.
{
  const session = stored();
  const measured = (r) => {
    const t = session.cards[r.dataset.card];
    return [...(t?.from ?? []), ...(t?.missedFrom ?? [])].some((f) => typeof f === "string");
  };
  const box = () => dom.el("breakdown").children.filter((c) => c.className === "bar-bands");
  const row = (card) => noteRows().find((r) => r.dataset.card === card);

  const first = noteRows().find(measured);
  first.dispatch("click");
  const opened = row(first.dataset.card);
  const under = dom.el("breakdown").children[dom.el("breakdown").children.indexOf(opened) + 1];
  check("clicking a note opens it", opened.getAttribute("aria-expanded") === "true" && opened.children[0].textContent === "−",
    `${opened.getAttribute("aria-expanded")} ${opened.children[0].textContent}`);
  check("to a row per distance under it", under?.className === "bar-bands" &&
    under.children.filter((c) => c.className === "bar-row is-band").length === 3,
    under?.children.map((c) => c.className).join(", "));

  const other = noteRows().find((r) => r.dataset.card !== first.dataset.card);
  other.dispatch("keydown", { key: "Enter", preventDefault() {} });
  check("opening another closes the first", box().length === 1 &&
    row(first.dataset.card).getAttribute("aria-expanded") === "false" &&
    row(first.dataset.card).children[0].textContent === "+");

  // Not every run answers a note only as the first of its line; when one
  // did, it says why it has nothing to show.
  const unmeasured = noteRows().find((r) => !measured(r));
  if (unmeasured) {
    unmeasured.dispatch("click");
    check("a note with no note before it recorded says why",
      box()[0]?.children[0]?.className === "bar-empty", box()[0]?.children.map((c) => c.className).join());
  }
  noteRows().find((r) => r.getAttribute("aria-expanded") === "true")?.dispatch("click");
  check("and clicking the open one closes it", box().length === 0);
}

check("ten answers are counted", text("stats").startsWith("10 notes"), text("stats"));
check("all but the two misses were right", text("stats").includes("80% right"), text("stats"));
check("they are broken down by note", dom.el("breakdown").children.length > 0);
check("the key to the bars is shown", !dom.el("breakdown-key").hidden);
check("the session was saved", Object.keys(dom.store).some((k) => k.includes("current")),
  Object.keys(dom.store).join(", "));

// Taken before the MIDI key below changes deck, which ends the session.
const answered = stored();

// A MIDI key sounds only with the setting on — most keyboards are silent.
{
  await Promise.resolve(); // let connect() finish; setTimeout is the stub's own
  check("the MIDI keyboard is found", text("midi-status") === "Stub keys", text("midi-status"));
  const before = dom.sounded.length;
  pressMidi(60);
  check("a MIDI key is silent with the setting off", dom.sounded.length === before);
  check("a MIDI key on the naming deck moves to the playing deck",
    dom.el("play-deck").getAttribute("aria-pressed") === "true");
  dom.flushFrames();
  check("without scoring the key that moved it", text("stats").includes("Play a note"), text("stats"));
  const sound = dom.el("sound");
  sound.checked = true;
  sound.dispatch("change");
  pressMidi(60);
  check("and sounds with it on", dom.sounded.length > before, `${dom.sounded.length - before} partials`);
}

// The notes before each answer survive the session ending, an export and an
// import: storage passes a session through whole, and this is what would
// catch it starting to pick fields out of one.
{
  const store = await import("../storage.js");
  const history = await import("../history.js");
  // Plus a timed miss, which this run's misses — each the first of a line or
  // straight after another miss — never are.
  const session = structuredClone(answered);
  const card = Object.keys(session.cards).find((id) => session.cards[id].from.some((f) => typeof f === "string"));
  session.cards[card].missedFrom = ["C4"];
  store.saveCurrentSession(session);
  store.closeCurrentSession();

  const file = JSON.stringify(store.exportAll());
  for (const k of Object.keys(dom.store)) if (/\.(sessions|current)\./.test(k)) delete dom.store[k];
  store.importAll(JSON.parse(file));

  const back = store.loadSessions().findLast((s) => s.started === session.started);
  check("a session's notes before survive closing, export and import",
    JSON.stringify(back?.cards) === JSON.stringify(session.cards), JSON.stringify(back?.cards[card]));
  const bands = history.byBand(card.split(":")[1], history.totalsByCard([back])?.get(card), "typed");
  check("and are read back by distance", bands.reduce((n, b) => n + b.timed + b.missed, 0) > 1,
    bands.map((b) => `${b.key}:${b.timed}/${b.missed}`).join(" "));
}

for (const line of problems) console.log(`FAIL ${line}`);
console.log(`${checked - problems.length} passed, ${problems.length} failed  (app boot)`);
process.exit(problems.length === 0 ? 0 : 1);
