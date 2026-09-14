import {
  LETTERS, candidateIds, cardId, cardMode, cardPitch, diatonic, fromDiatonic, isUpper, label,
  nearestWithLetter, notesFor, staffFor, toMidi,
} from "./notes.js";

import { TARGET_MS, isTimed, median, record } from "./scheduler.js";
import { chooseLine } from "./sequence.js";
import { grandScale, keyMap, markLive, renderLine, viewBox } from "./staff.js";
import * as store from "./storage.js";
import * as midi from "./midi.js";
import * as audio from "./audio.js";
import * as history from "./history.js";

const CORRECT_PAUSE_MS = 340;

const persisted = store.load();

/**
 * Which half of the system a note is written in. With both staves on screen
 * there is no clef to attribute a note to, but the hands still divide about
 * here, and one median for the pair hides which of them is dragging.
 * @param {number} dn
 * @returns {"upper" | "lower"}
 */
function halfFor(dn) {
  return isUpper(dn) ? "upper" : "lower";
}

/** How each half is named in the session line. */
const HALF_NAMES = { upper: "at and above middle C", lower: "below middle C" };

const state = {
  cards: store.applyDecay(persisted.cards, persisted.lastSeenIso),
  totals: persisted.totals,
  settings: store.loadSettings(),
  trial: 0,
  /** @type {number | null} the note being answered, as a diatonic number */
  current: null,
  /** @type {number[]} the whole line on screen, in reading order */
  line: [],
  /** Which note of the line is being answered. */
  index: 0,
  /** @type {{heads: SVGElement[], cursor: SVGElement | null} | null} */
  drawn: null,
  /** Which deck is being drilled: "typed" while no instrument is connected. */
  mode: "typed",
  /** @type {import("./history.js").Session} the sitting being recorded */
  session: history.newSession(Date.now()),
  /** @type {string | null} the card whose row in the record is open */
  openNote: null,
  /** @type {string | null} name of a connected MIDI device, if any */
  midiDevice: null,
  /**
   * Tuning in progress: which notes to ask for, how far through, the cents
   * readings so far, and the last note heard that wasn't the one asked for.
   * @type {{targets: number[], index: number, taken: number[], readings: number[],
   *   miss: number | null} | null}
   */
  tuning: null,
  /**
   * Testing against a known line: its notes, the position expected next,
   * what each position came out as this time round, and the running tally
   * per position.
   * @type {{line: number[], index: number, round: (string | null)[],
   *   tally: {heard: number, missed: number, wrong: number}[]} | null}
   */
  check: null,
  /**
   * A debug recording in progress: when it started, and everything logged
   * since — each frame the detector ran, and each thing it or the drill did.
   * @type {{started: number, startedIso: string, frames: number[][],
   *   events: Record<string, unknown>[]} | null}
   */
  debug: null,
  /** @type {SVGElement | null} */
  head: null,
  /** Scored and missed: the note stays put until the right answer comes. */
  retrying: false,
  startedAt: 0,
  accepting: false,
};

/**
 * An element the page is required to have. Missing one used to mean a null
 * reference thrown halfway through starting up, which shows as a blank sheet
 * and says nothing — the failure you get from a stale index.html against a
 * fresh app.js. Now it says which one.
 * @param {string} id
 * @returns {any}
 */
function need(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the page has no #${id}: index.html and app.js are out of step`);
  return found;
}

/**
 * Every element the drill drives. Filled in at startup rather than while
 * this module is evaluated, so a missing one is a failure something is in a
 * position to catch and report, instead of an exception thrown into nowhere.
 * @type {Record<string, any>}
 */
const ui = {};

function collectElements() {
  Object.assign(ui, {
    svg: /** @type {SVGSVGElement} */ (need("staff")),
    answers: need("answers"),
    verdict: need("verdict"),
    tabstrip: need("tabstrip"),
    stats: need("stats"),
    statsVs: need("stats-vs"),
    breakdown: need("breakdown"),
    breakdownKey: need("breakdown-key"),
    midiStatus: need("midi-status"),
    clefs: /** @type {HTMLSelectElement} */ (need("clefs")),
    ledgers: /** @type {HTMLSelectElement} */ (need("ledgers")),
    lowest: /** @type {HTMLSelectElement} */ (need("lowest")),
    highest: /** @type {HTMLSelectElement} */ (need("highest")),
    sequence: /** @type {HTMLSelectElement} */ (need("sequence")),
    reset: need("reset"),
    cheatToggle: need("cheat-toggle"),
    cheatSheet: need("cheat-sheet"),
    cheatCount: need("cheat-count"),
    nameDeck: need("name-deck"),
    playDeck: need("play-deck"),
    playOpen: need("play-open"),
    playMenu: need("play-menu"),
    playSplit: need("play-split"),
    useMidi: need("use-midi"),
    useMic: need("use-mic"),
    micStatus: need("mic-status"),
    micLevel: need("mic-level"),
    micFill: need("mic-fill"),
    micMark: need("mic-mark"),
    listen: need("listen"),
    listenFill: need("listen-fill"),
    listenMark: need("listen-mark"),
    strikes: need("strikes"),
    tune: need("tune"),
    tuning: need("tuning"),
    tuningPrompt: need("tuning-prompt"),
    tuningResult: need("tuning-result"),
    tuningStop: need("tuning-stop"),
    tuningKeys: need("tuning-keys"),
    check: need("check"),
    checking: need("checking"),
    checkingPrompt: need("checking-prompt"),
    checkingResult: need("checking-result"),
    checkingStop: need("checking-stop"),
    debugRecord: need("debug-record"),
    debugBar: need("debug-bar"),
    debugTime: need("debug-time"),
    debugSave: need("debug-save"),
    settingsMenu: need("settings-menu"),
    settingsButton: need("settings-button"),
    playerMenu: need("player-menu"),
    playerButton: need("player-button"),
    playerName: need("player-name"),
    playerList: need("player-list"),
    playerAdd: need("player-add"),
    playerRename: need("player-rename"),
    nameForm: need("name-form"),
    nameInput: /** @type {HTMLInputElement} */ (need("name-input")),
    nameSave: need("name-save"),
    nameCancel: need("name-cancel"),
    historyExport: need("history-export"),
    historyImport: /** @type {HTMLInputElement} */ (need("history-import")),
    sound: /** @type {HTMLInputElement} */ (need("sound")),
  });
}

// --- candidate set --------------------------------------------------------

/**
 * The clefs currently in play, bass first — the order the notes ascend in,
 * which is the order to learn them in and the order to list them in.
 */
function clefNames() {
  return state.settings.clefs === "both" ? ["bass", "treble"] : [state.settings.clefs];
}

/**
 * Change decks. Only ever called from the two deck buttons, the source rows,
 * and a key played on a MIDI keyboard: the deck is a choice, and deriving it
 * from whatever hardware happened to announce itself was a mistake. A MIDI
 * keyboard connects a second or so after the page loads, which meant the
 * deck could flip and the drill deal a fresh note while you were looking at
 * the old one — and then time you from the moment of the swap rather than
 * from when you first saw the note.
 *
 * @param {string} mode
 */
function setMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;

  // Changing deck ends the sitting, and not for tidiness: the first answer of
  // a session is never timed, and the first answer after moving from the
  // laptop keyboard to the piano is exactly the answer that rule exists to
  // throw away — it has finding the instrument in it. A sitting that mixed the
  // two could not be reported as one thing either, since a recognition time
  // and a reach-for-the-key time are not the same measurement. An empty
  // session is dropped rather than closed, so changing your mind before
  // answering anything leaves no trace.
  store.closeCurrentSession();
  state.session = history.newSession(Date.now());

  paintDeck();
  paintRecord();
  paintCheatSheet();
  nextTrial();
}

/**
 * Which deck is selected, and which of the two decks' controls that leaves on
 * screen. Read off state.mode rather than off the microphone: the two used to
 * be conflated, so a microphone that dropped out left the two buttons saying
 * you were naming notes while the drill was still dealing them to be played.
 */
function paintDeck() {
  const typed = state.mode === "typed";
  ui.nameDeck.setAttribute("aria-pressed", String(typed));
  ui.playDeck.setAttribute("aria-pressed", String(!typed));

  // The letter keys answer for one deck only; on the other they are a
  // reference and say so by being dimmed and unclickable.
  ui.answers.classList.toggle("is-idle", !typed);
  for (const key of keys.values()) key.disabled = !typed;
  if (!typed) releaseKeys();

  paintSources();
}

