// Persistence. localStorage is synchronous and tiny, which is exactly right
// for a few dozen cards, and it needs no server.

import { newCard, decay } from "./scheduler.js";
import { everyNote } from "./notes.js";

// One roster, then three keys per player: the scheduler's cards, the
// settings, and the history. Namespaced rather than merged into one blob so
// that a trial's worth of writing touches only the small parts.
const ROSTER_KEY = "sightread.players.v1";
const LEGACY_CARDS_KEY = "sightread.v1";
const LEGACY_SETTINGS_KEY = "sightread.settings.v1";

/** @param {string} playerId @param {string} what */
function key(playerId, what) {
  return `sightread.p.${playerId}.${what}.v1`;
}

/** @param {string} k @param {any} fallback */
function read(k, fallback) {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    // Private browsing, storage off, or something else's key in our slot.
    return fallback;
  }
}

/** @param {string} k @param {unknown} value */
function write(k, value) {
  try {
    localStorage.setItem(k, JSON.stringify(value));
    return true;
  } catch {
    // Quota, or disabled storage. Losing the record is not worth breaking
    // the drill over, but the caller may want to say so.
    return false;
  }
}

/** @param {string} k */
function drop(k) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* nothing to do */
  }
}

/**
 * @typedef {{id: string, name: string}} Player
 * @returns {{active: string, players: Player[]}}
 */
export function roster() {
  const stored = read(ROSTER_KEY, null);
  if (stored?.players?.length) {
    const players = stored.players
      .filter((p) => p && typeof p.id === "string" && typeof p.name === "string")
      .map((p) => ({ id: p.id, name: p.name }));
    if (players.length) {
      const active = players.some((p) => p.id === stored.active) ? stored.active : players[0].id;
      return { active, players };
    }
  }
  return adoptLegacy();
}

/**
 * First run under the new layout. Whatever was stored before belongs to
 * somebody, so it becomes a player rather than being abandoned — named
 * generically because there is no way to know whose it was, and renameable.
 * @returns {{active: string, players: Player[]}}
 */
function adoptLegacy() {
  const made = { active: "1", players: [{ id: "1", name: "Player 1" }] };
  write(ROSTER_KEY, made);
  const cards = read(LEGACY_CARDS_KEY, null);
  if (cards) {
    write(key("1", "cards"), cards);
    drop(LEGACY_CARDS_KEY);
  }
  const settings = read(LEGACY_SETTINGS_KEY, null);
  if (settings) {
    write(key("1", "settings"), settings);
    drop(LEGACY_SETTINGS_KEY);
  }
  return made;
}

function activeId() {
  return roster().active;
}

/** @param {string} name @returns {Player} */
export function addPlayer(name) {
  const { players } = roster();
  const taken = new Set(players.map((p) => Number(p.id)));
  let id = 1;
  while (taken.has(id)) id += 1;
  const player = { id: String(id), name: cleanName(name, `Player ${id}`) };
  write(ROSTER_KEY, { active: player.id, players: [...players, player] });
  return player;
}

/** @param {string} id @param {string} name */
export function renamePlayer(id, name) {
  const { active, players } = roster();
  const renamed = players.map((p) => (p.id === id ? { ...p, name: cleanName(name, p.name) } : p));
  write(ROSTER_KEY, { active, players: renamed });
}

/** @param {string} id */
export function setActivePlayer(id) {
  const { players } = roster();
  if (!players.some((p) => p.id === id)) return;
  write(ROSTER_KEY, { active: id, players });
}

/** @param {string} name @param {string} fallback */
function cleanName(name, fallback) {
  const trimmed = String(name ?? "").trim().slice(0, 40);
  return trimmed || fallback;
}

/** @typedef {import("./scheduler.js").Card} Card */

/**
 * Card ids are built from the note's letter name, so the switch to German
 * naming renamed every B card to H. Rewrite the old ids on load rather than
 * bumping KEY, which would throw away the history of four perfectly good
 * notes. An id that has already been renamed wins over a stale duplicate.
 * @param {Record<string, unknown>} raw ids as stored
 * @returns {Record<string, unknown>}
 */
export function renameLegacyIds(raw) {
  const out = {};
  for (const [id, c] of Object.entries(raw)) {
    const renamed = id.replace(/:B(-?\d+)$/, ":H$1");
    if (renamed !== id && renamed in raw) continue;
    out[renamed] = c;
  }
  return out;
}

/**
 * Drop the clef from card ids, pooling the two that then collide.
 *
 * Ids used to be clef-qualified, "treble:C4" and "bass:C4" being different
 * items. On a grand staff they are the same dot in the same place, so they
 * are one item, and the two histories have to become one rather than one of
 * them winning. Counts add; the averages are pooled by how much each was
 * based on, which is what you would have had if it had been one card all
 * along.
 *
 * @param {Record<string, any>} raw
 * @returns {Record<string, any>}
 */
