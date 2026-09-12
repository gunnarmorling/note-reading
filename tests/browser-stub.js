// Enough of a browser to boot the app and see whether it survives.
//
// This one is a fiction, unlike tests/dom-stub.js, and it is worth being
// honest about what that means: it answers the questions the app asks, in the
// shapes the app expects, and nothing here proves the real browser answers
// the same way. What it does catch is the class of mistake that costs an
// afternoon — an element the page no longer has, a function deleted by a
// careless edit, a paint that throws on a fresh record — and it catches them
// in about fifty milliseconds.
//
// It cannot see CSS at all. Every layout and every visual state is outside
// its reach.

import { readFileSync } from "node:fs";

class Element {
  constructor(tag, ns = null) {
    this.tagName = tag;
    this.ns = ns;
    this.attributes = {};
    this.childNodes = [];
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.id = "";
    this._class = "";
    this._text = "";
    this._cls = null;

    this.classList = {
      add: (...cs) => {
        for (const c of cs) this.#classes()[c] = 1;
        this.#syncClass();
      },
      remove: (...cs) => {
        for (const c of cs) delete this.#classes()[c];
        this.#syncClass();
      },
      contains: (c) => Boolean(this.#classes()[c]),
      toggle: (c, force) => {
        const on = force === undefined ? !this.#classes()[c] : Boolean(force);
        if (on) this.#classes()[c] = 1;
        else delete this.#classes()[c];
        this.#syncClass();
        return on;
      },
    };
  }

  #classes() {
    if (!this._cls) {
      this._cls = {};
      for (const part of (this.className || "").split(/\s+/)) if (part) this._cls[part] = 1;
    }
    return this._cls;
  }

  #syncClass() {
    // Straight to the field: the setter would clear the cache being synced.
    this._class = Object.keys(this._cls ?? {}).join(" ");
    this.attributes["class"] = this._class;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") {
      this._class = String(value);
      this._cls = null;
    }
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }

  appendChild(node) {
    this.childNodes.push(node);
    return node;
  }

  append(...nodes) {
    this.childNodes.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.childNodes = nodes;
  }

  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }

  /** Fire a listener the way a click or a keypress would. */
  dispatch(type, event = {}) {
    for (const fn of this.listeners[type] ?? []) fn.call(this, event);
  }

  get children() {
    return this.childNodes;
  }

  get className() {
    return this._class;
  }

  set className(value) {
    this._class = String(value);
    this.attributes["class"] = this._class;
    this._cls = null;
  }

  get textContent() {
    return this._text;
  }

  set textContent(value) {
    this._text = String(value);
    this.childNodes = [];
  }
}

/**
 * Install the fiction. Returns the handles a test needs to drive it: the
 * clock, the frame and timer queues, and what came out of the speaker.
 *
 * @param {string} pageHtml the real index.html, so that the ids the app looks
 *   up are the ids the page actually has — a missing one is the failure this
 *   is most often here to catch.
 */
export function install(pageHtml, target = globalThis) {
  const byId = {};
  for (const id of new Set(pageHtml.match(/id="([^"]+)"/g)?.map((m) => m.slice(4, -1)) ?? [])) {
    const el = new Element("div");
    el.id = id;
    byId[id] = el;
  }

  const store = {};
  let now = 0;
  let frames = [];
  let timers = [];
  const sounded = [];
  const reloads = { count: 0 };

  const document = {
    createElement: (tag) => new Element(tag),
    createElementNS: (ns, tag) => new Element(tag, ns),
    getElementById: (id) => byId[id] ?? null,
    listeners: {},
    addEventListener(type, fn) {
      (document.listeners[type] ??= []).push(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of document.listeners[type] ?? []) fn(event);
    },
    body: new Element("body"),
  };

  class AudioContext {
    constructor() {
      this.state = "running";
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.destination = { kind: "speaker" };
    }
    resume() {
      return Promise.resolve();
    }
    close() {}
    createGain() {
      const ramp = () => {};
      return {
        gain: {
          value: 1,
          setValueAtTime: ramp,
          linearRampToValueAtTime: ramp,
          exponentialRampToValueAtTime: ramp,
        },
        connect: () => {},
      };
    }
    createOscillator() {
      const node = {
        type: "",
        frequency: { value: 0 },
        connect: () => {},
        start: () => sounded.push(Math.round(node.frequency.value * 100) / 100),
        stop: () => {},
      };
      return node;
    }
    createAnalyser() {
      return { fftSize: 0, getFloatTimeDomainData: () => {} };
    }
    createMediaStreamSource() {
      return { connect: () => {} };
    }
  }

  const win = {
    isSecureContext: true,
    innerWidth: 1280,
    innerHeight: 900,
    listeners: {},
    addEventListener(type, fn) {
      (win.listeners[type] ??= []).push(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of win.listeners[type] ?? []) fn(event);
    },
    location: { reload: () => (reloads.count += 1) },
    AudioContext,
  };

  // Defined rather than assigned: node has real `navigator`, `performance`,
  // `setTimeout` and `URL` globals, and some of them are getter-only.
  const globals = {
    document,
    window: win,
    location: win.location,
    navigator: {}, // no Web MIDI and no mediaDevices: both are optional
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => void (store[k] = String(v)),
      removeItem: (k) => void delete store[k],
    },
    performance: { now: () => ++now },
    requestAnimationFrame: (cb) => frames.push(cb),
    cancelAnimationFrame: () => {},
    setTimeout: (cb, ms) => timers.push([cb, ms]),
    AudioContext,
    Blob: class Blob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = opts?.type;
      }
    },
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
    HTMLSelectElement: class HTMLSelectElement {},
    HTMLButtonElement: class HTMLButtonElement {},
  };
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(target, name, { value, writable: true, configurable: true });
  }

  return {
    store,
    sounded,
    reloads,
    el: (id) => byId[id] ?? null,
    /** Push the clock forward, to stage a pause the drill should not time. */
    advance: (ms) => void (now += ms),
    flushFrames(rounds = 8) {
      for (let i = 0; i < rounds; i++) {
        const batch = frames;
        frames = [];
        for (const cb of batch) cb(now);
      }
    },
    flushTimers() {
      const batch = timers;
      timers = [];
      for (const [cb] of batch) cb();
    },
  };
}

export { Element };
