# DSP bench

Design tooling for `audio.js`, not tests. Python and numpy, because working
out *why* a detector is wrong wants arrays, plots-worth-of-numbers and a
minute's iteration — none of which the drill should carry.

```
python3 tools/dsp/proto.py          # sweep the detector over synthesised notes
python3 tools/dsp/exact.py          # the detector, transcribed from audio.js
python3 tools/dsp/verify_tests.py   # mirrors tests.html's synthesis exactly
```

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