/**
 * Which of the two the drill is actually being fed by.
 *
 * Not a setting: it is read off the hardware, because that is where the truth
 * is. The microphone wins when it is open — you turned it on deliberately —
 * and a MIDI keyboard answers whenever it is the only thing there. Which
 * makes the rows a choice rather than a readout: picking one turns the
 * microphone on or off, and a keyboard with no microphone open needs no
 * turning on at all.
 */
function paintSources() {
  const listening = audio.listening();
  ui.useMidi.disabled = !state.midiDevice;
  ui.useMidi.setAttribute("aria-current", String(!listening && Boolean(state.midiDevice)));
  ui.useMic.setAttribute("aria-current", String(listening));
}

/**
 * Close the microphone and say so. `audio.stop()` reports nothing — it is a
 * teardown, not an event — so every caller has to put the page right, and
 * there are three of them now.
 */
function stopListening() {
  if (state.debug) saveDebug();
  if (audio.listening()) audio.stop();
  setMicStatus({ listening: false, error: null });
}

/** Ask for the microphone, and say so while the browser is asking. */
function startListening() {
  ui.micStatus.textContent = "asking for permission…";
  ui.micStatus.classList.remove("is-off");
  audio.start(
    heardStrike,
    (status) => {
      setMicStatus(status);
      if (status.listening) setMode("played");
    },
    showMicLevel,
  );
}

/**
 * Whether the browser has the popover API.
 *
 * Where it does — everything current — a menu is put in the browser's own top
 * layer, which is the whole reason to use it: it cannot be laid out in the
 * flow of the page, cannot be clipped by an ancestor and needs no z-index
 * guesswork. The browser also closes it on a click elsewhere or on Escape,
 * closes any other one when a second opens, and moves focus, none of which is
 * worth hand-rolling. Where it does not, the same menus fall back to being
 * hidden and shown, which is what this was before.
 */
const POPOVER = typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;

/**
 * The menus that hang off a button: the playing deck's, the settings and the
 * player's.
 *
 * `anchor` is what the menu lines up under — for the deck that is the whole
 * split button rather than its caret, so the menu's edge meets the button's.
 * The two at the right of the header hang from the right.
 */
function popmenus() {
  return [
    { menu: ui.playMenu, trigger: ui.playOpen, anchor: ui.playSplit, align: "left" },
    { menu: ui.settingsMenu, trigger: ui.settingsButton, anchor: ui.settingsButton, align: "right" },
    { menu: ui.playerMenu, trigger: ui.playerButton, anchor: ui.playerButton, align: "right" },
  ];
}

/** @param {HTMLElement} menu @returns {boolean} */
function menuShowing(menu) {
  return POPOVER && typeof menu.matches === "function"
    ? menu.matches(":popover-open")
    : !menu.hidden;
}

/**
 * Put a menu under its button and inside the window. The top layer is not
 * laid out by the page, so a menu has to be told where its button is — and
 * told again when the page scrolls under it.
 * @param {{menu: HTMLElement, anchor: HTMLElement, align: string}} entry
 */
function placeMenu({ menu, anchor, align }) {
  if (typeof anchor.getBoundingClientRect !== "function") return;
  const box = anchor.getBoundingClientRect();
  const width = menu.offsetWidth || 220;
  const wanted = align === "right" ? box.right - width : box.left;
  const rightmost = (window.innerWidth || width + 16) - width - 8;
  menu.style.left = `${Math.max(8, Math.min(wanted, rightmost))}px`;
  menu.style.top = `${box.bottom + 6}px`;
}

/** @param {HTMLElement} menu @param {boolean} on */
function showMenu(menu, on) {
  const entry = popmenus().find((m) => m.menu === menu);
  if (on && entry) placeMenu(entry);
  if (POPOVER && typeof menu.showPopover === "function") {
    if (on) menu.showPopover();
    else if (menuShowing(menu)) menu.hidePopover();
  } else {
    // Without the top layer, one at a time has to be arranged by hand — and
    // the open state has to be a class, since the stylesheet cannot lean on
    // :popover-open in a browser that has never heard of it.
    for (const m of popmenus()) {
      const showing = m.menu === menu && on;
      m.menu.hidden = !showing;
      m.menu.classList.toggle("is-open", showing);
    }
  }
  paintMenuState();
}

/** Each trigger says whether its own menu is open. */
function paintMenuState() {
  for (const { menu, trigger } of popmenus()) {
    trigger.setAttribute("aria-expanded", String(menuShowing(menu)));
  }
}

/**
 * Wire the menus up. With the popover API the markup's popovertarget does the
 * opening and closing, so there is nothing to bind but the consequences:
 * where to draw it, and what the button should then say about itself.
 */
function wireMenus() {
  for (const entry of popmenus()) {
    if (POPOVER && typeof entry.menu.showPopover === "function") {
      entry.menu.addEventListener("beforetoggle", (e) => {
        if (e.newState === "open") placeMenu(entry);
      });
      entry.menu.addEventListener("toggle", paintMenuState);
      continue;
    }
    entry.trigger.addEventListener("click", () => showMenu(entry.menu, !menuShowing(entry.menu)));
  }
  // A menu in the top layer does not scroll with the button it belongs to.
  for (const event of ["scroll", "resize"]) {
    window.addEventListener(event, () => {
      for (const entry of popmenus()) if (menuShowing(entry.menu)) placeMenu(entry);
    });
  }
  showMenu(ui.settingsMenu, false);
  paintMenuState();
}

/** Every note the clef and ledger settings can draw, whatever the limits. */
function availableNotes() {
  return notesFor(clefNames(), state.settings.ledgers);
}

function eligibleIds() {
  const { ledgers, lowest, highest } = state.settings;
  return candidateIds(clefNames(), ledgers, lowest, highest, state.mode);
}

// --- the loop -------------------------------------------------------------

/** Size the system to whatever the settings can now draw. */
function fitStaff() {
  const notes = availableNotes();
  if (notes.length > 0) ui.svg.setAttribute("viewBox", viewBox(notes, clefNames()));
}

function nextTrial() {
  // The test line stays on screen whatever else changes under it.
  if (state.check) {
    state.drawn = renderLine(ui.svg, state.check.line, clefNames());
    state.check.round = state.check.line.map(() => null);
    markLive(state.drawn, state.check.index);
    return;
  }
  const ids = eligibleIds();
  if (ids.length === 0) {
    // The clef and the limits have nothing in common — the bass clef with
    // nothing below C4, say. Say so rather than drawing something.
    ui.svg.replaceChildren();
    releaseKeys();
    state.current = null;
    state.line = [];
    state.drawn = null;
    state.head = null;
    state.accepting = false;
    state.retrying = false;
    ui.verdict.className = "verdict";
    ui.verdict.textContent = "No notes in range: the clef and the limits don't overlap.";
    return;
  }

  state.line = chooseLine(state.cards, ids, state.trial, state.settings.sequence).map(cardPitch);
  const staves = state.line.map((dn) => staffFor(dn, clefNames(), state.settings.ledgers));
  debugLog("line", { notes: state.line.map(label), staves });
  state.drawn = renderLine(ui.svg, state.line, clefNames(), staves);
  state.retrying = false;
  // Nothing is accepted until the line is painted, so that an answer typed
  // into the gap cannot land on a note that is not yet on screen.
  state.accepting = false;
  releaseKeys();
  ui.verdict.textContent = "";
  ui.verdict.className = "verdict";
  moveTo(0);

  // Start the clock on the frame the note is actually painted, not when the
  // DOM is mutated. One rAF runs before paint; the second runs after it.
  //
  // Only for a note on its own, though. The first note of a line is not the
  // same measurement as the rest: it includes taking in the whole line —
  // finding the clef, the shape, where it sits — and putting that in the same
  // median as the notes after it mixes two quantities. So it is recorded and
  // not timed, the same rule as the first answer of a session, and the clock
  // for every later note starts at the answer before it.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      state.startedAt = state.line.length > 1 ? NaN : performance.now();
      state.accepting = true;
    }),
  );
}

/**
 * Put the cursor on a note of the line, which makes it the one answered.
 * @param {number} index
 */
function moveTo(index) {
  state.index = index;
  state.current = state.line[index];
  state.head = state.drawn?.heads[index] ?? null;
  if (state.drawn) markLive(state.drawn, index);
}

/**
 * On to the next note of the line, or a pause and a fresh line after the
 * last one.
 * @param {number} from when the clock for the next note starts: the answer
 *   that moved the cursor, or NaN for a next note that is not to be timed.
 */
