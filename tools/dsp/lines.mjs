// Lines of notes through the detector: how many are heard, misheard, missed
// and said to be missed, and how close the pitch and the attack come out.
//
//   node tools/dsp/lines.mjs [legato|staccato] [lines]
//
// Synthesised strings — twelve inharmonic partials, a decay by register, a
// weak fundamental or a stiff string now and then — played as four-note
// lines over the drill's compass, naturals only, a step to a fifth apart, at
// random loudness and 150 to 700ms apart. Legato holds each note on; staccato
// damps each one just before the next. Fed to createDetector a frame at a
// time, as the page does.
//
// Not part of the suite: it takes half a minute, and it is for deciding a
// constant, not for guarding one. The assertions over synthesised lines in
// tests/assertions.js are the guard. Node's own runtime, nothing installed.

import * as audio from "../../audio.js";

const SR = 48000;
/** Frames a second, as the display refreshes: `FPS=120` for a 120Hz screen. */
const FPS = Number(process.env.FPS ?? 60);
const FRAME = SR / FPS;
const legato = process.argv[2] !== "staccato";
const LINES = Number(process.argv[3]) || 250;
/**
 * Loudness of the hammer: a burst of noise at the attack, low-passed a little
 * and gone in about 30ms, relative to the string. Synthesised strings without
 * one flattered the detector — the rise between two spectra was all partials
 * and nothing else — and a real piano put octave errors there that clean
 * strings did not. `HAMMER=0` for the clean strings.
 */
const HAMMER = Number(process.env.HAMMER ?? 0);

/**
 * Loudness of the room: noise that rings on with each note, as reverberation
 * and a soundboard do, relative to the string. `ROOM=0` for none.
 */
const ROOM = Number(process.env.ROOM ?? 0);

/**
 * Peak amplitude of the steady noise under everything: a microphone's hiss
 * and the room's hum. The strings peak at about 0.2. Lower is a closer
 * microphone or a quieter room, and a cleaner signal is not an easier one:
 * with almost no noise the detector's idea of an ordinary frame shrinks to
 * nothing, which is how phantom strikes got in.
 */
const NOISE = Number(process.env.NOISE ?? 0.002);

let seed = 12345;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const NATURALS = [0, 2, 4, 5, 7, 9, 11];
const keys = [];
for (let m = 36; m <= 84; m++) if (NATURALS.includes(m % 12)) keys.push(m);
const hzOf = (m) => 440 * Math.pow(2, (m - 69) / 12);

function strike(sig, { midi, at, loud, off, fundamental, stiffness }) {
  const hz = hzOf(midi);
  const tau = midi < 48 ? 1.5 : midi < 72 ? 0.8 : 0.4;
  const phases = Array.from({ length: 12 }, () => rand() * 2 * Math.PI);
  let thump = 0;
  for (let i = Math.floor(at * SR); i < Math.min(sig.length, Math.floor((at + 0.12) * SR)); i++) {
    const t = i / SR - at;
    thump += 0.35 * ((rand() * 2 - 1) - thump);
    sig[i] += 0.1 * HAMMER * loud * Math.exp(-t / 0.012) * thump * 3;
  }
  for (let i = Math.floor(at * SR); i < sig.length; i++) {
    const t = i / SR - at;
    let env = loud * Math.exp(-t / tau) * Math.min(1, t / 0.004);
    if (i / SR > off) env *= Math.exp(-(i / SR - off) / 0.06);
    if (env < 1e-5 && t > 0.1) break;
    if (ROOM > 0) {
      thump += 0.2 * ((rand() * 2 - 1) - thump);
      sig[i] += 0.1 * ROOM * env * thump * 4;
    }
    let s = 0;
    for (let p = 1; p <= 12; p++) {
      const f = hz * p * Math.sqrt(1 + stiffness * p * p);
      if (f > SR / 2.4) break;
      s += ((p === 1 ? fundamental : 1) * Math.sin(2 * Math.PI * f * t + phases[p - 1])) / p;
    }
    sig[i] += 0.1 * env * s;
  }
}

const tally = { heard: 0, misheard: 0, reported: 0, silent: 0 };
const cents = [];
const timing = [];
const misheard = [];

for (let line = 0; line < LINES; line++) {
  let k = 5 + Math.floor(rand() * (keys.length - 10));
  const notes = [];
  let at = 0.8;
  for (let i = 0; i < 4; i++) {
    notes.push({
      midi: keys[k],
      at,
      loud: 0.3 + rand() * 0.7,
      off: Infinity,
      fundamental: rand() < 0.3 ? 0.15 : 1,
      stiffness: rand() < 0.3 ? 1e-3 : 2e-4,
    });
    at += 0.15 + rand() * 0.55;
    const step = [-4, -3, -2, -1, 1, 2, 3, 4][Math.floor(rand() * 8)];
    k = Math.max(0, Math.min(keys.length - 1, k + step));
  }
  if (!legato) notes.forEach((n, i) => notes[i + 1] && (n.off = notes[i + 1].at - 0.02));

  const seconds = at + 1;
  const sig = new Float32Array(Math.ceil(seconds * SR));
  for (const n of notes) strike(sig, n);
  for (let i = 0; i < sig.length; i++) sig[i] += (rand() - 0.5) * NOISE;

  const detector = audio.createDetector(SR);
  const strikes = [];
  for (let f = 0; ; f++) {
    const end = Math.round(audio.WINDOW + f * FRAME);
    if (end > sig.length) break;
    const now = (end / SR) * 1000;
    for (const s of detector.frame(sig.subarray(end - audio.WINDOW, end), now).strikes) {
      strikes.push({ ...s, when: s.kind === "heard" ? s.at : now });
    }
  }

  // Each note owns the strikes from its attack to the next note's, less a
  // little: an attack over a ringing note is placed to within about ten
  // milliseconds, either way.
  notes.forEach((n, i) => {
    const from = n.at * 1000 - 25;
    const to = (notes[i + 1] ? notes[i + 1].at : seconds) * 1000 - 25;
    const mine = strikes.filter((s) => s.when >= from && s.when < to);
    const heard = mine.find((s) => s.kind === "heard");
    if (!heard) {
      tally[mine.length ? "reported" : "silent"] += 1;
      return;
    }
    if (audio.midiFor(heard.hz) !== n.midi) {
      tally.misheard += 1;
      misheard.push(`${n.midi} as ${audio.midiFor(heard.hz)}, ${heard.over ? "over a ringing note" : "over silence"}`);
      return;
    }
    tally.heard += 1;
    cents.push(Math.abs(audio.centsOff(heard.hz)));
    timing.push(heard.at - n.at * 1000);
  });
}

const pct = (xs, q) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)];
const total = LINES * 4;
console.log(`${legato ? "legato" : "staccato"}, ${total} notes`);
for (const [what, n] of Object.entries(tally)) {
  console.log(`  ${what.padEnd(9)} ${String(n).padStart(5)}  ${((100 * n) / total).toFixed(1)}%`);
}
console.log(`  pitch     median ${pct(cents, 0.5).toFixed(1)}¢, 95% within ${pct(cents, 0.95).toFixed(1)}¢`);
console.log(`  attack    95% between ${pct(timing, 0.025).toFixed(1)} and ${pct(timing, 0.975).toFixed(1)}ms`);
for (const line of misheard.slice(0, 10)) console.log(`  misheard: ${line}`);
