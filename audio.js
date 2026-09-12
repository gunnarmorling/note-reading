// The sound card, both ways.
//
// Microphone input, so the answer can be the note you actually play on an
// acoustic piano. Optional, like MIDI. And at the end of the file, playing a
// note back, which is the same hardware and the same permissionless-output
// rules, so it lives here rather than in a file of its own.
//
// Nothing leaves the page. The samples are analysed in place and this app has
// no network code at all.
//
// Two problems have to be solved here, and they are not the same problem.
//
// What was played is answered by the McLeod pitch method: the normalised
// square difference function over the window, then the *first* peak that
// comes within PEAK_RATIO of the tallest one. Plain autocorrelation takes the
// tallest peak instead, which on a piano is very often twice the true period,
// and "an octave down" is the one error that would make this unusable. Piano
// partials are also slightly inharmonic and the fundamental of a low note can
// be quieter than its harmonics, both of which fool a spectral peak-finder;
// periodicity in the time domain survives them.
//
// When it was played is answered separately, and earlier, by watching the
// level for an attack. Pitch needs a windowful of note before it settles, so
// timing the note by the moment its pitch is known would add most of a window
// to every latency. The attack is found inside the window instead and the
// answer is timestamped there.

// median lives with the scheduler's other pure statistics; the tuning maths
// wants it too rather than a second copy.
import { median } from "./scheduler.js";

/** Analysis window. Holds five periods of the lowest note the drill uses. */
export const WINDOW = 4096;

/**
 * Search range for the fundamental. The drill's lowest note is C2, 65.4Hz;
 * the bottom of the range sits just under it and, usefully, above the 60Hz
 * mains hum that would otherwise be the most periodic thing in the room.
 */
export const MIN_HZ = 62;
export const MAX_HZ = 1400;

/** How close to the tallest NSDF peak a peak must be to be taken instead. */
export const PEAK_RATIO = 0.9;

/** Tallest peak below this and the window isn't a note. Noise scores ~0.05. */
export const MIN_CLARITY = 0.5;

/** Samples per envelope step, for locating the attack within the window. */
export const ENVELOPE_BLOCK = 128;

/**
 * An attack is never looked for further back in the window than this. A note
 * struck over silence trips the level test on the first frame after it, one
 * struck over a ringing note within two or three, so the attack is always
 * recent; this bounds how far a misplaced jump can throw the timing.
 */
export const ATTACK_LOOKBACK_MS = 60;

/**
 * How far above the room a note has to be. An absolute threshold was the
 * first attempt and it was a mistake: what reaches the analyser depends on
 * the microphone's gain, how far away the piano is and how hard the room
 * reflects, which vary by orders of magnitude between one setup and the next.
 * A number that works across a room from a quiet upright is one that a close
 * microphone crosses by breathing.
 */
export const NOISE_MARGIN = 3;

/** Absolute floor, so that digital silence can't be exceeded by three times. */
export const SILENCE_FLOOR = 0.0003;

/** Per-frame tracking of the room: quick to follow it down, slow up. */
export const NOISE_FALL = 0.25;
export const NOISE_RISE = 0.002;

/** Where the noise follower starts, before it has heard the room. */
export const NOISE_INITIAL = 0.05;

/** Rise over the decaying peak that counts as a new note being struck. */
export const ONSET_RATIO = 1.5;

/** Per-frame decay of the peak follower an onset is measured against. */
export const PEAK_DECAY = 0.92;

/** A second onset inside this is the same strike, not another note. */
export const REFRACTORY_MS = 120;

/** Give up identifying a strike after this and wait for the next one. */
export const GIVE_UP_MS = 500;

/**
 * Clarity required to believe a reading, as opposed to the lower bar for
 * "this window contains some note or other". The attack transient is a good
 * deal less periodic than the string that follows it.
 */
export const ACCEPT_CLARITY = 0.7;

/**
 * How close two readings have to be to count as the same note. Compared in
 * cents rather than as rounded note numbers, so that two readings either side
 * of a semitone boundary are not mistaken for agreement, and so that nothing
 * here needs to know what the piano is tuned to.
 */
export const AGREE_CENTS = 40;