export function mergeClefIds(raw) {
  const out = /** @type {Record<string, any>} */ ({});
  for (const [id, c] of Object.entries(raw)) {
    const prefix = id.slice(0, id.indexOf(":"));
    const pitch = prefix === "treble" || prefix === "bass" ? id.slice(prefix.length + 1) : id;
    const first = out[pitch];
    if (!first) {
      out[pitch] = c;
      continue;
    }
    const a = Math.max(Number(first.seen) || 0, 0);
    const b = Math.max(Number(c.seen) || 0, 0);
    const total = a + b;
    const pooled = (x, y) => (total > 0 ? (Number(x) * a + Number(y) * b) / total : Number(x));
    out[pitch] = {
      ewma: pooled(first.ewma, c.ewma),
      errorRate: pooled(first.errorRate, c.errorRate),
      seen: total,
      missed: (Number(first.missed) || 0) + (Number(c.missed) || 0),
    };
  }
  return out;
}

/**
 * Give ids that predate the split by input mode one.
 *
 * Everything recorded before there were two decks goes to the typed one.
 * Some of it was played, but the letter keys were the main way in and there
 * is nothing in the record to tell them apart — so the choice is between one
 * defensible guess and throwing the history away.
 *
 * @param {Record<string, any>} raw
 * @param {string} mode
 * @returns {Record<string, any>}
 */
export function tagUntaggedIds(raw, mode) {
  const out = /** @type {Record<string, any>} */ ({});
  for (const [id, c] of Object.entries(raw)) {
    out[id.includes(":") ? id : `${mode}:${id}`] = c;
  }
  return out;
}

/**
 * @returns {{cards: Map<string, Card>, lastSeenIso: string | null, totals: {answered: number, correct: number}}}
 */
export function load() {
  const empty = { cards: new Map(), lastSeenIso: null, totals: { answered: 0, correct: 0 } };
  let raw;
  try {
    raw = localStorage.getItem(key(activeId(), "cards"));
  } catch {
    // Private browsing, or storage disabled. Run without history.
    return empty;
  }
  if (!raw) return empty;

  try {
    const parsed = JSON.parse(raw);
    const cards = new Map();
    const migrated = tagUntaggedIds(mergeClefIds(renameLegacyIds(parsed.cards ?? {})), "typed");
    for (const [id, c] of Object.entries(migrated)) {
      cards.set(id, {
        ewma: Number(c.ewma),
        errorRate: Number(c.errorRate),
        seen: Number(c.seen),
        // Counted only since the accuracy column existed, so cards from
        // before it start at nought missed and read high until they catch up.
        missed: Number(c.missed) || 0,
        // Likewise: an old card's measurements were not counted, so it falls
        // back to its trial count, which is what they used to be.
        timed: Number.isFinite(Number(c.timed)) ? Number(c.timed) : Number(c.seen) || 0,
        // Trial indices are per-session; nothing carries over.
        lastTrial: -Infinity,
      });
    }
    return {
      cards,
      lastSeenIso: parsed.lastSeenIso ?? null,
      totals: {
        answered: Number(parsed.totals?.answered ?? 0),
        correct: Number(parsed.totals?.correct ?? 0),
      },
    };
  } catch {
    return empty;
  }
}

/**
 * @param {{cards: Map<string, Card>, totals: {answered: number, correct: number}}} state
 */
export function save(state) {
  const cards = {};
  for (const [id, c] of state.cards) {
    cards[id] = {
      ewma: c.ewma,
      errorRate: c.errorRate,
      seen: c.seen,
      missed: c.missed,
      timed: c.timed,
    };
  }
  try {
    localStorage.setItem(
      key(activeId(), "cards"),
      JSON.stringify({ cards, totals: state.totals, lastSeenIso: new Date().toISOString() }),
    );
  } catch {
    // Quota or disabled storage. Losing history is not worth breaking the drill.
  }
}

/** Forget the active player's card history. Sessions and settings stay. */
export function clear() {
  drop(key(activeId(), "cards"));
}

/**
 * Apply between-session forgetting to everything loaded from disk.
 * @param {Map<string, Card>} cards
 * @param {string | null} lastSeenIso
 * @param {Date} now
 */
export function applyDecay(cards, lastSeenIso, now = new Date()) {
  if (!lastSeenIso) return cards;
  const days = (now.getTime() - Date.parse(lastSeenIso)) / 86_400_000;
  if (!(days > 0)) return cards;
  const out = new Map();
  for (const [id, c] of cards) out.set(id, decay(c, days));
  return out;
}

/** @param {Map<string, Card>} cards @param {string} id */
export function cardFor(cards, id) {
  let c = cards.get(id);
  if (!c) {
    c = newCard();
    cards.set(id, c);
  }
  return c;
}

// --- the record -----------------------------------------------------------

/**
 * Sessions are kept in two places: the one in progress on its own, and the
 * closed ones in a list. A trial's worth of writing then touches a record of
 * a few hundred bytes rather than rewriting every session ever played.
 *
 * @returns {import("./history.js").Session[]} oldest first
 */
