# Mirrors tests.html exactly: the same LCG, the same pianoish(), the same
# cases, run against the same detector that audio.js implements.
import math, struct, numpy as np
from exact import detect_pitch, rms as rms_py

WINDOW, SR = 4096, 48000
def f32(x): return struct.unpack('f', struct.pack('f', x))[0]

def seeded(seed):
    s = seed & 0xFFFFFFFF
    def nxt():
        nonlocal s
        s = (s*1664525 + 1013904223) & 0xFFFFFFFF
        return s/4294967296
    return nxt

def sine(hz, n=WINDOW, sr=SR):
    return np.array([f32(math.sin(2*math.pi*hz*i/sr)) for i in range(n)])

def pianoish(hz, fundamental=1.0, B=2e-4, noise=0.02, seed=1, n=WINDOW, sr=SR):
    rand = seeded(seed)
    buf = [0.0]*n
    phases = [rand()*2*math.pi for _ in range(12)]
    for p in range(1, 13):
        fn = p*hz*math.sqrt(1 + B*p*p)
        if fn > sr*0.475: break
        amp = (fundamental if p == 1 else 1.0)/p
        for i in range(n): buf[i] = f32(buf[i] + amp*math.sin(2*math.pi*fn*i/sr + phases[p-1]))
    peak = 0.0
    for i in range(n):
        buf[i] = f32(f32(buf[i]*math.exp(-1.5*i/sr)) + noise*(rand()*2-1))
        peak = max(peak, abs(buf[i]))
    return np.array([f32(v/peak) for v in buf])

LETTERS=["C","D","E","F","G","A","H"]; SEMI={"C":0,"D":2,"E":4,"F":5,"G":7,"A":9,"H":11}
def to_midi(d): return ((d//7)+1)*12 + SEMI[LETTERS[d%7]]
def lab(d): return LETTERS[d%7]+str(d//7)
def midi_for(hz):
    if not (hz > 0): return None
    return round(69 + 12*math.log2(hz/440))
def dn(l,o): return o*7+LETTERS.index(l)
def range_for(bottom, top, ledgers): return list(range(bottom-2*ledgers, top+2*ledgers+1))

fails = []
def check(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok or not detail else "  — "+detail))
    if not ok: fails.append(name)

s = sine(440)
check("rms of a full-scale sine is 1/sqrt(2) (tol 1e-3)", abs(rms_py(s) - 2**-0.5) < 1e-3, f"got {rms_py(s):.6f}, off by {abs(rms_py(s)-2**-0.5):.2e}")
check("rms of silence is 0", rms_py(np.zeros(WINDOW)) == 0)
f = detect_pitch(s, SR);            check("pure 440 within 0.5Hz", abs(f-440) < 0.5, f"got {f:.3f}")
f = detect_pitch(sine(65.41), SR);  check("pure 65.41 within 0.5Hz", abs(f-65.41) < 0.5, f"got {f:.3f}")
check("midiFor(440)=69", midi_for(440) == 69)
check("midiFor(261.626)=60", midi_for(261.626) == 60)
check("30 cents sharp still 69", midi_for(440*2**(0.3/12)) == 69)
check("silence has no pitch", math.isnan(detect_pitch(np.zeros(WINDOW), SR)))
rand = seeded(11)
noise = np.array([f32(rand()*2-1) for _ in range(WINDOW)])
nf = detect_pitch(noise, SR)
check("noise has no pitch", math.isnan(nf), f"got {nf}")

dns = sorted(set(range_for(dn("G",2), dn("A",3), 2) + range_for(dn("E",4), dn("F",5), 2)))
for what, kw in [("a piano tone", {}), ("a weak fundamental", dict(fundamental=0.15)),
                 ("a very inharmonic string", dict(B=1e-3, fundamental=0.3, seed=5))]:
    wrong=[]
    for d in dns:
        expect = to_midi(d)
        hz = 440*2**((expect-69)/12)
        heard = midi_for(detect_pitch(pianoish(hz, **kw), SR))
        if heard != expect: wrong.append(f"{lab(d)} heard as {heard}")
    check(f"every note in range is heard right: {what}", not wrong, "; ".join(wrong))

# attackIndex
ENV_BLOCK, LOOKBACK_MS = 128, 60
def envelope(buf):
    return [ (sum(v*v for v in buf[s:s+ENV_BLOCK])/ENV_BLOCK)**0.5
             for s in range(0, len(buf)-ENV_BLOCK+1, ENV_BLOCK) ]
def attack_index(buf, sr):
    env = envelope(buf); best=0.0; bb=0
    for b in range(1, len(env)):
        r = env[b]/max(env[b-1], 1e-9)
        if r > best: best, bb = r, b
    earliest = len(buf) - round(LOOKBACK_MS/1000*sr)
    return min(len(buf), max(earliest, bb*ENV_BLOCK))
attack = 3000
buf = np.zeros(WINDOW)
tone = sine(220, WINDOW-attack)
for i in range(len(tone)): buf[attack+i] = tone[i]*math.exp(-1.5*i/SR)
found = attack_index(buf, SR)
check("attack located within two blocks", abs(found-attack) <= 2*128, f"found {found}, want {attack}")
check("envelope covers the window", len(envelope(np.zeros(WINDOW))) == WINDOW//128, f"got {len(envelope(np.zeros(WINDOW)))}")

# onset logic
ONSET_FLOOR, ONSET_RATIO, PEAK_DECAY = 0.005, 1.5, 0.92
is_onset = lambda l,p: l > ONSET_FLOOR and l > p*ONSET_RATIO
next_peak = lambda l,p: max(l, p*PEAK_DECAY)
check("strike out of silence", is_onset(0.2, 0.001))
check("hiss is not an onset", not is_onset(0.004, 0.001))
check("strike over a ringing note", is_onset(0.29, 0.15))
peak=level=0.3; spurious=0
for _ in range(120):
    level *= math.exp(-1.5/60)
    if is_onset(level, peak): spurious += 1
    peak = next_peak(level, peak)
check("a decaying note never re-triggers", spurious == 0, f"{spurious} spurious onsets")
print()
print("FAILURES:", fails if fails else "none")
