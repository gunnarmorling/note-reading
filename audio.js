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

/** A second onset inside this, from a note's attack, is the same strike. */
export const REFRACTORY_MS = 120;

/**
 * How soon after a strike not yet named a much stronger one is taken to be
 * the same note, and the first only the sound of its key. Played softly, a
 * piano's key and hammer are heard well before the string: in a real
 * recording a bump in the spectrum came 90 to 100ms before each soft note,
 * and taken as the strike it timed the note from there and then heard the
 * string as a second note of the same name.
 */
export const PRELUDE_MS = 250;

/** How much stronger than a strike's flux the one after it has to be to replace it. */
export const PRELUDE_RATIO = 1.5;

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
 * @param {number} [lookbackMs] how far back the attack can be; less than
 *   ATTACK_LOOKBACK_MS when the frame before was analysed more recently and
 *   showed no attack
 * @returns {number}
 */
export function attackIndex(buf, sampleRate, lookbackMs = ATTACK_LOOKBACK_MS) {
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
  const earliest = buf.length - Math.round((Math.min(lookbackMs, ATTACK_LOOKBACK_MS) / 1000) * sampleRate);
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
  const { nsdf, peaks, tallest } = periodicity(buf, sampleRate);
  if (peaks.length === 0 || tallest < MIN_CLARITY) return { hz: NaN, clarity: tallest };
  const first = peaks.find((p) => p.height >= PEAK_RATIO * tallest);
  if (!first) return { hz: NaN, clarity: tallest };
  return { hz: sampleRate / refinedLag(nsdf, first.lag), clarity: tallest };
}

/**
 * The normalised square difference function over the window, and its peaks
 * — every lag at which the window resembles itself shifted, which is every
 * candidate period.
 * @param {Float32Array} buf
 * @param {number} sampleRate
 * @returns {{nsdf: Float64Array, peaks: {lag: number, height: number}[], tallest: number}}
 */
export function periodicity(buf, sampleRate) {
  const w = buf.length;
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxLag = Math.min(w - 2, Math.ceil(sampleRate / MIN_HZ));
  const nsdf = new Float64Array(Math.max(maxLag + 2, 0));
  if (maxLag <= minLag + 1) return { nsdf, peaks: [], tallest: 0 };

  // Running sum of squares, so the normalising energy at each lag is two
  // lookups rather than another pass over the window.
  const prefix = new Float64Array(w + 1);
  for (let i = 0; i < w; i++) prefix[i + 1] = prefix[i] + buf[i] * buf[i];

  for (let tau = minLag; tau <= maxLag; tau++) {
    const n = w - tau;
    let ac = 0;
    for (let i = 0; i < n; i++) ac += buf[i] * buf[i + tau];
    const energy = prefix[n] + (prefix[w] - prefix[tau]);
    nsdf[tau] = energy > 0 ? (2 * ac) / energy : 0;
  }

  const peaks = [];
  let tallest = 0;
  for (let t = minLag + 1; t < maxLag; t++) {
    if (nsdf[t] > nsdf[t - 1] && nsdf[t] >= nsdf[t + 1] && nsdf[t] > 0) {
      peaks.push({ lag: t, height: nsdf[t] });
      tallest = Math.max(tallest, nsdf[t]);
    }
  }
  return { nsdf, peaks, tallest };
}

/**
 * A peak's lag to a fraction of a sample, by a parabola through it and its
 * neighbours. At the top of the range a whole sample is most of a semitone.
 * @param {Float64Array} nsdf
 * @param {number} tau
 * @returns {number}
 */
function refinedLag(nsdf, tau) {
  const y0 = nsdf[tau - 1];
  const y1 = nsdf[tau];
  const y2 = nsdf[tau + 1];
  const curve = y0 - 2 * y1 + y2;
  let shift = curve !== 0 ? (0.5 * (y0 - y2)) / curve : 0;
  if (!(Math.abs(shift) <= 1)) shift = 0;
  return tau + shift;
}

/**
 * A running estimate of the room: down fast, up slowly. Asymmetric because
 * the quiet moments are the evidence — a level that stays high is a note
 * ringing, not the room getting louder, and following it up at any speed
 * would raise the bar for the next note.
 * @param {number} level
 * @param {number} floor
 * @param {number} [frames] how many 60Hz frames' worth of time this step
 *   covers — the rates are per sixtieth of a second, whatever the display does
 * @returns {number}
 */