/**
 * How far from a semitone a reading may sit and still be called that note.
 *
 * Out of a possible fifty, so this rejects only the outer fifth of each
 * semitone's window — where the reading is so nearly equidistant between two
 * notes that calling it either is a guess. A guess scored as an answer is a
 * wrong answer you did not play, which is worse than no answer at all: it
 * moves the error rate for a note you may well know.
 */
export const AMBIGUOUS_CENTS = 40;

/**
 * Readings this far apart are indistinguishable from a piano at concert
 * pitch, and a scalar offset is the wrong model for anything smaller.
 *
 * A piano does not have one offset. Octaves are deliberately stretched —
 * bass flat, treble sharp, by tens of cents at the extremes — so the
 * deviation genuinely differs by register. On top of that a string's sharp
 * upper partials pull the period estimate sharp by several cents of their
 * own, and by a different amount per note. What's left over is worth
 * correcting only when it's large, which is the case this exists for: an
 * instrument at A=435, or a digital piano someone has transposed.
 */
export const TUNING_DEADBAND_CENTS = 20;

/**
 * What to allow for, given one cents reading per note sampled.
 *
 * The spread comes back too, because it is the part worth knowing: a run
 * whose notes disagree by more than the median is not measuring the piano.
 *
 * @param {number[]} readings
 * @returns {{cents: number, measured: number, spread: number}}
 */
export function tuningOffset(readings) {
  const measured = Math.round(median(readings));
  return {
    cents: Math.abs(measured) < TUNING_DEADBAND_CENTS ? 0 : measured,
    measured,
    spread: Math.round(Math.max(...readings) - Math.min(...readings)),
  };
}

/** Interval between two frequencies, in cents. */
export function centsBetween(a, b) {
  return 1200 * Math.log2(a / b);
}

/**
 * Nearest MIDI note to a frequency, or NaN, allowing for a piano that isn't
 * at concert pitch. `offsetCents` is how sharp the instrument reads.
 * @param {number} hz
 * @param {number} [offsetCents]
 * @returns {number}
 */
export function midiFor(hz, offsetCents = 0) {
  if (!(hz > 0)) return NaN;
  return Math.round(69 + 12 * Math.log2(hz / 440) - offsetCents / 100);
}

/**
 * How far a frequency sits from the nearest note, in cents, once the
 * instrument's own offset is allowed for. Positive is sharp.
 * @param {number} hz
 * @param {number} [offsetCents]
 * @returns {number}
 */
export function centsOff(hz, offsetCents = 0) {
  const note = midiFor(hz, offsetCents);
  if (!Number.isFinite(note)) return NaN;
  return centsBetween(hz, 440 * Math.pow(2, (note - 69) / 12)) - offsetCents;
}

/**
 * Root mean square of a window: how loud it is.
 * @param {Float32Array} buf
 * @returns {number}
 */
export function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/**
 * Coarse amplitude envelope, one value per ENVELOPE_BLOCK samples. Raw
 * samples are useless for finding an attack — a note's waveform passes
 * through zero twice a cycle — so the shape has to be taken in blocks.
 * @param {Float32Array} buf
 * @returns {number[]}
 */
export function envelope(buf) {
  const out = [];
  for (let start = 0; start + ENVELOPE_BLOCK <= buf.length; start += ENVELOPE_BLOCK) {
    let sum = 0;
    for (let i = start; i < start + ENVELOPE_BLOCK; i++) sum += buf[i] * buf[i];
    out.push(Math.sqrt(sum / ENVELOPE_BLOCK));
  }
  return out;
}

/**
 * Sample index in the window where the most recent attack begins: the block
 * whose level is the biggest jump over the block before it. A jump, rather
 * than a threshold, because the window may still hold the tail of the last
 * note, and a note struck over a ringing one is still a step up.
 *
 * Clamped to the last ATTACK_LOOKBACK_MS, since the caller only asks once a
 * rise in level has already been seen, which puts the attack a frame or two
 * back at most. That bounds the error either way rather than trusting a
 * misplaced jump.
 *
 * @param {Float32Array} buf
 * @param {number} sampleRate
 * @returns {number}
 */
