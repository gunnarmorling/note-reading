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
const check = (what, ok, detail = "") => {
  if (!ok) problems.push(detail ? `${what}  — ${detail}` : what);
};

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
check("the menus start shut", dom.el("name-menu").hidden && dom.el("play-menu").hidden);
check("the cheat sheet says what is in play", text("cheat-count").includes("in play"), text("cheat-count"));

// Which letter is on the staff: read the notehead's y and ask the pitch model.
const notes = await import("../notes.js");
const staff = await import("../staff.js");
function shownLetter() {
  const head = dom
    .el("staff")
    .children.findLast((c) => (c.getAttribute("class") ?? "").startsWith("notehead"));
  const y = Number(head.getAttribute("transform").split(" ")[1].replace(")", ""));
  const dn = notes
    .notesFor(notes.BOTH_CLEFS, 2)
    .find((d) => Math.abs(notes.grandY(d) - y) < 0.01);
  return notes.fromDiatonic(dn).letter;
}

for (let i = 0; i < 6; i++) {
  dom.advance(700 + i * 100);
  document.dispatch("keydown", { key: shownLetter(), preventDefault() {}, target: null });
  dom.flushTimers();
  dom.flushFrames();
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

// Rows for notes the range no longer asks for, faded rather than dropped.
{
  const before = dom.el("breakdown").children.length;
  const set = (id, value) => {
    const s = dom.el(id);
    s.value = value;
    s.dispatch("change");
  };
  // Narrowed to the top of the range. What the limits actually become is
  // whatever the clef and ledger settings can draw — the selects say — so the
  // test reads them back rather than assuming it got what it asked for.
  set("lowest", String(notes.diatonic("C", 5)));
  set("highest", String(notes.diatonic("A", 5)));
  const lowest = Number(dom.el("lowest").value);
  const highest = Number(dom.el("highest").value);

  const rows = dom.el("breakdown").children.map((r) => {
    const name = r.children[0].textContent;
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

check("six answers are counted", text("stats").startsWith("6 notes"), text("stats"));
check("every one was right", text("stats").includes("100% right"), text("stats"));
check("they are broken down by note", dom.el("breakdown").children.length > 0);
check("the key to the bars is shown", !dom.el("breakdown-key").hidden);
check("the session was saved", Object.keys(dom.store).some((k) => k.includes("current")),
  Object.keys(dom.store).join(", "));

for (const line of problems) console.log(`FAIL ${line}`);
console.log(`${21 - problems.length} passed, ${problems.length} failed  (app boot)`);
process.exit(problems.length === 0 ? 0 : 1);