export function nextNoiseFloor(level, floor, frames = 1) {
  const rate = level < floor ? NOISE_FALL : NOISE_RISE;
  return floor + (level - floor) * (1 - Math.pow(1 - rate, frames));
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

/**
 * @param {number} level
 * @param {number} peak
 * @param {number} [frames] how many 60Hz frames' worth of time this step covers
 * @returns {number}
 */
export function nextPeak(level, peak, frames = 1) {
  return Math.max(level, peak * Math.pow(PEAK_DECAY, frames));
}

/**
 * Every rate and ratio here was set at 60 frames a second, and a display
 * refreshing at 120 halves what changes between one frame and the next: a
 * strike's flux came in two halves, each under FLUX_MIN, and the peak
 * follower decayed twice as fast. So each frame is measured against the
 * detector as it was at least this long ago — the frame before at 60Hz, two
 * back at 120 — and the followers step by the time that has passed.
 */
export const REFERENCE_MS = 15;

/** One 60Hz frame, the unit the per-frame rates are written in. */
const FRAME_MS = 1000 / 60;

// --- attacks in the spectrum ------------------------------------------------
//
// The level test above cannot see a note struck while another rings. The
// level is an RMS over the whole window, so the new note enters it a few
// frames at a time, and two notes equally loud only sum to √2 of either: no
// frame ever jumps by ONSET_RATIO. Measured on synthesised strings, a note
// struck anywhere from 150 to 600ms into a held one went unanswered.
//
// What does change in one frame is the spectrum. A new note puts energy into
// bins that were quiet — its own partials — and a note merely ringing, or two
// ringing together, leaves every bin much where it was. So the spectral flux,
// the summed rise in log magnitude across bins, spikes on a strike and on
// little else. Over synthesised strings, room noise, a decaying note and two
// notes beating peak at 11 to 15 a frame; E4 struck over a ringing C4 scores
// 150, and 73 at a quarter of its loudness. A repeated note, whose partials
// are already there, still scores 119: the attack resets them.
//
// The bass is where it is weakest. Neighbouring low notes share bins for
// their first few partials, so D2 at half the loudness of a ringing C2
// scores 21 — seen, sometimes, and reported as a missed strike when not.

/**
 * Samples in the spectral window: the whole analysis window. Half of it saw
 * a strike a frame sooner and resolved the bass so poorly that a note struck
 * over its neighbour there went unseen three times as often.
 */
export const FLUX_SIZE = WINDOW;

/** Bins compared, by frequency: from under C2 to well into the partials. */
export const FLUX_LOW_HZ = 55;
export const FLUX_HIGH_HZ = 5000;

/**
 * Compression of magnitudes before comparing them. Logarithmic, so a partial
 * appearing counts for as much in a quiet note as in a loud one — which is
 * how a soft note over a loud one is seen at all.
 */
export const FLUX_COMPRESSION = 1000;

/** How far over the running background a frame's flux has to be. */
export const FLUX_RATIO = 2.5;

/**
 * The least flux that is a strike, however quiet the background. A clean
 * signal — a close microphone, a quiet room — leaves ordinary frames at 2 to
 * 5, and 2.5 times that is within reach of a note merely decaying: over a
 * noiseless recording every note set off a phantom strike or two, read off
 * whatever rose, which was a partial — F4 heard as C6, its third. Strikes
 * score 60 and up; the weakest seen, D2 over a ringing C2, 21.
 */
export const FLUX_MIN = 12;

/** How quickly the background follows frames that are not strikes. */
export const FLUX_FOLLOW = 0.1;

/** Hann windows by size, made once each. @type {Map<number, Float64Array>} */
const hanns = new Map();

/**
 * Magnitude spectrum of the most recent `n` samples, Hann-windowed. An
 * in-place radix-2 FFT: a few thousand multiplications, well under a
 * millisecond.
 * @param {Float32Array} buf
 * @param {number} [n] a power of two, no longer than the buffer
 * @returns {Float64Array} n / 2 bins
 */
export function magnitudes(buf, n = buf.length) {
  let hann = hanns.get(n);
  if (!hann) {
    hann = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    hanns.set(n, hann);
  }
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const offset = buf.length - n;
  for (let i = 0; i < n; i++) re[i] = buf[offset + i] * hann[i];

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }

  const out = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i]);
  return out;
}

/**
 * The spectrum flux is measured on: the last FLUX_SIZE samples, compressed.
 * @param {Float32Array} buf
 * @returns {Float64Array}
 */
export function spectrum(buf) {
  return magnitudes(buf, FLUX_SIZE).map((m) => Math.log10(1 + FLUX_COMPRESSION * m));
}

// --- a note over a ringing one --------------------------------------------
//
// Seeing the strike is half of it. Asked for the pitch of a window holding
// the new note and the old one still ringing, the period finder does what it
// should with a chord: finds the period they share. E4 over C4 is a major
// third, 5:4, and came back as C2, two octaves under both — confidently, and
// scored as a wrong answer you did not play.
//
// What tells the two apart is what was added. The spectrum from just before
// the strike, taken away from the spectrum now, leaves the new note's
// partials and nothing of the old note's, which have only decayed. The period
// finder still proposes the candidates — its peaks include the new note's own
// period — and the rise in the spectrum picks one: the candidate whose
// harmonics account for the most of it. A subharmonic accounts for all of it
// too, having every one of the new note's partials among its own, so of the
// candidates that come near the best, the highest wins.

/** Harmonics a candidate is credited with, at most. */
export const OVER_HARMONICS = 10;

/** How near a partial has to be to a harmonic to count, as a ratio. Inharmonic strings run sharp. */
export const OVER_TOLERANCE = 0.03;

/**
 * A harmonic is present when it rose by at least this share of the strongest
 * partial. A weak fundamental — 15% of the partial above it is a real piano's
 * bass — still clears it; a harmonic that is not there at all does not.
 */
export const OVER_PRESENT = 0.05;

/**
 * How much a candidate's own fundamental, or the octave above it, has to
 * have risen, as a share of the strongest partial. A note struck is there at
 * the bottom of its own series, if weakly — a low string's fundamental can be
 * a small part of it, which is why the octave counts too. What a real piano
 * makes of a key let up is noise across the bass that a low candidate's
 * dense harmonics sweep up: in two recordings, D2 and E♭2 named that way had
 * risen by 1 to 11% at the root and the octave, where every soft note truly
 * struck had risen by 45% or more at one of them.
 */
export const OVER_ROOT = 0.2;