export function attackIndex(buf, sampleRate) {
  const env = envelope(buf);
  let best = 0;
  let bestBlock = 0;
  for (let b = 1; b < env.length; b++) {
    const ratio = env[b] / Math.max(env[b - 1], 1e-9);
    if (ratio > best) {
      best = ratio;
      bestBlock = b;
    }
  }
  const earliest = buf.length - Math.round((ATTACK_LOOKBACK_MS / 1000) * sampleRate);
  return Math.min(buf.length, Math.max(earliest, bestBlock * ENVELOPE_BLOCK));
}

/**
 * The pitch of one window in Hz, or NaN if it holds no single clear note.
 * @param {Float32Array} buf
 * @param {number} sampleRate
 * @returns {number}
 */
export function detectPitch(buf, sampleRate) {
  return analyse(buf, sampleRate).hz;
}

/**
 * Pitch and how periodic the window was, from one pass. The clarity is the
 * height of the NSDF peak: about 1 for a note, 0.05 for room noise, and
 * middling for the attack transient, which is why it is worth reporting
 * rather than just thresholding.
 * @param {Float32Array} buf
 * @param {number} sampleRate
 * @returns {{hz: number, clarity: number}}
 */
export function analyse(buf, sampleRate) {
  const w = buf.length;
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxLag = Math.min(w - 2, Math.ceil(sampleRate / MIN_HZ));
  if (maxLag <= minLag + 1) return { hz: NaN, clarity: 0 };

  // Running sum of squares, so the normalising energy at each lag is two
  // lookups rather than another pass over the window.
  const prefix = new Float64Array(w + 1);
  for (let i = 0; i < w; i++) prefix[i + 1] = prefix[i] + buf[i] * buf[i];

  const nsdf = new Float64Array(maxLag + 2);
  for (let tau = minLag; tau <= maxLag; tau++) {
    const n = w - tau;
    let ac = 0;
    for (let i = 0; i < n; i++) ac += buf[i] * buf[i + tau];
    const energy = prefix[n] + (prefix[w] - prefix[tau]);
    nsdf[tau] = energy > 0 ? (2 * ac) / energy : 0;
  }

  const isPeak = (t) => nsdf[t] > nsdf[t - 1] && nsdf[t] >= nsdf[t + 1];

  let tallest = 0;
  let found = false;
  for (let t = minLag + 1; t < maxLag; t++) {
    if (isPeak(t) && nsdf[t] > tallest) {
      tallest = nsdf[t];
      found = true;
    }
  }
  if (!found || tallest < MIN_CLARITY) return { hz: NaN, clarity: tallest };

  let tau = -1;
  for (let t = minLag + 1; t < maxLag; t++) {
    if (isPeak(t) && nsdf[t] >= PEAK_RATIO * tallest) {
      tau = t;
      break;
    }
  }
  if (tau < 0) return { hz: NaN, clarity: tallest };

  // Parabola through the peak and its neighbours, for a period that isn't
  // quantised to whole samples. At the top of the range a sample is most of
  // a semitone.
  const y0 = nsdf[tau - 1];
  const y1 = nsdf[tau];
  const y2 = nsdf[tau + 1];
  const curve = y0 - 2 * y1 + y2;
  let shift = curve !== 0 ? (0.5 * (y0 - y2)) / curve : 0;
  if (!(Math.abs(shift) <= 1)) shift = 0;
  return { hz: sampleRate / (tau + shift), clarity: tallest };
}

/**
 * A running estimate of the room: down fast, up slowly. Asymmetric because
 * the quiet moments are the evidence — a level that stays high is a note
 * ringing, not the room getting louder, and following it up at any speed
 * would raise the bar for the next note.
 * @param {number} level
 * @param {number} floor
 * @returns {number}
 */
export function nextNoiseFloor(level, floor) {
  return floor + (level - floor) * (level < floor ? NOISE_FALL : NOISE_RISE);
}

/** @param {number} noiseFloor @returns {number} */
export function onsetThreshold(noiseFloor) {
  return Math.max(SILENCE_FLOOR, noiseFloor * NOISE_MARGIN);
}

/**
 * Has a note just been struck? Two tests, and both have to pass: clear of the
 * room, and a step up from the peak follower. The second is what keeps a note
 * that is merely still ringing from answering the next trial by itself.
 * @param {number} level
 * @param {number} peak
 * @param {number} noiseFloor
 * @returns {boolean}
 */