function advance(from) {
  if (state.index + 1 < state.line.length) {
    moveTo(state.index + 1);
    state.startedAt = from;
    state.accepting = true;
    return;
  }
  state.accepting = false;
  setTimeout(nextTrial, CORRECT_PAUSE_MS);
}

/**
 * @param {boolean} correct
 * @param {string} answerLabel what the player said
 * @param {number} at when the answer happened. A key press is now; a note
 *   played into the microphone was struck a few frames before it could be
 *   identified, and timing it from the identification would put the detector
 *   into every latency.
 */
function resolve(correct, answerLabel, { at = performance.now(), mode = "typed" } = {}) {
  if (state.current === null) return;
  if (state.retrying) {
    correctionAttempt(correct, answerLabel);
    return;
  }

  state.accepting = false;
  const now = Date.now();
  // A gap long enough to be a different sitting ends the one being recorded.
  if (!history.continuesSession(state.session.lastAt, now)) {
    store.closeCurrentSession();
    state.session = history.newSession(now);
  }

  // The first answer of a session is never timed: the clock would be
  // measuring you finding the page and putting your hands on the keys, not
  // reading. Asked of the session record rather than tracked in a flag
  // beside it, so the two cannot disagree — and so the rule applies to a
  // session that began by reloading, by a long gap, or by changing decks,
  // without any of those having to remember to say so.
  const first = Object.keys(state.session.cards).length === 0;
  const latencyMs = first ? NaN : at - state.startedAt;
  const id = cardId(state.current, mode);

  debugLog("answer", {
    expected: label(state.current),
    given: answerLabel,
    correct,
    latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
    attackAt: Number(at.toFixed(1)),
  });
  state.cards.set(id, record(store.cardFor(state.cards, id), { correct, latencyMs, trial: state.trial }));
  state.trial += 1;
  state.totals.answered += 1;
  if (correct) state.totals.correct += 1;

  // The note before this one in the line, which in a line is also the answer
  // the clock started from. None for the first note of a line or a note on
  // its own: the reader had nothing on this screen to read from.
  const previous = state.index > 0 ? label(state.line[state.index - 1]) : null;
  state.session = history.recordAnswer(state.session, { id, correct, latencyMs, at: now, previous });
  store.saveCurrentSession(state.session);

  state.head?.classList.add(correct ? "is-correct" : "is-wrong");
  ui.verdict.className = "verdict " + (correct ? "is-correct" : "is-wrong");
  ui.verdict.textContent = correct
    ? isTimed(latencyMs)
      ? `${label(state.current)} in ${secs(latencyMs)}s`
      : `${label(state.current)} — not timed`
    : tryAgain(state.current, answerLabel);

  store.save(state);
  paintRecord();

  if (correct) {
    advance(at);
    return;
  }

  // A miss leaves the note where it is until the right answer arrives. The
  // trial has already been scored on the answer above, so what follows is
  // practice and not measurement — it is the one chance to connect the name
  // you have just been given to the key it is on, which on a real instrument
  // is most of the work.
  state.retrying = true;
  state.accepting = true;
}

/**
 * What a wrong answer says. Present tense, because the note is still there to
 * be answered — and the same words however many attempts in you are, so that
 * the line doesn't start commenting on how badly it is going.
 * @param {number} dn
 * @param {string} answerLabel
 * @returns {string}
 */
function tryAgain(dn, answerLabel) {
  return `This is ${label(dn)} not ${answerLabel}. Try again.`;
}

/**
 * An answer to a note that has already been scored and missed.
 * @param {boolean} correct
 * @param {string} answerLabel
 */
function correctionAttempt(correct, answerLabel) {
  if (state.current === null) return;
  debugLog("correction", { expected: label(state.current), given: answerLabel, correct });
  const name = label(state.current);
  state.head?.classList.remove(correct ? "is-wrong" : "is-correct");
  state.head?.classList.add(correct ? "is-correct" : "is-wrong");
  ui.verdict.className = "verdict " + (correct ? "is-correct" : "is-wrong");
  ui.verdict.textContent = correct ? name : tryAgain(state.current, answerLabel);
  if (!correct) return;
  state.retrying = false;
  // The note after a miss is not timed. The line stopped while you were told
  // the answer and found it, and all that while the next note was in view to
  // be read ahead of the clock — so timing it from the correction would make
  // it look faster than it is, and timing it from the miss slower.
  advance(NaN);
}

/** @param {string} letter */
function answerLetter(letter) {
  if (!state.accepting || state.current === null || state.tuning || state.check) return;
  // Not an answer on the playing deck. A letter cannot say which octave, and
  // an answer is recorded by how it was given, so a letter typed here used to
  // be scored, advance the note, and land in the naming deck — out of the
  // panel in front of you and into the other deck's history, on a note the
  // playing deck's weights had chosen. The keys are drawn and disabled
  // instead: still a reminder of what the notes are called, plainly not a way
  // to answer.
  if (state.mode !== "typed") return;
  releaseKeys();
  pressKey(letter);
  // What you pressed, at the octave nearest the note on screen — so a wrong
  // letter sounds a step or two out rather than an unrelated note. Never
  // while the microphone is open: the detector would hear it and answer the
  // next trial with it.
  if (state.settings.sound && !audio.listening()) {
    audio.play(toMidi(nearestWithLetter(state.current, letter)));
  }
  resolve(fromDiatonic(state.current).letter === letter, letter, { mode: "typed" });
}

/**
 * An answer played rather than typed, from MIDI or from the microphone.
 * @param {number} midiNote
 * @param {number} [at]
 */
function answerMidi(midiNote, at) {
  if (!state.accepting || state.current === null || state.tuning || state.check) return;
  // From an instrument we can check the octave too, which is the skill that
  // actually matters: staff position to the key under your finger.
  resolve(midiNote === toMidi(state.current), midiNoteName(midiNote), { at, mode: "played" });
}

/**
 * A key pressed on the MIDI keyboard. Sounded whether or not it answers
 * anything — most keyboards make no sound of their own, and a key that is
 * silent only some of the time reads as a fault. Never while the microphone
 * is open, for the same reason as a typed letter.
 * @param {number} midiNote
 */
function soundAndAnswerMidi(midiNote) {
  if (state.settings.sound && !audio.listening()) audio.play(midiNote);
  // Played into the naming deck, a key was scored as a played answer — into
  // the playing deck's record, off screen, while the panel in front of you
  // went on saying "Press a letter to start". A key pressed is as deliberate
  // as the deck button, so it takes you to the playing deck instead. It does
  // not answer: the line it would answer is dealt by the switch, unseen.
  if (state.mode === "typed") {
    setMode("played");
    return;
  }
  answerMidi(midiNote);
}

/** @param {number} n */
function midiNoteName(n) {
  // German naming for the naturals, so the seventh degree is H. The flats keep
  // the international symbol rather than turning into Es/As/B — B♭ spelled out
  // is the same note German calls B, and one notation per row reads better.
  const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "H"];
  return names[n % 12] + (Math.floor(n / 12) - 1);
}

/** @param {number} n @param {string} noun */
function plural(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** @param {number} ms @returns {string} two decimals, or a dash for no data */
function secs(ms) {
  return Number.isNaN(ms) ? "–" : (ms / 1000).toFixed(2);
}

// --- players and the record -----------------------------------------------

/** Rebuild the player menu from the roster. */
/**
 * Who is practising, as a menu of the kind a profile usually gets. The name
 * itself is the button, so the one thing worth knowing at a glance — whose
 * record is on screen — is on screen without opening anything.
 */
function paintPlayers() {
  const { active, players } = store.roster();
  ui.playerName.textContent = players.find((p) => p.id === active)?.name ?? "Player";
  ui.playerList.replaceChildren();
  for (const p of players) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-item";
    item.textContent = p.name;
    if (p.id === active) item.setAttribute("aria-current", "true");
    item.addEventListener("click", () => {
      if (p.id === active) {
        showMenu(ui.playerMenu, false);
        return;
      }
      store.setActivePlayer(p.id);
      reloadForPlayer();
    });
    ui.playerList.appendChild(item);
  }
}

/**
 * Switch to another player, which is every bit of state this page holds: a
 * different deck, different settings, a different record. Simplest to start
 * again from storage rather than try to swap it all out in place.
 */
function reloadForPlayer() {
  window.location.reload();
}

/** @param {"add" | "rename"} mode */
function openNameForm(mode) {
  const { active, players } = store.roster();
  showMenu(ui.playerMenu, false);
  ui.nameForm.hidden = false;
  ui.nameForm.dataset.mode = mode;
  ui.nameInput.value = mode === "rename" ? (players.find((p) => p.id === active)?.name ?? "") : "";
  ui.nameInput.focus();
}