/**
 * What gives away a key let up, or a damper landing, taken for a strike over
 * a ringing note: little of the sound is new, and the level is falling. Both,
 * since either alone is a real note too. In two recordings the phantoms named
 * after a line's last note had 1 to 20% of their energy new since before the
 * bump, and kept at most two thirds of the level; real notes had 67% new or
 * more — played staccato, the damper on the note before cut the level by
 * two thirds all the same — and a quarter-loud note struck over a loud one
 * still ringing is only 7% new, but keeps 93% of the level.
 *
 * `OVER_NEWS` is the share of the energy that rose; `OVER_KEEP` the share of
 * the level at the strike's onset still there when it is read.
 */
export const OVER_NEWS = 0.35;
export const OVER_KEEP = 0.8;

/** A candidate this near the best share is as good, and the higher of them wins. */
export const OVER_NEAR_BEST = 0.9;

/** Share of the rise a reading has to account for to be believed. */
export const OVER_SHARE = 0.6;

/**
 * How far over the room the level before a strike has to be for the strike to
 * be read against it. Well under NOISE_MARGIN: a note decayed below the
 * threshold for a new strike is still more than enough to pull the period
 * finder onto a chord's shared period.
 */
export const OVER_ROOM = 1.5;

/**
 * How much of the rise in a spectrum the harmonics of `hz` account for, and
 * what share of those harmonics are there at all.
 *
 * The second is what gives a subharmonic away. It has every partial of the
 * true note among its own harmonics, so it accounts for as much of the rise —
 * more, with wide enough windows to sweep up noise — but a third of the true
 * frequency has two harmonics missing for every one present, below the
 * highest one there.
 *
 * @param {Float64Array} rise linear magnitudes, bins of sampleRate / (2 × length)
 * @param {number} hz
 * @param {number} sampleRate
 * @returns {number} 0 to 1: the share of the rise, times the share present
 */
export function harmonicShare(rise, hz, sampleRate) {
  const binHz = sampleRate / (2 * rise.length);
  const low = Math.max(1, Math.floor(FLUX_LOW_HZ / binHz));
  const high = Math.min(rise.length - 1, Math.ceil(FLUX_HIGH_HZ / binHz));
  let total = 0;
  for (let b = low; b <= high; b++) total += rise[b];
  if (!(total > 0)) return 0;
  let strongest = 0;
  for (let b = low; b <= high; b++) strongest = Math.max(strongest, rise[b]);
  const counted = new Uint8Array(rise.length);
  let explained = 0;
  let highest = 0;
  let present = 0;
  for (let k = 1; k <= OVER_HARMONICS && k * hz <= FLUX_HIGH_HZ; k++) {
    const from = Math.max(low, Math.floor((k * hz * (1 - OVER_TOLERANCE)) / binHz));
    const to = Math.min(high, Math.ceil((k * hz * (1 + OVER_TOLERANCE)) / binHz));
    let top = 0;
    for (let b = from; b <= to; b++) {
      if (!counted[b]) explained += rise[b];
      counted[b] = 1;
      top = Math.max(top, rise[b]);
    }
    if (top >= OVER_PRESENT * strongest) {
      present += 1;
      highest = k;
    }
  }
  // Out of the harmonics up to the highest one there, not all of them: a note
  // with few partials, as a treble string has, is not missing the rest.
  return highest > 0 ? (explained / total) * (present / highest) : 0;
}

/**
 * Where a spectral peak really is, to a fraction of a bin: a parabola
 * through the bin and its neighbours.
 * @param {Float64Array} mags
 * @param {number} bin
 * @returns {number}
 */
function refinedBin(mags, bin) {
  const y0 = mags[bin - 1];
  const y1 = mags[bin];
  const y2 = mags[bin + 1];
  const curve = y0 - 2 * y1 + y2;
  const shift = curve !== 0 ? (0.5 * (y0 - y2)) / curve : 0;
  return bin + (Math.abs(shift) <= 1 ? shift : 0);
}

/**
 * The share of the energy in `buf` that rose since `before`, over the bins
 * flux is measured on: near 1 for a note struck over silence, near 0 for a
 * note decaying.
 * @param {Float64Array} now magnitudes
 * @param {Float64Array} then magnitudes
 * @param {number} sampleRate
 * @returns {number}
 */
export function newShare(now, then, sampleRate) {
  const binHz = sampleRate / (2 * now.length);
  const low = Math.max(2, Math.floor(FLUX_LOW_HZ / binHz));
  const high = Math.min(now.length - 2, Math.ceil(FLUX_HIGH_HZ / binHz));
  let risen = 0;
  let energy = 0;
  for (let b = low; b <= high; b++) {
    const up = now[b] - then[b];
    if (up > 0) risen += up * up;
    energy += now[b] * now[b];
  }
  return energy > 0 ? risen / energy : 0;
}

/**
 * The pitch of the note struck over whatever was ringing in `before`.
 *
 * Candidates come from the rise itself, not from the period finder: in a
 * chord its peaks drift — E4 over C4 put E4's own peak 74 cents flat — or go
 * missing. The strongest partial that appeared is some harmonic of the new
 * note, so the note is that partial's frequency divided by one of the first
 * few whole numbers. Each is credited with the share of the rise its
 * harmonics account for; a subharmonic accounts for as much of it, so of the
 * candidates near the best the highest wins, and the harmonics counted stop
 * at OVER_HARMONICS, which leaves a low subharmonic short of the partials the
 * true note reaches. The pitch is then read back off the note's lowest few
 * partials, where a string is least stretched.
 *
 * @param {Float32Array} buf the window now
 * @param {Float32Array} before a window from just before the strike
 * @param {number} sampleRate
 * @returns {{hz: number, clarity: number, share: number, news: number}}
 *   `clarity` is the share, for a caller reporting how sure the reading was;
 *   `news` the share of the energy now that rose since before
 */