export function isOnset(level, peak, noiseFloor) {
  return level > onsetThreshold(noiseFloor) && level > peak * ONSET_RATIO;
}

/** @param {number} level @param {number} peak @returns {number} */
export function nextPeak(level, peak) {
  return Math.max(level, peak * PEAK_DECAY);
}

/**
 * @typedef {{listening: boolean, error: string | null, device?: string,
 *   sampleRate?: number}} MicStatus
 */

/**
 * @type {{ctx: AudioContext, stream: MediaStream,
 *   source: MediaStreamAudioSourceNode, frame: number} | null}
 */
let session = null;
/** Set across the permission prompt, so a second click can't open a second. */
let starting = false;

export function listening() {
  return session !== null;
}

/**
 * Start listening. Needs a user gesture for the permission prompt, and a
 * secure context — which loopback counts as, so localhost is fine.
 *
 * @param {(heard: {hz: number, clarity: number, at: number}) => void} onNote
 *   what was heard, and the performance.now() of its attack rather than of
 *   its identification. Which note that is depends on what the piano is tuned
 *   to, which is the page's business, not this module's.
 * @param {(status: MicStatus) => void} onStatus
 * @param {(level: number, threshold: number) => void} onLevel every frame, so
 *   the page can show what is arriving and what it has to clear
 */
export async function start(onNote, onStatus, onLevel) {
  if (session || starting) return;
  // Checked before the capability test, because in an insecure context
  // navigator.mediaDevices is not merely unusable, it is absent — which would
  // otherwise be reported as the browser's fault rather than the URL's.
  if (!window.isSecureContext) {
    onStatus({
      listening: false,
      error:
        "The microphone needs a secure context. Open the page on localhost or " +
        "over https — an http:// address with a hostname or IP in it won't do.",
    });
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
    onStatus({ listening: false, error: "This browser has no Web Audio." });
    return;
  }
  starting = true;
  try {
    await open(onNote, onStatus, onLevel);
  } catch (err) {
    // Anything unexpected has to reach the page. Failing silently here leaves
    // the button saying it is asking for a microphone for ever.
    onStatus({ listening: false, error: `Could not start listening: ${err}` });
  } finally {
    starting = false;
  }
}

/**
 * @param {(heard: {hz: number, clarity: number, at: number}) => void} onNote
 * @param {(status: MicStatus) => void} onStatus
 * @param {(level: number, threshold: number) => void} onLevel
 */
