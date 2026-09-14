// A debug recording, played back through the detector.
//
//   node tools/dsp/replay.mjs <recording.wav> [--from seconds] [--to seconds] [--shift samples]
//
// The page's `Record for debugging` saves the microphone as it arrived, with
// a log inside the same file: every frame the detector ran on — when, and on
// the audio context's clock, which says the samples its window ended on — and
// everything that happened: strikes, lines, answers. This runs createDetector
// over the same windows at the same times, and prints what it heard beside
// what the page logged, so a change to audio.js can be tried against a real
// piano without the piano. Without a log it steps through at 60 frames a
// second instead.
//
// Where the two columns disagree for an unchanged audio.js, the windows are
// not quite the ones the page had — the context's clock is exact only to a
// render block — and that is worth knowing before trusting a comparison.
// `--shift` moves every window by that many samples, which is how a strike
// the page named and the replay does not can be found: a reading on the edge
// of a decision goes one way or the other within a block.

import { readFileSync } from "node:fs";
import * as audio from "../../audio.js";

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--"));
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
if (!path) {
  console.log("usage: node tools/dsp/replay.mjs <recording.wav> [--from seconds] [--to seconds] [--shift samples]");
  process.exit(1);
}

const bytes = readFileSync(path);
const { samples, sampleRate, log: text } = audio.decodeWav(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const log = text ? JSON.parse(text) : null;
const W = audio.WINDOW;

/** Frames as [now, window end sample]. */
let frames;

const shift = flag("shift", 0);
if (log?.frames?.length) {
  frames = log.frames.map(([now, contextTime]) => [
    now,
    Math.round(contextTime * sampleRate) - log.firstFrame + shift,
  ]);
} else {
  const hop = Math.round(sampleRate / 60);
  frames = [];
  for (let end = W; end <= samples.length; end += hop) frames.push([(end / sampleRate) * 1000, end]);
}
const origin = frames[0]?.[0] ?? 0;
const secs = (now) => (now - origin) / 1000;
const from = flag("from", -Infinity);
const to = flag("to", Infinity);

const detector = audio.createDetector(sampleRate);
const tuning = log?.settings?.tuningCents ?? 0;
const rows = [];
/** Notes the replay named, for checking against the audio below. */
const named = [];
let skipped = 0;
for (const [now, end] of frames) {
  if (end < W || end > samples.length) {
    skipped += 1;
    continue;
  }
  for (const s of detector.frame(samples.subarray(end - W, end), now).strikes) {
    if (s.kind === "heard") named.push({ t: now, at: s.at, midi: audio.midiFor(s.hz, tuning) });
    const what =
      s.kind === "heard"
        ? `heard ${name(audio.midiFor(s.hz, tuning))} ${signed(audio.centsOff(s.hz, tuning))}¢` +
          ` ${s.over ? "over" : "plain"} ${s.clarity.toFixed(2)}, struck ${secs(s.at).toFixed(3)}`
        : s.kind + (s.rise ? ` ×${s.rise.toFixed(2)}` : "");
    rows.push({ t: now, side: "replay", what });
  }
}

for (const e of log?.events ?? []) {
  let what;
  if (e.type === "strike") {
    what =
      e.kind === "heard"
        ? `heard ${e.name} ${signed(e.cents)}¢ ${e.over ? "over" : "plain"} ${Number(e.clarity).toFixed(2)}`
        : e.kind + (e.rise ? ` ×${Number(e.rise).toFixed(2)}` : "");
  } else if (e.type === "answer") {
    what = `${e.correct ? "✓" : "✗"} ${e.expected}${e.correct ? "" : ` answered ${e.given}`}` +
      (e.latencyMs === null ? "" : ` in ${e.latencyMs}ms`);
  } else if (e.type === "correction") {
    what = `  retry ${e.expected}: ${e.given} ${e.correct ? "✓" : "✗"}`;
  } else if (e.type === "line") {
    what = `— ${e.test ? "test " : ""}line ${e.notes.join(" ")}`;
  } else if (e.type === "check") {
    what = e.marks.map((m) => `${m.note} ${m.result}`).join(", ");
  } else {
    what = e.type;
  }
  rows.push({ t: e.t, side: "page", what });
}

rows.sort((a, b) => a.t - b.t || (a.side === "page" ? 1 : -1));
console.log(
  `${path}: ${(samples.length / sampleRate).toFixed(1)}s at ${sampleRate}Hz, ` +
    `${frames.length} frames${log ? " from the log" : " at 60/s"}` +
    (skipped ? `, ${skipped} outside the audio` : ""),
);
if (log) console.log(`recorded ${log.started}, ${log.device}; settings ${JSON.stringify(log.settings)}`);
console.log("");
console.log("     time  replay".padEnd(58) + "page");
for (const r of rows) {
  const t = secs(r.t);
  if (t < from || t > to) continue;
  const stamp = t.toFixed(3).padStart(9);
  console.log(r.side === "replay" ? `${stamp}  ${r.what}` : `${stamp}  ${"".padEnd(47)}${r.what}`);
}

const heard = (side) => rows.filter((r) => r.side === side && r.what.startsWith("heard")).length;
const answers = (log?.events ?? []).filter((e) => e.type === "answer");
console.log("");
console.log(
  `replay heard ${heard("replay")}, the page heard ${heard("page")}` +
    (answers.length ? `; ${answers.filter((a) => !a.correct).length} of ${answers.length} answers wrong` : ""),
);

// Each note the replay named, checked against the recording itself: the
// period finder over a window from 150 to 235ms after the attack, where the
// new note has the window mostly to itself and a single piano note reads
// cleanly. Not proof — a note struck under a louder one still ringing will
// disagree here and be right — but a misreading shows up as a disagreement,
// and a phantom as the same note again straight after itself.
{
  const flagged = [];
  let previous = null;
  for (const n of named) {
    const later = sampleAt(n.at + 235);
    let check = "";
    if (later !== null && later >= W && later <= samples.length) {
      const { hz, clarity } = audio.analyse(samples.subarray(later - W, later), sampleRate);
      const midi = audio.midiFor(hz, tuning);
      if (clarity >= audio.ACCEPT_CLARITY && midi !== n.midi) check = `later reads ${name(midi)} (${clarity.toFixed(2)})`;
    }
    if (previous && previous.midi === n.midi && n.at - previous.at < 600) {
      check += `${check ? "; " : ""}same as the note ${Math.round(n.at - previous.at)}ms before`;
    }
    if (check) flagged.push(`${secs(n.t).toFixed(3)}s ${name(n.midi)}: ${check}`);
    previous = n;
  }
  console.log(`${named.length - flagged.length} of ${named.length} notes check out against the audio after them`);
  for (const f of flagged) console.log(`  ? ${f}`);
}

/** The sample a frame at this page time would have ended its window on. */
function sampleAt(now) {
  let lo = 0;
  let hi = frames.length - 1;
  if (!frames.length || now < frames[0][0]) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid][0] <= now) lo = mid;
    else hi = mid - 1;
  }
  const [t, end] = frames[lo];
  return end + Math.round(((now - t) / 1000) * sampleRate);
}

function name(midi) {
  const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "H"];
  return Number.isFinite(midi) ? names[midi % 12] + (Math.floor(midi / 12) - 1) : "?";
}

function signed(x) {
  return Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x))}` : "?";
}