export function analyseOver(buf, before, sampleRate) {
  const now = magnitudes(buf);
  const then = magnitudes(before);
  const rise = now.map((m, i) => Math.max(0, m - then[i]));
  const binHz = sampleRate / buf.length;
  const low = Math.max(2, Math.floor(FLUX_LOW_HZ / binHz));
  const high = Math.min(rise.length - 2, Math.ceil(FLUX_HIGH_HZ / binHz));

  let strongest = low;
  for (let b = low; b <= high; b++) if (rise[b] > rise[strongest]) strongest = b;
  const news = newShare(now, then, sampleRate);
  if (!(rise[strongest] > 0)) return { hz: NaN, clarity: 0, share: 0, news };
  const partial = refinedBin(now, strongest) * binHz;

  const risenAt = (hz) => {
    let top = 0;
    const from = Math.max(low, Math.floor((hz * (1 - OVER_TOLERANCE)) / binHz));
    const to = Math.min(high, Math.ceil((hz * (1 + OVER_TOLERANCE)) / binHz));
    for (let b = from; b <= to; b++) top = Math.max(top, rise[b]);
    return top / rise[strongest];
  };
  const candidates = [];
  for (let k = 1; k <= OVER_HARMONICS; k++) {
    const hz = partial / k;
    if (hz < MIN_HZ) break;
    if (hz > MAX_HZ) continue;
    if (Math.max(risenAt(hz), risenAt(2 * hz)) < OVER_ROOT) continue;
    candidates.push({ hz, share: harmonicShare(rise, hz, sampleRate) });
  }
  if (candidates.length === 0) return { hz: NaN, clarity: 0, share: 0, news };
  const best = Math.max(...candidates.map((c) => c.share));
  const pick = candidates
    .filter((c) => c.share >= OVER_NEAR_BEST * best)
    .reduce((a, b) => (b.hz > a.hz ? b : a));

  // Read back off the partials: each of the first few, found near where it
  // should be, says what the fundamental is; weighted by how much it rose.
  let weighted = 0;
  let weights = 0;
  for (let k = 1; k <= 4; k++) {
    const from = Math.max(low, Math.floor((k * pick.hz * (1 - OVER_TOLERANCE)) / binHz));
    const to = Math.min(high, Math.ceil((k * pick.hz * (1 + OVER_TOLERANCE)) / binHz));
    let top = -1;
    for (let b = from; b <= to; b++) if (top < 0 || rise[b] > rise[top]) top = b;
    if (top < 0 || !(rise[top] > 0)) continue;
    weighted += ((refinedBin(now, top) * binHz) / k) * rise[top];
    weights += rise[top];
  }
  const hz = weights > 0 ? weighted / weights : pick.hz;
  return { hz, clarity: pick.share, share: pick.share, news };
}

/**
 * The summed rise from one spectrum to the next. Each bin is compared with
 * the loudest of itself and its two neighbours the frame before, so a partial
 * drifting a bin sideways — a string settling, a note bent by the room — is
 * not a rise.
 * @param {Float64Array} now
 * @param {Float64Array} before
 * @param {number} sampleRate
 * @returns {number}
 */
export function spectralFlux(now, before, sampleRate) {
  const binHz = sampleRate / FLUX_SIZE;
  const low = Math.max(1, Math.floor(FLUX_LOW_HZ / binHz));
  const high = Math.min(now.length - 2, Math.ceil(FLUX_HIGH_HZ / binHz));
  let flux = 0;
  for (let b = low; b <= high; b++) {
    const was = Math.max(before[b - 1], before[b], before[b + 1]);
    if (now[b] > was) flux += now[b] - was;
  }
  return flux;
}

/**
 * What the level has to reach, this frame, for a strike to count: clear of
 * the room, and a step up from whatever is still ringing. The second is what
 * the meter used not to show — right after a note it is by far the higher of
 * the two, and it sinks back as the note decays, so a note played too soon
 * after another has a bar to clear that a mark at the room's level hides.
 * @param {number} peak
 * @param {number} noiseFloor
 * @returns {number}
 */
export function onsetBar(peak, noiseFloor) {
  return Math.max(onsetThreshold(noiseFloor), peak * ONSET_RATIO);
}

/**
 * A swell that stayed under the room's threshold is reported as too quiet
 * only if it reached at least this share of it. Below that it is the room
 * moving about, and a log of every breath would bury the strikes that count.
 */
export const QUIET_SHARE = 0.4;

/**
 * How far a swell has to rise, without an attack in it, to be reported as a
 * strike that was missed. Well under ONSET_RATIO, because the strike this is
 * mostly for cannot reach that: two notes equally loud sum to √2 of either,
 * so a note struck as hard as the one still ringing rises by ×1.41 at most.
 * Well over the percent or two a ringing note's level ripples by on its own.
 */
export const MISSED_RISE = 1.2;

/**
 * Time without a new high before a swell is over and judged: three 60Hz
 * frames. Not the first frame the level falls: partials beating against each
 * other ripple it by a percent or two, and a note decaying slowly never falls
 * by much in any one frame — waiting for a clear fall judged some swells
 * never.
 */
export const SWELL_MS = 50;

