import numpy as np

def nsdf(buf, min_lag, max_lag):
    out = np.zeros(max_lag + 1)
    for tau in range(min_lag, max_lag + 1):
        a = buf[:len(buf)-tau]; b = buf[tau:]
        ac = float(np.dot(a, b))
        en = float(np.dot(a, a) + np.dot(b, b))
        out[tau] = 2*ac/en if en > 0 else 0.0
    return out

def detect(buf, sr, min_hz=60, max_hz=1400, k=0.9, min_pitched=0.5):
    min_lag = max(2, int(sr/max_hz))
    max_lag = min(len(buf)-1, int(np.ceil(sr/min_hz)))
    n = nsdf(buf, min_lag, max_lag)
    # local maxima strictly inside the searched band
    peaks = [t for t in range(min_lag+1, max_lag) if n[t] > n[t-1] and n[t] >= n[t+1]]
    if not peaks: return float('nan'), 0.0
    best = max(n[t] for t in peaks)
    if best < min_pitched: return float('nan'), best
    tau = next(t for t in peaks if n[t] >= k*best)
    # parabolic interpolation
    y0,y1,y2 = n[tau-1], n[tau], n[tau+1]
    d = y0 - 2*y1 + y2
    shift = 0.5*(y0-y2)/d if d != 0 else 0.0
    return sr/(tau+shift), best

def piano(f0, sr, n_samples, nharm=12, weak_fund=False, B=2e-4, noise=0.01, decay=1.5, seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(n_samples)/sr
    x = np.zeros(n_samples)
    for i in range(1, nharm+1):
        fn = i*f0*np.sqrt(1 + B*i*i)
        if fn > sr/2*0.95: break
        a = 1.0/i
        if i == 1 and weak_fund: a = 0.15
        x += a*np.sin(2*np.pi*fn*t + rng.uniform(0, 2*np.pi))
    x *= np.exp(-decay*t)
    x += noise*rng.standard_normal(n_samples)
    return x/np.max(np.abs(x))

def midi_of(hz): return round(69 + 12*np.log2(hz/440))

SR, W = 48000, 4096
LETTERS=["C","D","E","F","G","A","H"]
SEMI={"C":0,"D":2,"E":4,"F":5,"G":7,"A":9,"H":11}
def midi_from_dn(d): return ((d//7)+1)*12 + SEMI[LETTERS[d%7]]
# bass C2..E4 and treble A3..C6 (2 ledger lines) -> dn 14..30 and 26..42
dns = sorted(set(list(range(14,31)) + list(range(26,43))))
notes = [(d, midi_from_dn(d), 440*2**((midi_from_dn(d)-69)/12)) for d in dns]
print(f"{len(notes)} notes, {notes[0][2]:.1f} Hz to {notes[-1][2]:.1f} Hz, window {W} @ {SR}")

for label, kw in [("plain 1/n", {}), ("weak fundamental", dict(weak_fund=True)),
                  ("high inharmonicity", dict(B=1e-3)), ("weak+inharm+noisy", dict(weak_fund=True, B=8e-4, noise=0.04))]:
    for k in (0.85, 0.9, 0.95):
        bad=[]
        for d, m, hz in notes:
            x = piano(hz, SR, W, **kw)
            f, c = detect(x, SR, k=k)
            if np.isnan(f) or midi_of(f) != m: bad.append((m, round(hz,1), None if np.isnan(f) else round(f,1), round(c,2)))
        print(f"  {label:22s} k={k}: {len(notes)-len(bad)}/{len(notes)} ok" + (f"  bad={bad[:6]}" if bad else ""))

print()
print("--- clarity of the tallest peak, by signal ---")
rng = np.random.default_rng(1)
for label, x in [("pure noise", rng.standard_normal(W)),
                 ("near silence", 1e-4*rng.standard_normal(W)),
                 ("C2 plain", piano(65.41, SR, W)),
                 ("C2 weak fund", piano(65.41, SR, W, weak_fund=True)),
                 ("C4 plain", piano(261.6, SR, W)),
                 ("C4 very noisy", piano(261.6, SR, W, noise=0.3)),
                 ("C4 + G4 together", piano(261.6, SR, W, seed=2)+piano(392.0, SR, W, seed=3))]:
    f, c = detect(np.asarray(x, dtype=float), SR)
    print(f"  {label:18s} clarity {c:.3f}  f {('nan' if np.isnan(f) else f'{f:7.1f}')}  midi {'-' if np.isnan(f) else midi_of(f)}")

print()
print("--- window size and sample rate, hardest case (weak fund + inharmonic + noise) ---")
for sr in (44100, 48000):
    for w in (1024, 2048, 4096, 8192):
        bad = []
        for d, m, hz in notes:
            x = piano(hz, sr, w, weak_fund=True, B=8e-4, noise=0.04)
            f, c = detect(x, sr)
            if np.isnan(f) or midi_of(f) != m: bad.append((m, round(hz,1), None if np.isnan(f) else round(f,1)))
        lag = int(np.ceil(sr/60))
        print(f"  sr={sr} window={w:5d} (lowest note gets {w/(sr/65.41):.1f} periods, maxLag {lag}): {len(notes)-len(bad)}/{len(notes)}"
              + (f" bad={bad[:5]}" if bad else ""))

print()
print("--- the decaying tail: analysed later in the note ---")
for delay_ms in (0, 150, 400, 1000):
    bad=[]
    for d, m, hz in notes:
        t0 = delay_ms/1000
        n = W
        tt = t0 + np.arange(n)/SR
        rg = np.random.default_rng(7)
        x = np.zeros(n)
        for i in range(1, 13):
            fn = i*hz*np.sqrt(1+2e-4*i*i)
            if fn > SR/2*0.95: break
            x += (1.0/i)*np.sin(2*np.pi*fn*tt + rg.uniform(0,2*np.pi))
        x *= np.exp(-1.5*tt)
        x += 0.01*rg.standard_normal(n)   # noise floor does not decay
        f, c = detect(x, SR)
        if np.isnan(f) or midi_of(f)!=m: bad.append((m, None if np.isnan(f) else round(f,1), round(c,2)))
    print(f"  {delay_ms:4d}ms into the note: {len(notes)-len(bad)}/{len(notes)}" + (f" bad={bad[:5]}" if bad else ""))