function closeNameForm() {
  ui.nameForm.hidden = true;
  paintPlayers();
}

function submitNameForm() {
  const name = ui.nameInput.value;
  if (ui.nameForm.dataset.mode === "rename") {
    store.renamePlayer(store.roster().active, name);
    closeNameForm();
    return;
  }
  store.addPlayer(name);
  reloadForPlayer();
}

/** Every session on record for this player, the one in progress included. */
function allSessions() {
  const stored = store.loadSessions();
  const withoutCurrent = stored.filter((s) => s.started !== state.session.started);
  return Object.keys(state.session.cards).length > 0
    ? [...withoutCurrent, state.session]
    : withoutCurrent;
}

/** @param {boolean} on */
function setSound(on) {
  state.settings = { ...state.settings, sound: on };
  store.saveSettings(state.settings);
  ui.sound.checked = on;
}

function downloadRecord() {
  const blob = new Blob([JSON.stringify(store.exportAll(), null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `note-reading-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** @param {File} file */
async function uploadRecord(file) {
  try {
    const result = store.importAll(JSON.parse(await file.text()));
    const touched = [...result.replaced, ...result.added];
    ui.stats.textContent = `Loaded ${touched.join(", ") || "nothing"}. Reloading…`;
    reloadForPlayer();
  } catch (err) {
    ui.stats.textContent = `Could not read that file: ${
      err instanceof Error ? err.message : err
    }`;
  }
}

// --- the microphone -------------------------------------------------------

/** How many strikes the log keeps on screen. */
const STRIKES_SHOWN = 6;

/**
 * Put a strike at the head of the log under the staff.
 *
 * Every strike the microphone noticed goes in, answered or not — which is
 * the point of it. A note the drill never registered looks, from the piano,
 * exactly like a note it did not hear, and the reasons are different and
 * want different remedies: too quiet wants the microphone closer, no attack
 * wants the last note released first, too soon wants a moment's patience.
 *
 * @param {string} text
 * @param {"is-right" | "is-wrong" | "is-lost" | ""} kind
 * @param {string} detail what the short text stands for, on hover
 */
function logStrike(text, kind, detail) {
  const item = document.createElement("li");
  item.className = `strike ${kind}`.trim();
  item.textContent = text;
  item.setAttribute("title", detail);
  ui.strikes.replaceChildren(item, ...[...ui.strikes.children].slice(0, STRIKES_SHOWN - 1));
}

/**
 * Something struck, as the microphone saw it. A strike it could not name is
 * only logged; a note is also shown in the menu's readout, and answers the
 * drill if the drill is asking.
 * @param {import("./audio.js").Strike} strike
 */
function heardStrike(strike) {
  if (strike.kind === "heard") {
    debugLog("strike", {
      ...strike,
      midi: audio.midiFor(strike.hz, state.settings.tuningCents),
      name: midiNoteName(audio.midiFor(strike.hz, state.settings.tuningCents)),
      cents: Number(audio.centsOff(strike.hz, state.settings.tuningCents).toFixed(1)),
    });
  } else {
    debugLog("strike", strike);
  }
  switch (strike.kind) {
    case "heard":
      heardNote(strike);
      return;
    case "quiet":
      logStrike("too quiet", "is-lost",
        `Reached ${Math.round((strike.level / strike.threshold) * 100)}% of the level a note has to clear.`);
      return;
    case "gradual":
      logStrike("no attack", "is-lost",
        `Loud enough, rising ×${strike.rise.toFixed(2)}, but never in one step — ` +
          "struck while the note before was still ringing?");
      return;
    case "overtaken":
      logStrike("overtaken", "is-lost", "The next note came before this one could be named.");
      return;
    case "unclear":
      logStrike("unclear", "is-lost",
        `Clearest reading ${strike.clarity.toFixed(2)}; a note needs ${audio.ACCEPT_CLARITY.toFixed(2)}.`);
      return;
    case "unsteady":
      logStrike("unsteady", "is-lost", "Clear readings that disagreed: two notes sounding at once?");
      return;
  }
}

/**
 * A note heard on the microphone. Reported whether or not the drill is
 * accepting one, so that the readout confirms it is hearing the piano before
 * you have any reason to trust it.
 * @param {{hz: number, clarity: number, at: number, over: boolean}} heard
 */
function heardNote({ hz, clarity, at, over }) {
  const cents = audio.centsOff(hz, state.settings.tuningCents);
  const note = audio.midiFor(hz, state.settings.tuningCents);
  const ambiguous = Math.abs(cents) > audio.AMBIGUOUS_CENTS;
  ui.micStatus.textContent =
    `Heard ${midiNoteName(note)}, ${cents >= 0 ? "+" : "−"}${Math.abs(Math.round(cents))}¢, ` +
    `clarity ${clarity.toFixed(2)}.` +
    (ambiguous ? " Too far between two notes to call — play it again." : "");

  const name = midiNoteName(note);
  // Tuning wants the raw deviation: measuring it is the whole point there,
  // and it has its own idea of how far off is too far.
  if (state.tuning) {
    logStrike(name, "", "Heard while tuning.");
    tuneWith(hz);
    return;
  }
  if (ambiguous) {
    logStrike("between notes", "is-lost",
      `${name} ${cents >= 0 ? "+" : "−"}${Math.abs(Math.round(cents))}¢: too near halfway to call.`);
    return;
  }
  // The test line takes what the drill would: a note too near halfway to
  // call is not counted, and so shows up as the note missed.
  if (state.check) {
    checkWith(note, name);
    return;
  }
  if (!state.accepting || state.current === null) {
    // Most often the pause after the last note of a line, before the next
    // line is up — heard perfectly well, and answering nothing.
    logStrike(`${name} early`, "is-lost", "Heard, but before there was a note to answer.");
    return;
  }
  const right = note === toMidi(state.current);
  logStrike(name, right ? "is-right" : "is-wrong",
    over
      ? `Read against the note still ringing: ${Math.round(clarity * 100)}% of what it added.`
      : `Clarity ${clarity.toFixed(2)}.`);
  answerMidi(note, at);
}

// --- recording for debugging ----------------------------------------------

/**
 * Note something in the debug recording's log, if one is being made. Times
 * are performance.now(), which each logged frame pairs with the audio
 * context's clock, and that clock with the samples in the file.
 * @param {string} type
 * @param {Record<string, unknown>} data
 */
function debugLog(type, data) {
  if (!state.debug) return;
  state.debug.events.push({ t: Number(performance.now().toFixed(1)), type, ...data });
}

/**
 * Record the microphone, and log what the drill made of it, until stopped.
 * For sharing: what a detector did with a real piano in a real room is not
 * something synthesised strings can say.
 */
async function startDebug() {
  if (state.debug || !audio.listening()) return;
  ui.debugRecord.disabled = true;
  let started = false;
  try {
    started = await audio.startCapture(() => {
      // Five minutes is plenty, and a lot of memory: save and stop.
      if (state.debug) saveDebug();
    });
  } catch (err) {
    ui.micStatus.textContent = `Could not record: ${err instanceof Error ? err.message : err}`;
  }
  if (started) {
    state.debug = { started: performance.now(), startedIso: new Date().toISOString(), frames: [], events: [] };
    debugLog("start", { mode: state.mode, line: state.line.map(label), index: state.index });
    showMenu(ui.playMenu, false);
  }
  paintDebug();
}

/** Stop recording, and save the audio with the log inside it as one WAV file. */
function saveDebug() {
  const d = state.debug;
  const taken = audio.stopCapture();
  state.debug = null;
  paintDebug();
  if (!d || !taken) return;
  const { tuningCents, clefs, ledgers, lowest, highest, sequence } = state.settings;
  const log = {
    format: "note-reading-debug/1",
    started: d.startedIso,
    sampleRate: taken.sampleRate,
    // The context's sample frame the file's first sample was; a frame's
    // contextTime × sampleRate − firstFrame is the sample its window ended on.
    firstFrame: taken.firstFrame,
    window: audio.WINDOW,
    device: ui.micStatus.textContent,
    userAgent: navigator.userAgent,
    settings: { mode: state.mode, tuningCents, clefs, ledgers, lowest: label(lowest), highest: label(highest), sequence },
    frameColumns: ["now", "contextTime", "level", "bar", "flux"],
    frames: d.frames,
    events: d.events,
  };
  const wav = audio.encodeWav(taken.samples, taken.sampleRate, JSON.stringify(log));
  const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `note-reading-debug-${d.startedIso.slice(0, 19).replaceAll(":", "-")}.wav`;
  link.click();
  URL.revokeObjectURL(url);
}

function paintDebug() {
  const on = Boolean(state.debug);
  ui.debugBar.hidden = !on;
  ui.debugRecord.disabled = on || !audio.listening();
  if (!on) ui.debugTime.textContent = "0:00";
}

// --- tuning ---------------------------------------------------------------

/** Notes to ask for, spread over whatever range is in play. */
const TUNING_TARGETS = 5;

/**
 * Strikes of each key. One strike's balance of partials pulls the reading a
 * few cents on its own, which is most of why running this twice used to give
 * two different answers; several strikes medianed settle down.
 */
const TUNING_READINGS = 3;

/** Further than this from the note asked for and it was a different note. */
const TUNING_TOLERANCE_CENTS = 250;

function startTuning() {
  if (state.check) stopCheck(false);
  const pitches = eligibleIds().map(cardPitch);
  if (pitches.length === 0) return;
  const targets = Array.from({ length: TUNING_TARGETS }, (_, i) =>
    pitches[Math.round((i * (pitches.length - 1)) / (TUNING_TARGETS - 1))],
  );
  state.tuning = { targets, index: 0, taken: [], readings: [], miss: null };
  // The drill stops while this happens: a note played to tune with is not an
  // answer, and the trial on screen would otherwise be timing you all the
  // while.
  state.accepting = false;
  paintTuning();
}

/** @param {number} hz */
function tuneWith(hz) {
  const t = state.tuning;
  if (!t) return;
  const nominal = 440 * Math.pow(2, (toMidi(t.targets[t.index]) - 69) / 12);
  const off = audio.centsBetween(hz, nominal);
  if (Math.abs(off) > TUNING_TOLERANCE_CENTS) {
    // A different note, or a detection gone wrong. Either way it says nothing
    // about the tuning, so it is named and not counted. Named without the
    // stored offset, which is the thing being measured.
    t.miss = audio.midiFor(hz);
    paintTuning();
    return;
  }
  t.miss = null;
  t.taken.push(off);
  if (t.taken.length < TUNING_READINGS) {
    paintTuning();
    return;
  }

  t.readings.push(median(t.taken));
  t.taken = [];
  t.index += 1;
  if (t.index < t.targets.length) {
    paintTuning();
    return;
  }

  const done = audio.tuningOffset(t.readings);
  state.settings = { ...state.settings, tuningCents: done.cents };
  store.saveSettings(state.settings);
  state.tuning = null;
  paintTuning(done);
  nextTrial();
}

function stopTuning() {
  state.tuning = null;
  paintTuning();
  nextTrial();
}

// --- testing with four notes ----------------------------------------------

/**
 * The line to test with: four steps up from middle C, under one hand's five
 * fingers, so it can be played legato round and round with nothing to read.
 */
const CHECK_LINE = ["C", "D", "E", "F"].map((letter) => diatonic(letter, 4));

/**
 * Play a line you know, over and over, and see what the microphone made of
 * each note. Nothing is scored or recorded: the drill stops while this runs,
 * the way it does for tuning, since the question is about the detector and
 * not about reading.
 */
function startCheck() {
  if (state.tuning) {
    state.tuning = null;
    paintTuning();
  }
  state.check = {
    line: CHECK_LINE,
    index: 0,
    round: CHECK_LINE.map(() => null),
    tally: CHECK_LINE.map(() => ({ heard: 0, missed: 0, wrong: 0 })),
  };
  state.accepting = false;
  state.retrying = false;
  state.drawn = renderLine(ui.svg, CHECK_LINE, clefNames());
  ui.verdict.className = "verdict";
  ui.verdict.textContent = "";
  releaseKeys();
  ui.strikes.replaceChildren();
  showMenu(ui.playMenu, false);
  debugLog("line", { notes: CHECK_LINE.map(label), test: true });
  paintCheck();
}

/**
 * A note heard during the test.
 * @param {number} midiNote
 * @param {string} name
 */
function checkWith(midiNote, name) {
  const c = state.check;
  if (!c || !state.drawn) return;
  const heads = state.drawn.heads;
  const { marks, index } = audio.followLine(c.line.map(toMidi), c.index, midiNote);
  debugLog("check", {
    heard: name,
    marks: marks.map((m) => ({ note: label(c.line[m.at]), result: m.result })),
  });
  const classes = { heard: "is-correct", missed: "is-missed", wrong: "is-wrong" };
  for (const { at, result } of marks) {
    // Back to the first note is the start of the next time round: clear the
    // last round off the staff, but only now, so it stays readable until you
    // have moved on from it — and not the note marked a moment ago, when a
    // miss at the end of the round and the first note arrive together.
    if (at === 0 && c.round.some((r) => r !== null)) {
      heads.forEach((head, i) => {
        if (marks.some((m) => m.at === i && m.at !== 0)) return;
        head.classList.remove(...Object.values(classes));
        c.round[i] = null;
      });
    }
    c.round[at] = result;
    c.tally[at][result] += 1;
    heads[at].classList.add(classes[result]);
  }
  logStrike(name, marks.at(-1)?.result === "heard" ? "is-right" : "is-wrong",
    marks.length > 1 ? `Heard — and ${label(c.line[marks[0].at])} before it was not.` : "Heard.");
  c.index = index;
  markLive(state.drawn, index);
  paintCheck();
}

/** @param {boolean} [resume] whether to go back to the drill */
function stopCheck(resume = true) {
  state.check = null;
  paintCheck();
  if (resume) nextTrial();
}

function paintCheck() {
  const c = state.check;
  ui.checking.hidden = !c;
  ui.check.disabled = Boolean(c) || !audio.listening();
  if (!c) return;
  ui.checkingPrompt.textContent =
    `Play ${c.line.map(label).join(" ")} over and over, legato if you like. ` +
    "Nothing is recorded.";
  const sum = c.tally.reduce(
    (a, t) => ({ heard: a.heard + t.heard, missed: a.missed + t.missed, wrong: a.wrong + t.wrong }),
    { heard: 0, missed: 0, wrong: 0 },
  );
  const played = sum.heard + sum.missed + sum.wrong;
  ui.checkingResult.textContent =
    played === 0
      ? "Waiting for the first note."
      : `${sum.heard} of ${played} heard · ${sum.missed} missed · ${sum.wrong} wrong — ` +
        c.line
          .map((dn, i) => {
            const t = c.tally[i];
            return `${label(dn)} ${t.heard}/${t.heard + t.missed + t.wrong}`;
          })
          .join(" · ");
}

/** @param {{cents: number, measured: number, spread: number}} [done] */
function paintTuning(done) {
  const t = state.tuning;
  ui.tuning.hidden = !t;
  ui.tune.disabled = Boolean(t) || !audio.listening();
  if (!t) {
    if (done) {
      const spread = `readings spanning ${done.spread}¢`;
      ui.tuningResult.textContent =
        done.cents === 0
          ? `At concert pitch as near as this can tell — ${done.measured}¢ measured, ` +
            `${spread}, which is inside what a stretched-tuned piano varies by anyway. ` +
            "Nothing worth allowing for."
          : `Your piano reads ${Math.abs(done.cents)}¢ ${done.cents < 0 ? "flat" : "sharp"} ` +
            `(${spread}). Allowed for from now on.`;
      ui.tuningResult.hidden = false;
    }
    return;
  }
  ui.tuningResult.hidden = true;
  const target = t.targets[t.index];
  const miss = t.miss === null ? "" : ` That sounded like ${midiNoteName(t.miss)} — try again.`;
  ui.tuningPrompt.textContent =
    `Play ${label(target)}. Note ${t.index + 1} of ${t.targets.length}, ` +
    `strike ${t.taken.length + 1} of ${TUNING_READINGS}.${miss}`;
  // Which key that is, rather than only what it is called.
  ui.tuningKeys.replaceChildren(keyMap({ marked: target }));
}

/**
 * The speed to aim for, by deck. Naming a note is a recognition time; finding
 * it on an instrument includes moving your hand there, so the bar cannot be
 * the same. Only a threshold for the bars and the line — the scheduler's own
 * TARGET_MS stays one number, because every weight is divided by it and the
 * ratios between notes within a deck come out the same either way.
 */
const AIM_MS = { typed: TARGET_MS, played: 1500 };

/** Bottom of the level meter's scale, in decibels below full scale. */
const METER_FLOOR_DB = 80;

/**
 * Position on the meter of a level, as a percentage. Linear in amplitude the
 * bar would be a flicker at the bottom of its own scale for everything short
 * of a slammed chord, so it is drawn in decibels.
 * @param {number} level
 * @returns {number}
 */
function meterPercent(level) {
  const db = 20 * Math.log10(Math.max(level, 1e-6));
  return Math.min(100, Math.max(0, ((db + METER_FLOOR_DB) / METER_FLOOR_DB) * 100));
}

/**
 * The live level, and the mark a strike has to cross to count as a note.
 *
 * The mark moves, and more than it used to: it was the room's threshold,
 * which follows the room slowly, and it is now whatever a strike actually has
 * to clear — which just after a note is a step above that note, sinking back
 * as it decays. So a note played before the mark has come back down is one
 * the meter says will not register.
 *
 * Drawn twice: in the menu, where the microphone is set up, and under the
 * staff, where it is wanted while playing. A popover shuts the moment you
 * click away from it, so a meter only in the menu is invisible exactly when
 * it matters.
 * @param {number} level
 * @param {number} bar
 * @param {import("./audio.js").FrameDetail} [frame]
 */
function showMicLevel(level, bar, frame) {
  if (state.debug && frame) {
    const round = (x, places) => Number(x.toFixed(places));
    state.debug.frames.push([
      round(frame.now, 1), round(frame.contextTime, 5), round(level, 5), round(bar, 5), round(frame.flux, 1),
    ]);
    const seconds = Math.floor((frame.now - state.debug.started) / 1000);
    ui.debugTime.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  for (const [fill, mark] of [[ui.micFill, ui.micMark], [ui.listenFill, ui.listenMark]]) {
    fill.style.width = `${meterPercent(level)}%`;
    mark.style.left = `${meterPercent(bar)}%`;
  }
}

/** @param {import("./audio.js").MicStatus} status */
function setMicStatus({ listening, error, device, sampleRate }) {
  const tuned = state.settings.tuningCents
    ? `, tuned ${Math.abs(state.settings.tuningCents)}¢ ${state.settings.tuningCents < 0 ? "flat" : "sharp"}`
    : "";
  ui.micStatus.textContent =
    error ?? (listening ? `${device} at ${sampleRate}Hz${tuned}` : "off");
  ui.micStatus.classList.toggle("is-off", !listening && !error);
  ui.micLevel.hidden = !listening;
  ui.listen.hidden = !listening;
  if (!listening) {
    ui.micFill.style.width = "0";
    ui.listenFill.style.width = "0";
    ui.strikes.replaceChildren();
  }
  // Turning the microphone off mid-tuning has to put the drill back, not just
  // hide the panel and leave the trial on screen refusing answers.
  if (!listening && state.tuning) stopTuning();
  else paintTuning();
  if (!listening && state.check) stopCheck();
  else paintCheck();
  // The microphone gone from under a recording takes the recording with it;
  // closing it on purpose saves first, in stopListening.
  if (!listening && state.debug) state.debug = null;
  paintDebug();
  // Losing the microphone mid-session drops you back to naming, because
  // there is no longer anything to play into.
  if (!listening && !state.midiDevice) setMode("typed");
  paintSources();
  paintRecord();
}

// --- cheat sheet ----------------------------------------------------------

/**
 * The whole range on one grand staff, then the same range on a keyboard.
 * Drawn over everything the ledger setting reaches, with the notes the pitch
 * limits exclude faded rather than dropped, so the spacing stays put as the
 * limits change. Which notes are in play comes from the drill's own candidate
 * set, so the sheet cannot come to disagree with what is being asked.
 */
function paintCheatSheet() {
  ui.cheatSheet.replaceChildren();

  // The count is drawn either way, so the row says what is in play while
  // still shut; the engraving only when there is someone to read it.
  const inRange = eligibleIds().map(cardPitch);
  ui.cheatCount.textContent = inRange.length
    ? `${plural(inRange.length, "note")} in play`
    : "the clef and the limits don't overlap";
  if (!state.settings.cheat || inRange.length === 0) return;

  // No caption: which notes are faded says itself once you can see the range,
  // and a line of prose over an engraving is a line of prose you read instead
  // of the engraving.
  const paper = document.createElement("div");
  paper.className = "sheet";
  paper.appendChild(grandScale(availableNotes(), inRange, clefNames(), state.settings.ledgers));
  const block = document.createElement("div");
  block.appendChild(paper);
  ui.cheatSheet.appendChild(block);

  // Which key to press is the other half of an answer only one deck asks
  // for: naming a note is answered with a letter, and where that note sits
  // on the instrument does not come into it. Tuning marks a key on its own
  // keyboard, so this is not the only place to look one up either.
  if (state.mode !== "played") return;
  const keysCaption = document.createElement("p");
  keysCaption.className = "cheat-clef";
  keysCaption.textContent = "The dot is middle C, the tinted keys are in play";
  const keysPaper = document.createElement("div");
  keysPaper.className = "sheet";
  keysPaper.appendChild(keyMap({ inRange }));
  const keysBlock = document.createElement("div");
  keysBlock.append(keysCaption, keysPaper);
  ui.cheatSheet.appendChild(keysBlock);
}

/** @param {boolean} on */
function showCheatSheet(on) {
  state.settings = { ...state.settings, cheat: on };
  store.saveSettings(state.settings);
  ui.cheatSheet.hidden = !on;
  ui.cheatToggle.setAttribute("aria-expanded", String(on));
  paintCheatSheet();
}

// --- stats ----------------------------------------------------------------

/**
 * This session so far, in the deck on show. Read off the session record
 * rather than counted alongside it, so the line and the history cannot come
 * to disagree — and not the day's total, which is the first thing this was:
 * four hundred notes in, one more answer moves that median by nothing, so it
 * said nothing about how the last few minutes had gone.
 */
function sessionTallies() {
  return [...history.totalsByCard([state.session])].filter(([id]) => cardMode(id) === state.mode);
}

/**
 * The two medians, and only when there are two to compare: with the drill
 * confined to one half of the system the split would restate the overall.
 */
function sessionSplit() {
  /** @type {Record<string, number[]>} */
  const halves = { lower: [], upper: [] };
  for (const [id, tally] of sessionTallies()) halves[halfFor(cardPitch(id))].push(...tally.ms);
  const both = ["lower", "upper"].filter((half) => halves[half].length > 0);
  return both.length > 1
    ? both.map((half) => `${secs(median(halves[half]))}s ${HALF_NAMES[half]}`).join(" · ")
    : "";
}

/**
 * The spans the record can be read over. The sitting you are in, then rolling
 * days — one panel and one row builder for all four, so a session and a month
 * cannot drift into looking like different kinds of thing. All time is not
 * among them: four tabs is already as many as 380px holds, and thirty days is
 * the honest practice window.
 */
const SPANS = [
  { key: "session", label: "Session" },
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
];

/** The span on show, defended against a stored value we no longer offer. */
function spanKey() {
  return SPANS.some((s) => s.key === state.settings.span) ? state.settings.span : "session";
}

function buildTabs() {
  ui.tabstrip.replaceChildren();
  for (const span of SPANS) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.dataset.span = span.key;
    tab.setAttribute("role", "tab");
    tab.textContent = span.label;
    tab.addEventListener("click", () => setSpan(span.key));
    ui.tabstrip.appendChild(tab);
  }
}

/** @param {string} key */
function setSpan(key) {
  state.settings = { ...state.settings, span: key };
  store.saveSettings(state.settings);
  paintRecord();
}

/**
 * The record, over whichever span is selected.
 *
 * The session is the first tab rather than a separate panel above the others,
 * because it is the same question asked of a shorter period. What differs is
 * only what the second line can say: a session has nothing before it to be
 * faster than, so it reports the two halves of the system instead.
 */
function paintRecord() {
  const span = spanKey();
  for (const tab of ui.tabstrip.children) {
    tab.setAttribute("aria-selected", String(tab.dataset.span === span));
  }

  const mine = (map) => new Map([...map].filter(([id]) => cardMode(id) === state.mode));
  const now = Date.now();
  const tallies =
    span === "session"
      ? sessionTallies()
      : [...mine(history.totalsByCard(history.sessionsIn(allSessions(), span, now)))];
  const sum = history.overall(new Map(tallies));

  // Nothing in this deck over this span. For the session that is an
  // invitation, since it is the span you are about to add to; for the others
  // it is just a fact. Asked of the record rather than of a "has practice
  // begun" flag, which said the wrong thing every time you changed decks: the
  // flag was cleared, so four notes already named this session went off screen
  // until you answered a fifth.
  if (sum.n === 0) {
    ui.stats.textContent =
      span !== "session"
        ? "Nothing recorded yet."
        : state.mode === "played"
          ? "Play a note to start."
          : "Press a letter to start.";
    ui.statsVs.textContent = "";
    ui.breakdownKey.hidden = true;
    ui.breakdown.replaceChildren();
    return;
  }

  const right = `${Math.round(sum.accuracy * 100)}% right`;
  const median = `${secs(sum.medianMs)}s median`;
  // The same sentence for every span. It used to add "over 22 of 11 in range"
  // for the longer ones, which compared what a span recorded against the
  // range set now — so narrowing the range left it claiming 22 of 11, and the
  // line wrapped to say it. The rows below enumerate the notes regardless.
  ui.stats.textContent = `${plural(sum.n, "note")} · ${right} · ${median}`;

  ui.statsVs.textContent = span === "session" ? sessionSplit() : comparison(span, now, sum);

  // This span's notes, and nothing else. The scheduler's own per-note averages
  // used to be on show here, which was a mistake: they survive a reload, fade
  // between sessions and are not a count of anything, so a page reporting
  // "1 note this session" over a list of eleven notes with times was telling
  // you two true things that read as a contradiction. They are its working
  // state, not a result.
  ui.breakdownKey.hidden = tallies.length === 0;
  ui.breakdownKey.textContent =
    `Bars are the median for each note, against the slowest of them; the line is the ` +
    `${secs(aimMs())}s to aim for, and amber is inside it. × is how many times it came up — ` +
    "a couple of tries makes a rough median, so the longer spans are where the real ones are. " +
    "Faded rows are notes the range no longer asks for. Open a note to split it by how far " +
    (state.mode === "played"
      ? "the note before it was, in semitones — a stand-in for how far the hand moved."
      : "the note before it was, in staff steps — a stand-in for how far the eye jumped.");
  paintNoteRows(ui.breakdown, tallies);
}

/**
 * How this span compares with the one before it, which is the thing worth
 * knowing and the reason the spans roll rather than following the calendar.
 * @param {string} span
 * @param {number} now
 * @param {{medianMs: number}} sum
 * @returns {string}
 */
function comparison(span, now, sum) {
  const window = history.WINDOWS.find((w) => w.key === span);
  if (!window?.compare) return "";
  const previous = history.sessionsBetween(allSessions(), history.previousRange(span, now));
  const before = history.overall(
    new Map([...history.totalsByCard(previous)].filter(([id]) => cardMode(id) === state.mode)),
  );
  if (!before.n) return `Nothing from ${window.compare} to compare with.`;
  const delta = before.medianMs - sum.medianMs;
  if (Math.abs(delta) < 10) return `Level with ${window.compare}.`;
  return (
    `${delta > 0 ? "↓" : "↑"} ${secs(Math.abs(delta))}s ` +
    `${delta > 0 ? "faster" : "slower"} than ${window.compare}.`
  );
}

/** The speed to aim for in the deck on show. */
function aimMs() {
  return AIM_MS[state.mode] ?? TARGET_MS;
}

/**
 * One row per note: trials, how often right first time, and the median of the
 * answers that were timed. Shared by the session panel and the history, so
 * the two cannot drift into looking like different kinds of thing.
 *
 * @param {HTMLElement} into
 * @param {[string, import("./history.js").Tally][]} tallies
 */
function paintNoteRows(into, tallies) {
  const summarised = tallies
    .map(([id, tally]) => ({ id, ...history.summarise(tally) }))
    .sort((a, b) => (b.medianMs || 0) - (a.medianMs || 0));

  // Scaled within the set on show, so the bars mean something relative to
  // each other and to the mark, and nothing at all across panels.
  const aim = aimMs();
  const medians = summarised.map((r) => r.medianMs).filter(Number.isFinite);
  const slowest = medians.length ? Math.max(...medians, aim) : aim;

  // What the range still asks for. A span holds whatever you practised over
  // it, which after narrowing the range means rows for notes the drill will
  // not ask again — and, being the ones you had least practice at, they sort
  // to the top and read as your worst problems. Faded rather than dropped,
  // the way the cheat sheet fades what the limits exclude: recorded, not
  // currently asked.
  const asked = new Set(eligibleIds());

  // One note open at a time, and only while it is still in the panel.
  if (!summarised.some((row) => row.id === state.openNote)) state.openNote = null;

  into.replaceChildren();
  for (const row of summarised) {
    const line = document.createElement("div");
    line.className = asked.has(row.id) ? "bar-row" : "bar-row is-out";
    const open = row.id === state.openNote;
    line.setAttribute("role", "button");
    line.setAttribute("tabindex", "0");
    line.setAttribute("aria-expanded", String(open));
    line.dataset.card = row.id;
    const toggle = () => {
      state.openNote = open ? null : row.id;
      paintRecord();
      // The row was redrawn; keep the keyboard where it was.
      into.children.find((c) => c.dataset?.card === row.id)?.focus?.();
    };
    line.addEventListener("click", toggle);
    line.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });

    // In a slot of its own, so that a row being something to open shows
    // before anyone hovers over it.
    const sign = document.createElement("span");
    sign.className = "bar-toggle";
    sign.setAttribute("aria-hidden", "true");
    sign.textContent = open ? "−" : "+";

    const name = document.createElement("span");
    name.className = "bar-name";
    name.textContent = label(cardPitch(row.id));

    const track = document.createElement("span");
    track.className = "bar-track";
    if (Number.isFinite(row.medianMs)) {
      const fill = document.createElement("span");
      fill.className = "bar-fill";
      fill.style.width = `${Math.max(3, (row.medianMs / slowest) * 100).toFixed(1)}%`;
      if (row.medianMs <= aim) fill.classList.add("is-fluent");
      track.appendChild(fill);
    }
    // The speed to aim for, in the same place on every row of the set.
    const mark = document.createElement("span");
    mark.className = "bar-mark";
    mark.style.left = `${((aim / slowest) * 100).toFixed(1)}%`;
    track.appendChild(mark);

    const tries = document.createElement("span");
    tries.className = "bar-count";
    tries.textContent = `×${row.n}`;

    const acc = document.createElement("span");
    acc.className = "bar-accuracy";
    acc.textContent = Number.isNaN(row.accuracy) ? "–" : `${Math.round(row.accuracy * 100)}%`;

    const time = document.createElement("span");
    time.className = "bar-time";
    if (Number.isFinite(row.medianMs) && row.medianMs <= aim) time.classList.add("is-fluent");
    time.textContent = Number.isNaN(row.medianMs) ? "–" : `${secs(row.medianMs)}s`;

    line.append(sign, name, track, tries, acc, time);
    into.appendChild(line);
    if (open) into.appendChild(bandRows(row.id, tallies.find(([id]) => id === row.id)[1]));
  }
}

/**
 * One note's record split by how far the note before it was, under its row.
 * Scaled against the slowest band of this note and the aim, not against the
 * other notes: the question is how this note's distances compare.
 *
 * @param {string} id
 * @param {import("./history.js").Tally} tally
 * @returns {HTMLElement}
 */
function bandRows(id, tally) {
  const box = document.createElement("div");
  box.className = "bar-bands";
  const bands = history.byBand(label(cardPitch(id)), tally, cardMode(id));

  if (bands.every((b) => b.timed + b.missed === 0)) {
    const empty = document.createElement("p");
    empty.className = "bar-empty";
    empty.textContent =
      state.settings.sequence === 1
        ? "One note at a time has no note before it to measure from."
        : "Answer a line of two or more to see this.";
    box.appendChild(empty);
    return box;
  }

  const aim = aimMs();
  const medians = bands.map((b) => b.medianMs).filter(Number.isFinite);
  const slowest = Math.max(...medians, aim);

  for (const band of bands) {
    const line = document.createElement("div");
    line.className = "bar-row is-band";

    const name = document.createElement("span");
    name.className = "bar-name";
    name.textContent = band.label;

    const track = document.createElement("span");
    track.className = "bar-track";
    if (band.timed > 0) {
      const fill = document.createElement("span");
      fill.className = "bar-fill";
      fill.style.width = `${Math.max(3, (band.medianMs / slowest) * 100).toFixed(1)}%`;
      if (band.medianMs <= aim) fill.classList.add("is-fluent");
      track.appendChild(fill);
      const mark = document.createElement("span");
      mark.className = "bar-mark";
      mark.style.left = `${((aim / slowest) * 100).toFixed(1)}%`;
      track.appendChild(mark);
    } else {
      track.classList.add("is-empty");
      track.textContent = "not yet";
    }

    const tries = document.createElement("span");
    tries.className = "bar-count";
    tries.textContent = `×${band.timed + band.missed}`;

    const acc = document.createElement("span");
    acc.className = "bar-accuracy";
    acc.textContent = Number.isNaN(band.accuracy) ? "–" : `${Math.round(band.accuracy * 100)}%`;

    const time = document.createElement("span");
    time.className = "bar-time";
    if (band.medianMs <= aim) time.classList.add("is-fluent");
    time.textContent = `${secs(band.medianMs)}${band.timed > 0 ? "s" : ""}`;

    line.append(name, track, tries, acc, time);
    box.appendChild(line);
  }
  return box;
}

/**
 * Fill the two limit selects with the notes the clef and ledger settings can
 * actually draw, and pull the stored limits into that set.
 *
 * They used to offer the drill's whole compass, C2 to C6, whatever else was
 * set — so with one ledger line they read "C2" and "C6" while the drill was
 * really working over E2 to A5, and there was nothing on the page to say why.
 */
function buildLimitOptions() {
  const notes = availableNotes();
  if (notes.length === 0) return;
  const nearest = (want) =>
    notes.reduce((best, dn) => (Math.abs(dn - want) < Math.abs(best - want) ? dn : best), notes[0]);
  const a = nearest(state.settings.lowest);
  const b = nearest(state.settings.highest);
  state.settings = { ...state.settings, lowest: Math.min(a, b), highest: Math.max(a, b) };

  for (const select of [ui.lowest, ui.highest]) {
    select.replaceChildren();
    for (const dn of notes) {
      const option = document.createElement("option");
      option.value = String(dn);
      option.textContent = label(dn);
      select.appendChild(option);
    }
  }
  ui.lowest.value = String(state.settings.lowest);
  ui.highest.value = String(state.settings.highest);
}

// --- wiring ---------------------------------------------------------------

/** @type {Map<string, HTMLButtonElement>} */
const keys = new Map();

function buildAnswerButtons() {
  ui.answers.replaceChildren();
  keys.clear();
  for (const letter of LETTERS) {
    const b = document.createElement("button");
    b.className = "answer";
    b.type = "button";
    b.textContent = letter;
    b.addEventListener("click", () => answerLetter(letter));
    ui.answers.appendChild(b);
    keys.set(letter, b);
  }
}

/**
 * Show the answer on the keyboard, held down until the next note. A key
 * pressed on the computer keyboard otherwise left no mark on the one on
 * screen, and the point of drawing a keyboard is the tie between the two.
 * @param {string} letter
 */
function pressKey(letter) {
  keys.get(letter)?.classList.add("is-pressed");
}

function releaseKeys() {
  for (const b of keys.values()) b.classList.remove("is-pressed");
}

function init() {
  // Arriving at the page starts a session, whatever was going on before. The
  // alternative was carrying on any session still inside its half hour, which
  // meant a reload mid-practice stayed in the same one — tidier for the
  // record, and it made the numbers on screen jump to something you had not
  // just done. A reload is a fresh start.
  store.closeCurrentSession();
  state.session = history.newSession(Date.now());

  buildAnswerButtons();

  ui.clefs.value = state.settings.clefs;
  ui.ledgers.value = String(state.settings.ledgers);
  ui.sequence.value = String(state.settings.sequence);
  buildLimitOptions();
  fitStaff();
  buildTabs();

  const onSettingChange = () => {
    const a = Number(ui.lowest.value);
    const b = Number(ui.highest.value);
    state.settings = {
      ...state.settings,
      clefs: ui.clefs.value,
      ledgers: Number(ui.ledgers.value),
      // Taken in whichever order they were set, so picking a lowest above the
      // highest swaps them rather than emptying the drill.
      lowest: Math.min(a, b),
      highest: Math.max(a, b),
      sequence: Number(ui.sequence.value),
    };
    buildLimitOptions();
    fitStaff();
    store.saveSettings(state.settings);
    paintCheatSheet();
    paintRecord();
    nextTrial();
  };
  for (const select of [ui.clefs, ui.ledgers, ui.lowest, ui.highest, ui.sequence]) {
    select.addEventListener("change", onSettingChange);
  }

  // Not a setting change in the sense above: opening the cheat sheet leaves
  // the note you are looking at alone.
  // Toggled off the settings rather than off the DOM's own hidden attribute:
  // the state of the drill is what it is, not what the stylesheet renders.
  ui.cheatToggle.addEventListener("click", () => showCheatSheet(!state.settings.cheat));
  paintPlayers();
  ui.playerAdd.addEventListener("click", () => openNameForm("add"));
  ui.playerRename.addEventListener("click", () => openNameForm("rename"));
  ui.nameSave.addEventListener("click", submitNameForm);
  ui.nameCancel.addEventListener("click", closeNameForm);
  ui.nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitNameForm();
    if (e.key === "Escape") closeNameForm();
    e.stopPropagation();
  });

  ui.sound.addEventListener("change", () => setSound(ui.sound.checked));
  setSound(state.settings.sound);
  ui.historyExport.addEventListener("click", downloadRecord);
  ui.historyImport.addEventListener("change", () => {
    const file = ui.historyImport.files?.[0];
    if (file) uploadRecord(file);
  });

  ui.tune.addEventListener("click", startTuning);
  ui.tuningStop.addEventListener("click", stopTuning);
  paintTuning();
  ui.check.addEventListener("click", startCheck);
  ui.debugRecord.addEventListener("click", startDebug);
  ui.debugSave.addEventListener("click", saveDebug);
  ui.checkingStop.addEventListener("click", () => stopCheck());
  paintCheck();
  showCheatSheet(state.settings.cheat);

  ui.reset.addEventListener("click", () => {
    store.clear();
    state.cards = new Map();
    state.totals = { answered: 0, correct: 0 };
    state.session = history.newSession(Date.now());
    state.trial = 0;
    paintRecord();
    nextTrial();
  });

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.target instanceof HTMLSelectElement) return;
    // B is deliberately not bound: in German naming it means B flat, which is
    // never the answer here, so the key does nothing rather than standing in
    // for H.
    const letter = e.key.toUpperCase();
    if (LETTERS.includes(letter)) {
      e.preventDefault();
      answerLetter(letter);
    }
  });

  // Naming needs no setting up, so that button only has to close the
  // microphone. Playing is the one that asks for it, which is what makes
  // choosing it the deliberate act rather than a screen in front of the page.
  // Sets the two deck buttons and clears the microphone line, which is the
  // right state on every arrival: nothing is listening yet.
  setMicStatus({ listening: false, error: null });
  paintDeck();
  wireMenus();
  ui.nameDeck.addEventListener("click", () => {
    stopListening();
    setMode("typed");
  });
  ui.playDeck.addEventListener("click", () => {
    // A MIDI keyboard is already an instrument to play into, so there is
    // nothing to ask for. Otherwise this is the click that asks.
    if (state.midiDevice || audio.listening()) {
      setMode("played");
      return;
    }
    // Nothing to play into yet, so this is the click that asks — with the
    // menu open, since that is where the answer will appear.
    showMenu(ui.playMenu, true);
    startListening();
  });

  // Picking a source. The microphone is the one with a switch: choosing the
  // keyboard is a matter of getting out of the microphone's way.
  ui.useMidi.addEventListener("click", () => {
    stopListening();
    setMode("played");
  });
  ui.useMic.addEventListener("click", () => {
    if (audio.listening()) stopListening();
    else startListening();
  });

  midi.connect(soundAndAnswerMidi, (status) => {
    // Noted, not acted on: a keyboard appearing does not change what you
    // chose to practise. It just means Play the notes needs no microphone.
    state.midiDevice = status.deviceName;
    ui.midiStatus.textContent = status.deviceName ?? status.error ?? "nothing connected";
    ui.midiStatus.classList.toggle("is-off", !status.deviceName);
    paintSources();
  });

  paintRecord();
  nextTrial();
}

/** @param {unknown} err */
function reportStartupFailure(err) {
  // A page that is drawn but dead says nothing, and a blank staff is not a bug
  // report. Put the reason where it will be read: the verdict line if the page
  // has one, and failing that anywhere at all.
  const message = `Could not start: ${err instanceof Error ? err.message : err}`;
  const line = document.getElementById("verdict");
  if (line) {
    line.className = "verdict is-wrong";
    line.textContent = message;
    return;
  }
  const banner = document.createElement("p");
  banner.style.cssText = "margin:20px;padding:12px;background:#c9432c;color:#fff";
  banner.textContent = message;
  document.body.prepend(banner);
}

try {
  collectElements();
  init();
} catch (err) {
  reportStartupFailure(err);
  throw err;
}