/**
 * Everything the microphone did with one strike, answered or not.
 *
 * - `heard`: a note, and when it was struck.
 * - `quiet`: the level swelled, but never cleared the room's threshold.
 * - `gradual`: loud enough, and it rose by a whole onset's worth — but over
 *   several frames, never in one, so no attack was seen. What a note struck
 *   over a ringing one looks like: the level is taken over the whole window,
 *   so a new note enters it a few frames at a time.
 * - `overtaken`: the next strike came before this one could be named.
 * - `unclear`: an attack, and then nothing periodic enough to call a note.
 * - `unsteady`: clear readings that would not agree with each other.
 *
 * @typedef {{kind: "heard", hz: number, clarity: number, at: number, over: boolean}
 *   | {kind: "quiet", level: number, threshold: number}
 *   | {kind: "gradual", rise: number}
 *   | {kind: "overtaken"}
 *   | {kind: "unclear", clarity: number}
 *   | {kind: "unsteady"}} Strike
 */

/**
 * The detector, one frame at a time: what the listening loop runs, pulled out
 * of it so that it can be fed synthesised audio and asked what it made of it.
 *
 * Reports every strike it noticed, not only those it could name. A strike it
 * drops silently is indistinguishable, from the piano, from a strike it never
 * heard — and "was I too quiet, or too quick?" is a question only the
 * detector can answer.
 *
 * @param {number} sampleRate
 */
