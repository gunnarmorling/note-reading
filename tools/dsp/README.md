# DSP bench

Design tooling for `audio.js`, not tests. Python and numpy, because working
out *why* a detector is wrong wants arrays, plots-worth-of-numbers and a
minute's iteration — none of which the drill should carry.

```
python3 tools/dsp/proto.py          # sweep the detector over synthesised notes
python3 tools/dsp/exact.py          # the detector, transcribed from audio.js
python3 tools/dsp/verify_tests.py   # mirrors tests.html's synthesis exactly
node tools/dsp/lines.mjs [legato|staccato]   # lines of notes through createDetector
node tools/dsp/replay.mjs <recording.wav>    # a debug recording through createDetector
```

`replay.mjs` reads what the page's `Record for debugging` saves — the
microphone as it arrived, with the page's log inside the file — and runs
the detector over the same windows at the same times, printing its strikes
beside what the page logged. `--from` and `--to` in seconds narrow it down;
`--shift` moves every window by some samples, to find a reading that sits on
the edge of a decision.
At the end it checks every note it named against the audio after it — the
period finder over a window 150 to 235ms past the attack — and lists the
disagreements, and any note named twice within 600ms.
Recordings go in `samples/`. They are a few megabytes a minute, and a recording of a room — keep them out of commits.

`lines.mjs` takes `NOISE`, `HAMMER`, `ROOM` and `FPS` from the environment:
the steady noise floor, a burst of noise at each attack, noise that rings on
with each note, and the display's frame rate.

`lines.mjs` is the odd one out, in JavaScript: it drives `createDetector`
itself rather than a transcription, over a thousand synthesised notes played
as lines, and reports how many were heard, misheard, missed with a reason
and missed silently. It settled the spectral-flux and over-a-ringing-note
constants — see ARCHITECTURE.md — and takes about forty seconds.

`exact.py` is a transcription of `analyse`, kept deliberately literal so that
the Python and the JavaScript can be compared line for line. When they
disagree, one of them is wrong and the bench is how you find out which.

These produced the numbers quoted in ARCHITECTURE.md: the octave-error rates
for a weak fundamental and for heavy inharmonicity, and the measurement that a
window 17ms into a note misreads three notes in twenty-nine while one 34ms in
misreads none. If you change the window, the peak ratio or the clarity floor,
re-run them.

Nothing here is part of the suite — `node tests/run.js` does not touch it, and
the drill does not need it installed.