async function open(onNote, onStatus, onLevel) {
  // Built before the first await, so it is created inside the click that
  // asked for it. An AudioContext constructed after the permission prompt has
  // come and gone is outside that gesture, and browsers are entitled to leave
  // it suspended — which looks exactly like a microphone that hears nothing.
  const ctx = new AudioContext();

  /** @type {MediaStream} */
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // All three of these are voice-call processing and all three wreck a
      // piano: the gain control rides over the attack the onset detector is
      // looking for, and the other two treat sustained tones as noise.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    ctx.close();
    const denied = err instanceof DOMException && err.name === "NotAllowedError";
    onStatus({
      listening: false,
      error: denied
        ? "Microphone access was refused."
        : "No microphone found, or it is in use elsewhere.",
    });
    return;
  }

  await ctx.resume();
  if (ctx.state !== "running") {
    ctx.close();
    for (const track of stream.getTracks()) track.stop();
    onStatus({ listening: false, error: `The audio engine would not start (${ctx.state}).` });
    return;
  }

  const analyser = ctx.createAnalyser();
  analyser.fftSize = WINDOW;
  // The source node is kept on the session, not dropped on the floor: it is
  // the only reference to it, and a collected source node is a silent one.
  // Note also the deliberate absence of a connection to ctx.destination —
  // playing the microphone back through the speakers beside it is a loop.
  const source = ctx.createMediaStreamSource(stream);
  source.connect(analyser);

  const buf = new Float32Array(WINDOW);
  const windowMs = (WINDOW / ctx.sampleRate) * 1000;
  let peak = 0;
  let noiseFloor = NOISE_INITIAL;
  /** @type {{at: number, since: number, last: number} | null} */
  let pending = null;
  let lastNoteAt = -Infinity;

  const tick = () => {
    if (!session) return;
    session.frame = requestAnimationFrame(tick);

    analyser.getFloatTimeDomainData(buf);
    const now = performance.now();
    const level = rms(buf);
    onLevel(level, onsetThreshold(noiseFloor));

    if (!pending && isOnset(level, peak, noiseFloor) && now - lastNoteAt > REFRACTORY_MS) {
      const back = ((WINDOW - attackIndex(buf, ctx.sampleRate)) / ctx.sampleRate) * 1000;
      pending = { at: now - back, since: now, last: NaN };
    }
    peak = nextPeak(level, peak);
    noiseFloor = nextNoiseFloor(level, noiseFloor);
    if (!pending) return;

    // Nothing is believed until the window holds the note and only the note.
    // A window still half full of the silence and hammer noise that came
    // before it reads a half or a whole step out, and reads it consistently
    // enough that two frames running will agree on it — successive frames
    // overlap by most of a window, so their agreement is no evidence at all
    // while the window is still filling. Waiting costs nothing that matters:
    // the answer is timestamped at the attack, not here.
    if (now - pending.at < windowMs) return;

    // Only now is the expensive part worth running, which is also why it can
    // share a frame with the drill's own rendering.
    const { hz, clarity } = analyse(buf, ctx.sampleRate);
    const usable = clarity >= ACCEPT_CLARITY && hz > 0;
    if (usable && Math.abs(centsBetween(hz, pending.last)) < AGREE_CENTS) {
      const at = pending.at;
      pending = null;
      lastNoteAt = now;
      onNote({ hz, clarity, at });
    } else {
      pending.last = usable ? hz : NaN;
      if (now - pending.since > GIVE_UP_MS) pending = null;
    }
  };

  session = { ctx, stream, source, frame: requestAnimationFrame(tick) };
  onStatus({
    listening: true,
    error: null,
    device: stream.getAudioTracks()[0]?.label || "an unnamed input",
    sampleRate: ctx.sampleRate,
  });
}

export function stop() {
  if (!session) return;
  cancelAnimationFrame(session.frame);
  session.source.disconnect();
  for (const track of session.stream.getTracks()) track.stop();
  session.ctx.close();
  session = null;
}

// --- playing a note back --------------------------------------------------

/**
 * Harmonics of the tone, as multiples of the fundamental and their relative
 * strengths. A bare sine sounds like a hearing test; a handful of harmonics
 * falling away at roughly 1/n is enough to read as an instrument.
 */
const PARTIALS = [
  [1, 1],
  [2, 0.4],
  [3, 0.16],
  [4, 0.08],
];

/** Loud enough to hear over a laptop fan, quiet enough not to startle. */
const PEAK_GAIN = 0.18;
const ATTACK_S = 0.006;
const LENGTH_S = 0.7;

/** @type {AudioContext | null} */
let speaker = null;

/**
 * Sound one note.
 *
 * Only ever called for a note that was typed or clicked. Playing one back
 * while the microphone is listening would be a loop: the detector would hear
 * the answer and take it for the next one, which is why the caller checks.
 *
 * @param {number} midiNote
 */
export function play(midiNote) {
  if (!Number.isFinite(midiNote) || !window.AudioContext) return;
  // Built on the first note rather than at startup, so it is created inside
  // the click or keystroke that asked for it and is allowed to run.
  if (!speaker) speaker = new AudioContext();
  if (speaker.state === "suspended") speaker.resume();

  const at = speaker.currentTime;
  const hz = 440 * Math.pow(2, (midiNote - 69) / 12);

  const envelope = speaker.createGain();
  envelope.connect(speaker.destination);
  envelope.gain.setValueAtTime(0.0001, at);
  envelope.gain.linearRampToValueAtTime(PEAK_GAIN, at + ATTACK_S);
  // Exponential, because that is how a struck string decays and how hearing
  // reads loudness. It cannot ramp to zero, hence the small floor.
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + LENGTH_S);

  for (const [multiple, strength] of PARTIALS) {
    if (hz * multiple > speaker.sampleRate / 2) break;
    const partial = speaker.createGain();
    partial.gain.value = strength;
    partial.connect(envelope);
    const osc = speaker.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz * multiple;
    osc.connect(partial);
    osc.start(at);
    osc.stop(at + LENGTH_S + 0.05);
  }
}