export function loadSessions() {
  const stored = read(key(activeId(), "sessions"), null);
  const closed = Array.isArray(stored?.sessions) ? stored.sessions : [];
  const current = read(key(activeId(), "current"), null);
  return current ? [...closed, current] : closed;
}

/** @param {import("./history.js").Session} session */
export function saveCurrentSession(session) {
  return write(key(activeId(), "current"), session);
}

/**
 * Move the session in progress onto the list of closed ones. Called when a
 * gap has ended it, so the list only ever grows by one at a time.
 */
export function closeCurrentSession() {
  const current = read(key(activeId(), "current"), null);
  if (!current) return;
  const stored = read(key(activeId(), "sessions"), null);
  const closed = Array.isArray(stored?.sessions) ? stored.sessions : [];
  // A session with nothing in it is not worth a row in the history.
  if (Object.keys(current.cards ?? {}).length > 0) {
    write(key(activeId(), "sessions"), { sessions: [...closed, current] });
  }
  drop(key(activeId(), "current"));
}

// --- moving it off this machine -------------------------------------------

/**
 * Everything, as one object. localStorage is not a safe place for months of
 * anything: clearing site data takes it, a private window never had it, and
 * browser housekeeping is entitled to it. This is the way out.
 * @returns {object}
 */
export function exportAll() {
  const { active, players } = roster();
  return {
    format: "note-reading/1",
    exported: new Date().toISOString(),
    active,
    players: players.map((p) => ({
      ...p,
      cards: read(key(p.id, "cards"), null),
      settings: read(key(p.id, "settings"), null),
      sessions: read(key(p.id, "sessions"), null),
      current: read(key(p.id, "current"), null),
    })),
  };
}

/**
 * Load an export back. Players are matched by name and replaced wholesale
 * rather than merged: merging two records of the same sessions would
 * double-count them, and there is no way to tell a repeat from a duplicate.
 * @param {any} data
 * @returns {{added: string[], replaced: string[]}}
 */
export function importAll(data) {
  if (data?.format !== "note-reading/1" || !Array.isArray(data.players)) {
    throw new Error("that is not a note-reading export");
  }
  const existing = roster();
  const byName = new Map(existing.players.map((p) => [p.name, p]));
  const players = [...existing.players];
  const added = [];
  const replaced = [];

  for (const incoming of data.players) {
    const name = cleanName(incoming?.name, "");
    if (!name) continue;
    let target = byName.get(name);
    if (target) {
      replaced.push(name);
    } else {
      const taken = new Set(players.map((p) => Number(p.id)));
      let id = 1;
      while (taken.has(id)) id += 1;
      target = { id: String(id), name };
      players.push(target);
      byName.set(name, target);
      added.push(name);
    }
    for (const what of ["cards", "settings", "sessions", "current"]) {
      if (incoming[what]) write(key(target.id, what), incoming[what]);
      else drop(key(target.id, what));
    }
  }

  write(ROSTER_KEY, { active: existing.active, players });
  return { added, replaced };
}

// --- settings -------------------------------------------------------------

/**
 * @returns {{clefs: string, ledgers: number, cheat: boolean, tuningCents: number,
 *   lowest: number, highest: number}}
 */
export function loadSettings() {
  const notes = everyNote();
  const lowest = notes[0];
  const highest = notes[notes.length - 1];
  const fallback = {
    clefs: "both",
    ledgers: 0,
    cheat: false,
    /** Which span of the record the panel is showing. */
    span: "session",
    sound: false,
    tuningCents: 0,
    lowest,
    highest,
  };
  /** @param {unknown} v @param {number} dflt */
  const pitch = (v, dflt) => (notes.includes(/** @type {number} */ (v)) ? v : dflt);
  try {
    const raw = localStorage.getItem(key(activeId(), "settings"));
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return {
      clefs: ["treble", "bass", "both"].includes(p.clefs) ? p.clefs : fallback.clefs,
      ledgers: [0, 1, 2].includes(p.ledgers) ? p.ledgers : fallback.ledgers,
      cheat: p.cheat === true,
      span: ["session", "today", "week", "month"].includes(p.span) ? p.span : fallback.span,
      sound: p.sound === true,
      // Clamped: a piano two whole tones out is a misdetection, not a tuning.
      tuningCents: Number.isFinite(p.tuningCents)
        ? Math.max(-200, Math.min(200, Math.round(p.tuningCents)))
        : fallback.tuningCents,
      lowest: pitch(p.lowest, lowest),
      highest: pitch(p.highest, highest),
    };
  } catch {
    return fallback;
  }
}

/** @param {ReturnType<typeof loadSettings>} s */
export function saveSettings(s) {
  try {
    localStorage.setItem(key(activeId(), "settings"), JSON.stringify(s));
  } catch {
    /* not worth breaking the drill over */
  }
}