export function createDetector(sampleRate) {
  const windowMs = (WINDOW / sampleRate) * 1000;
  let peak = 0;
  let noiseFloor = NOISE_INITIAL;
  let previous = 0;
  let lastFrameAt = -Infinity;
  /**
   * The last few frames — when, the window, its spectrum, the level and the
   * peak follower — for measuring this one against the detector as it was
   * REFERENCE_MS ago, and for reading a strike against what was ringing.
   * @type {{now: number, buf: Float32Array, spec: Float64Array, level: number, peak: number}[]}
   */
  const history = [];
  /** The flux of ordinary frames, which a strike has to stand out from. */
  let fluxFloor = NaN;
  /**
   * The strike being identified: its attack, when it was noticed, the last
   * reading, the clearest reading, how many were clear, and — when something
   * was ringing — the window from before it.
   * `before` is that window whatever was sounding, for telling a strike from
   * a key let up.
   * @type {{at: number, since: number, flux: number, level: number, last: number,
   *   best: number, clear: number, over: Float32Array | null,
   *   before: Float32Array | null} | null}
   */
  let pending = null;
  /** When the last note named was struck: the refractory period runs from there. */
  let lastAttackAt = -Infinity;
  /** The last note named, and when it was struck. */
  let lastHeard = { at: -Infinity, hz: NaN };
  /**
   * A rise in level: what it rose from and to, the room's threshold when it
   * began, when it last reached a new high, and whether an attack was seen.
   * @type {{base: number, top: number, threshold: number, highAt: number,
   *   struck: boolean} | null}
   */
  let swell = null;

  /** @param {Float32Array} buf */
  function readPlain(buf) {
    const { hz, clarity } = analyse(buf, sampleRate);
    return { hz, clarity, usable: hz > 0 && clarity >= ACCEPT_CLARITY };
  }

  /**
   * A strike that landed on something sounding, read both ways.
   *
   * Each way has a failure the other does not. Over a note still ringing
   * loud, the period finder hears the chord and names the period the two
   * share — E4 over C4 as C2. Over a note all but gone, a soft strike's rise
   * is mostly noise, and the rise's reading sweeps it up into a low
   * candidate's many harmonics — a soft F4 on a real piano as D2, when the
   * period finder had F4 at 0.98. Both failures come out low. So where both
   * readings are sure of themselves and name different notes, the higher
   * one is taken.
   *
   * But only a period-finder reading that is news. One that names what the
   * window before the strike already held is hearing the note still ringing,
   * not the strike — and what a real piano does half a second after a note,
   * a key let up, a damper landing, is a small bump in the spectrum with the
   * old note still sounding under it. Taken as a strike, that was the old
   * note again, answered to the next one.
   *
   * @param {Float32Array} buf
   * @param {Float32Array} before
   */
  function readOver(buf, before) {
    const over = analyseOver(buf, before, sampleRate);
    const news = over.news;
    const plain = readPlain(buf);
    const overSure = over.hz > 0 && over.share >= OVER_SHARE;
    if (plain.usable) {
      const was = readPlain(before);
      const fresh = !(was.usable && Math.abs(centsBetween(plain.hz, was.hz)) < 60);
      const differs = !overSure || Math.abs(centsBetween(plain.hz, over.hz)) > 50;
      if (fresh && differs && (!overSure || plain.hz > over.hz)) return { ...plain, news };
    }
    return { hz: over.hz, clarity: over.clarity, usable: overSure, news };
  }

  /**
   * @param {Float32Array} buf the latest window
   * @param {number} now performance.now() of this frame
   * @returns {{level: number, bar: number, flux: number, strikes: Strike[]}}
   */
  function frame(buf, now) {
    /** @type {Strike[]} */
    const strikes = [];
    const level = rms(buf);
    const threshold = onsetThreshold(noiseFloor);
    const bar = onsetBar(peak, noiseFloor);

    // Two ways to see a strike. A rise in level, which is all a note over
    // silence needs; and new partials in the spectrum, which is what a note
    // struck over a ringing one has instead. Either is gated on the room, so
    // that the flux of noise alone — which is all over the place frame to
    // frame, in a quiet room — never counts.
    //
    // The spectrum's gate is lower than the level's. On a quiet signal — a
    // microphone across the room, turned down — a soft note can stand out of
    // the spectrum thirty times over and still not reach three times the
    // room's level, and a strike the spectrum is that sure of needs only to
    // be something rather than nothing.
    const spec = spectrum(buf);
    const frames = Number.isFinite(lastFrameAt) ? Math.min(4, Math.max(0.1, (now - lastFrameAt) / FRAME_MS)) : 1;
    lastFrameAt = now;
    const reference = history.findLast((h) => h.now <= now - REFERENCE_MS) ?? history[0] ?? null;
    const flux = reference ? spectralFlux(spec, reference.spec, sampleRate) : 0;
    const struckSpectrum =
      Number.isFinite(fluxFloor) &&
      flux > Math.max(FLUX_MIN, fluxFloor * FLUX_RATIO) &&
      level > Math.max(SILENCE_FLOOR, noiseFloor * OVER_ROOM);
    const onset = isOnset(level, reference ? reference.peak : peak, noiseFloor) || struckSpectrum;
    if (reference && !struckSpectrum) {
      const follow = 1 - Math.pow(1 - FLUX_FOLLOW, frames);
      fluxFloor = Number.isFinite(fluxFloor) ? fluxFloor + (flux - fluxFloor) * follow : flux;
    }

    const settled = now - lastAttackAt > REFRACTORY_MS;
    /** @type {Float32Array | null | undefined} */
    let keptOver;
    /** @type {Float32Array | null | undefined} */
    let keptBefore;
    if (onset && settled && pending) {
      const age = now - pending.since;
      const stronger = flux > pending.flux * PRELUDE_RATIO;
      if (stronger && age <= PRELUDE_MS) {
        // The key, and now the string: the same note, struck from here — and
        // still read against the window from before the key. One from after
        // it already holds the start of the note, and against that the
        // fundamental barely rises: a soft F3 came out as F4.
        keptOver = pending.over;
        keptBefore = pending.before;
        pending = null;
      } else if (age > REFRACTORY_MS) {
        // Past the attack of the note being identified, so a different strike —
        // and the one to follow. Carrying on with the old one read the new note
        // in its place and timed it from the old attack, which on the drill is
        // an answer to the wrong note.
        strikes.push({ kind: "overtaken" });
        pending = null;
      }
    }
    if (onset && settled) {
      if (!pending) {
        // The reference frame showed no attack, so this one is no further back
        // than that — which over a ringing note is a far tighter bound on where
        // to look than the level can give.
        const since = reference ? now - reference.now : FRAME_MS;
        const lookback = since + (2 * ENVELOPE_BLOCK * 1000) / sampleRate;
        const back = ((WINDOW - attackIndex(buf, sampleRate, lookback)) / sampleRate) * 1000;
        // Over a ringing note, the window before is what the new note's pitch
        // is read against; over silence there is nothing to take away.
        const over =
          keptOver !== undefined
            ? keptOver
            : reference && reference.level > Math.max(SILENCE_FLOOR, noiseFloor * OVER_ROOM) &&
                reference.buf.length === buf.length
              ? reference.buf
              : null;
        const before =
          keptBefore !== undefined ? keptBefore : reference && reference.buf.length === buf.length ? reference.buf : null;
        pending = { at: now - back, since: now, flux, level, last: NaN, best: 0, clear: 0, over, before };
      }
    }

    // A swell ends once SWELL_MS pass without a new high, and only then is it
    // judged: one that produced an attack needs no comment, one that did not
    // is a strike that was lost.
    if (swell && level > swell.top) {
      swell.top = level;
      swell.highAt = now;
    } else if (swell && now - swell.highAt >= SWELL_MS) {
      const rise = swell.top / swell.base;
      if (!swell.struck && rise >= MISSED_RISE) {
        if (swell.top >= swell.threshold) strikes.push({ kind: "gradual", rise });
        else if (swell.top >= swell.threshold * QUIET_SHARE) {
          strikes.push({ kind: "quiet", level: swell.top, threshold: swell.threshold });
        }
      }
      swell = null;
    }
    if (!swell && level > previous) {
      swell = { base: Math.max(previous, SILENCE_FLOOR), top: level, threshold, highAt: now, struck: false };
    }
    if (swell && onset) swell.struck = true;

    previous = level;
    peak = nextPeak(level, peak, frames);
    noiseFloor = nextNoiseFloor(level, noiseFloor, frames);
    history.push({ now, buf: buf.slice(), spec, level, peak });
    while (history.length > 1 && history[1].now <= now - REFERENCE_MS) history.shift();
    if (!pending) return { level, bar, flux, strikes };

    // Nothing is believed until the window holds the note and only the note.
    // A window still half full of the silence and hammer noise that came
    // before it reads a half or a whole step out, and reads it consistently
    // enough that two frames running will agree on it — successive frames
    // overlap by most of a window, so their agreement is no evidence at all
    // while the window is still filling. Waiting costs nothing that matters:
    // the answer is timestamped at the attack, not here.
    if (now - pending.at < windowMs) return { level, bar, flux, strikes };

    const read = pending.over ? readOver(buf, pending.over) : readPlain(buf);
    const { hz, clarity } = read;
    // Over silence as well as over a ringing note: a key let up with the note
    // all but gone is read by the period finder instead, and it named the
    // note it was damping, half a semitone sharp.
    const news =
      "news" in read
        ? read.news
        : pending.before
          ? newShare(magnitudes(buf), magnitudes(pending.before), sampleRate)
          : 1;
    const fading = news < OVER_NEWS && level < pending.level * OVER_KEEP;
    const usable = read.usable && !fading;
    pending.best = Math.max(pending.best, clarity);
    if (usable) pending.clear += 1;
    if (usable && Math.abs(centsBetween(hz, pending.last)) < AGREE_CENTS) {
      // The same note again, struck within PRELUDE_MS of the last, is the
      // last one: a key heard before its string can be named from the string
      // arriving under it, and the string then seen as a strike of its own.
      const again = now - lastHeard.at < PRELUDE_MS + windowMs && Math.abs(centsBetween(hz, lastHeard.hz)) < 50;
      if (!again) {
        strikes.push({ kind: "heard", hz, clarity, at: pending.at, over: pending.over !== null });
        lastHeard = { at: pending.at, hz };
      }
      lastAttackAt = pending.at;
      pending = null;
    } else {
      pending.last = usable ? hz : NaN;
      if (now - pending.since > GIVE_UP_MS) {
        strikes.push(
          pending.clear > 1 ? { kind: "unsteady" } : { kind: "unclear", clarity: pending.best },
        );
        pending = null;
      }
    }
    return { level, bar, flux, strikes };
  }

  return { frame };
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

/**
 * @typedef {{now: number, contextTime: number, flux: number}} FrameDetail
 */
/** Set across the permission prompt, so a second click can't open a second. */
let starting = false;

export function listening() {
  return session !== null;
}

/**
 * Start listening. Needs a user gesture for the permission prompt, and a
 * secure context — which loopback counts as, so localhost is fine.
 *
 * @param {(strike: Strike) => void} onStrike every strike noticed, named or
 *   not. A note carries the performance.now() of its attack rather than of its
 *   identification; which note it is depends on what the piano is tuned to,
 *   which is the page's business, not this module's.
 * @param {(status: MicStatus) => void} onStatus
 * @param {(level: number, bar: number, frame: FrameDetail) => void} onLevel
 *   every frame, so the page can show what is arriving and what a strike has
 *   to clear right now — and log it, when a recording is being made
 */
export async function start(onStrike, onStatus, onLevel) {
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
    await open(onStrike, onStatus, onLevel);
  } catch (err) {
    // Anything unexpected has to reach the page. Failing silently here leaves
    // the button saying it is asking for a microphone for ever.
    onStatus({ listening: false, error: `Could not start listening: ${err}` });
  } finally {
    starting = false;
  }
}

