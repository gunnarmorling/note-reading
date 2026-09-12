# A line-for-line mirror of the JS about to be written, so the sweep below
# tests the shipped algorithm and not an idealised version of it.
import numpy as np
from proto import piano, midi_of, notes

MIN_HZ, MAX_HZ, PEAK_RATIO, MIN_CLARITY = 62, 1400, 0.9, 0.5

def rms(buf):
    s = 0.0
    for v in buf: s += v*v
    return (s/len(buf))**0.5

def detect_pitch(buf, sample_rate):
    W = len(buf)
    min_lag = max(2, int(sample_rate//MAX_HZ))
    max_lag = min(W - 2, int(np.ceil(sample_rate/MIN_HZ)))
    if max_lag <= min_lag + 1: return float('nan')

    # prefix[j] = sum of squares of the first j samples
    prefix = np.zeros(W+1)
    for i in range(W): prefix[i+1] = prefix[i] + buf[i]*buf[i]

    nsdf = np.zeros(max_lag+2)
    for tau in range(min_lag, max_lag+2):
        if tau > max_lag: break
        n = W - tau
        ac = float(np.dot(buf[:n], buf[tau:tau+n]))
        energy = (prefix[n] - prefix[0]) + (prefix[W] - prefix[tau])
        nsdf[tau] = (2*ac/energy) if energy > 0 else 0.0

    best, tau_best = 0.0, -1
    for t in range(min_lag+1, max_lag):
        if nsdf[t] > nsdf[t-1] and nsdf[t] >= nsdf[t+1] and nsdf[t] > best:
            best, tau_best = nsdf[t], t
    if tau_best < 0 or best < MIN_CLARITY: return float('nan')

    tau = tau_best
    for t in range(min_lag+1, max_lag):
        if nsdf[t] > nsdf[t-1] and nsdf[t] >= nsdf[t+1] and nsdf[t] >= PEAK_RATIO*best:
            tau = t; break

    y0, y1, y2 = nsdf[tau-1], nsdf[tau], nsdf[tau+1]
    d = y0 - 2*y1 + y2
    shift = (0.5*(y0-y2)/d) if d != 0 else 0.0
    if abs(shift) > 1: shift = 0.0
    return sample_rate/(tau+shift)

if __name__ == "__main__":
    SR, W = 48000, 4096
    print("shipped algorithm, full drill range:")
    for label, kw in [("plain 1/n", {}), ("weak fundamental", dict(weak_fund=True)),
                      ("inharmonic B=1e-3", dict(B=1e-3)),
                      ("weak+inharm+noisy", dict(weak_fund=True, B=8e-4, noise=0.04)),
                      ("no fundamental at all", dict(weak_fund=True, B=2e-4, noise=0.02))]:
        bad=[]
        for d, m, hz in notes:
            f = detect_pitch(piano(hz, SR, W, **kw), SR)
            if np.isnan(f) or midi_of(f) != m: bad.append((m, round(hz,1), None if np.isnan(f) else round(f,1)))
        print(f"  {label:24s} {len(notes)-len(bad)}/{len(notes)}" + (f"  bad={bad}" if bad else ""))
    for sr in (44100, 48000):
        bad=[]
        for d, m, hz in notes:
            f = detect_pitch(piano(hz, sr, W, weak_fund=True, B=5e-4, noise=0.03), sr)
            if np.isnan(f) or midi_of(f)!=m: bad.append(m)
        print(f"  at {sr} Hz: {len(notes)-len(bad)}/{len(notes)}" + (f" bad={bad}" if bad else ""))
    rng = np.random.default_rng(4)
    print("  noise rejected:", np.isnan(detect_pitch(rng.standard_normal(W), SR)))
    print("  silence rejected:", np.isnan(detect_pitch(np.zeros(W), SR)))
    print("  440Hz sine ->", round(detect_pitch(np.sin(2*np.pi*440*np.arange(W)/SR), SR), 2), "Hz")