/**
 * @param {(strike: Strike) => void} onStrike
 * @param {(status: MicStatus) => void} onStatus
 * @param {(level: number, bar: number, frame: FrameDetail) => void} onLevel
 */
async function open(onStrike, onStatus, onLevel) {
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
  const detector = createDetector(ctx.sampleRate);

  const tick = () => {
    if (!session) return;
    session.frame = requestAnimationFrame(tick);
    analyser.getFloatTimeDomainData(buf);
    // The expensive part, the pitch analysis, only runs once a strike's window
    // is full — which is also why it can share a frame with the drill's own
    // rendering.
    const now = performance.now();
    const { level, bar, flux, strikes } = detector.frame(buf, now);
    // The context's clock says which samples this window ended on, which is
    // what lines a recording up with the frames the detector actually saw.
    onLevel(level, bar, { now, contextTime: ctx.currentTime, flux });
    for (const strike of strikes) onStrike(strike);
  };

  session = { ctx, stream, source, frame: requestAnimationFrame(tick) };
  onStatus({
    listening: true,
    error: null,
    device: stream.getAudioTracks()[0]?.label || "an unnamed input",
    sampleRate: ctx.sampleRate,
  });
}

/**
 * Follow a known line, played round and round, one heard note at a time: for
 * testing the detector against a player who knows what they are playing.
 *
 * The line is not held up by a note that was not heard. Playing legato you
 * carry on, so a note that matches the one after the expected one means the
 * expected one was missed; anything else is heard wrong, and the line moves
 * on past it all the same. Positions wrap, which is what lets the same four
 * notes be played over and over without stopping.
 *
 * @param {number[]} line MIDI notes, in order
 * @param {number} index the position expected next
 * @param {number} midi what was heard
 * @returns {{marks: {at: number, result: "heard" | "missed" | "wrong"}[], index: number}}
 */
export function followLine(line, index, midi) {
  const next = (index + 1) % line.length;
  if (midi === line[index]) return { marks: [{ at: index, result: "heard" }], index: next };
  if (line.length > 2 && midi === line[next]) {
    return {
      marks: [
        { at: index, result: "missed" },
        { at: next, result: "heard" },
      ],
      index: (next + 1) % line.length,
    };
  }
  return { marks: [{ at: index, result: "wrong" }], index: next };
}

// --- recording, for debugging ------------------------------------------------
//
// What the detector made of a real piano can only be worked out from the
// real piano. So the microphone can be recorded exactly as it arrives — raw,
// before any analysis — alongside a log of what the page decided, for
// replaying through createDetector somewhere a debugger is.
//
// Taken by an AudioWorklet rather than off the analyser: the analyser gives a
// window when asked, once a frame, and the frames overlap by most of a window
// or leave gaps when rendering stalls. The worklet sees every block, and
// `currentFrame` says exactly which samples it holds, on the same clock as
// the `contextTime` logged for each frame.

/** The longest a recording runs before it stops by itself: five minutes. */
export const CAPTURE_MAX_SECONDS = 300;

const TAP = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.chunk = new Float32Array(4096); this.fill = 0; this.first = -1; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    if (this.first < 0) this.first = currentFrame;
    for (let i = 0; i < channel.length; i++) {
      this.chunk[this.fill++] = channel[i];
      if (this.fill === this.chunk.length) {
        this.port.postMessage({ first: this.first, samples: this.chunk });
        this.chunk = new Float32Array(4096);
        this.fill = 0;
        this.first = currentFrame + i + 1;
      }
    }
    return true;
  }
}
registerProcessor("note-reading-tap", Tap);
`;

/**
 * @type {{node: AudioWorkletNode, mute: GainNode, chunks: Int16Array[], first: number,
 *   length: number, full: boolean} | null}
 */
let capture = null;

export function capturing() {
  return capture !== null;
}

/**
 * Start recording the microphone. Needs it open.
 * @param {() => void} [onFull] called if the recording reaches its limit
 * @returns {Promise<boolean>} whether recording started
 */
export async function startCapture(onFull) {
  if (!session || capture) return false;
  const { ctx, source } = session;
  const url = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  if (!session || session.ctx !== ctx) return false;
  const node = new AudioWorkletNode(ctx, "note-reading-tap");
  // Some browsers only run a node that leads somewhere. Silenced on the way,
  // since the somewhere is the speakers and the input is the microphone.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);
  const limit = CAPTURE_MAX_SECONDS * ctx.sampleRate;
  const taken = { node, mute, chunks: [], first: -1, length: 0, full: false };
  node.port.onmessage = ({ data }) => {
    if (taken.full) return;
    if (taken.first < 0) taken.first = data.first;
    // Stored as 16-bit, which is what the file will hold anyway, at half the
    // memory: five minutes at 48kHz is 29MB rather than 58.
    const pcm = new Int16Array(data.samples.length);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(data.samples[i] * 32767)));
    taken.chunks.push(pcm);
    taken.length += pcm.length;
    if (taken.length >= limit) {
      taken.full = true;
      onFull?.();
    }
  };
  capture = taken;
  return true;
}

/**
 * Stop recording and hand back what was recorded.
 * @returns {{samples: Int16Array, sampleRate: number, firstFrame: number} | null}
 */
export function stopCapture() {
  if (!capture) return null;
  const taken = capture;
  capture = null;
  taken.node.port.onmessage = null;
  try {
    session?.source.disconnect(taken.node);
  } catch {
    /* the session has already gone */
  }
  taken.node.disconnect();
  taken.mute.disconnect();
  const samples = new Int16Array(taken.length);
  let at = 0;
  for (const chunk of taken.chunks) {
    samples.set(chunk, at);
    at += chunk.length;
  }
  return {
    samples,
    sampleRate: session?.ctx.sampleRate ?? 48000,
    firstFrame: Math.max(0, taken.first),
  };
}

/** The RIFF chunk a debug recording's log travels in, inside its WAV file. */
export const LOG_CHUNK = "nrlg";

/**
 * A mono 16-bit PCM WAV file, with a text chunk after the audio if given one.
 *
 * One file rather than a recording and a log side by side: the two are no use
 * apart, a browser asks before letting a page download twice, and any player
 * skips a chunk it does not know.
 *
 * @param {Int16Array} samples
 * @param {number} sampleRate
 * @param {string} [log]
 * @returns {ArrayBuffer}
 */
export function encodeWav(samples, sampleRate, log = "") {
  const extra = new TextEncoder().encode(log);
  const pad = extra.length % 2;
  const tail = extra.length ? 8 + extra.length + pad : 0;
  const out = new ArrayBuffer(44 + samples.length * 2 + tail);
  const view = new DataView(out);
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2 + tail, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  if (extra.length) {
    const at = 44 + samples.length * 2;
    text(at, LOG_CHUNK);
    view.setUint32(at + 4, extra.length, true);
    new Uint8Array(out, at + 8, extra.length).set(extra);
  }
  return out;
}

/**
 * The samples of a WAV file as floats: 16-bit PCM or 32-bit float, the
 * first channel of however many.
 * @param {ArrayBuffer} file
 * @returns {{samples: Float32Array, sampleRate: number, log: string}}
 */
export function decodeWav(file) {
  const view = new DataView(file);
  const tag = (at) => String.fromCharCode(...new Uint8Array(file, at, 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let format = 1;
  let channels = 1;
  let sampleRate = 0;
  let bits = 16;
  let log = "";
  /** @type {Float32Array | null} */
  let samples = null;
  for (let at = 12; at + 8 <= file.byteLength; ) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      const step = (bits / 8) * channels;
      const count = Math.floor(Math.min(size, file.byteLength - body) / step);
      samples = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const p = body + i * step;
        samples[i] =
          format === 3 && bits === 32 ? view.getFloat32(p, true) : bits === 16 ? view.getInt16(p, true) / 32768 : NaN;
      }
      if (samples.some(Number.isNaN)) throw new Error(`unsupported WAV: format ${format}, ${bits} bits`);
    } else if (id === LOG_CHUNK) {
      log = new TextDecoder().decode(new Uint8Array(file, body, Math.min(size, file.byteLength - body)));
    }
    at = body + size + (size % 2);
  }
  if (!samples) throw new Error("WAV file has no data");
  return { samples, sampleRate, log };
}

export function stop() {
  // A recording still running is thrown away with the session: the page
  // saves one before it closes the microphone on purpose.
  if (capture) stopCapture();
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
