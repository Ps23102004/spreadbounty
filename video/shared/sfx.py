"""Code-synthesized SFX for the Spreadbounty videos (adapted from the Paylink pipeline). No samples, no downloads.
Usage: python3 sfx.py <cues.json> <out.wav> <duration_seconds>
cues.json: [{"t": 1.55, "s": "shutter", "g": 1.0, "n": 0, "dt": 0}, ...]
  s: tick | type (n ticks every dt) | blip | lines (n blips every dt) | shutter | stamp | slide | bell | thud | rest
"""
import json, sys
import numpy as np
from scipy.signal import butter, sosfilt

SR = 48000
rng = np.random.default_rng(402)  # seeded: identical output every run

def env(n, a, d):  # attack/exp-decay envelope, seconds
    t = np.arange(n) / SR
    e = np.exp(-t / max(d, 1e-4))
    if a > 0:
        e *= np.clip(t / a, 0, 1)
    return e

def filt(x, kind, f):
    return sosfilt(butter(2, f, btype=kind, fs=SR, output="sos"), x)

def tick(g=1.0):
    n = int(0.03 * SR)
    x = filt(rng.standard_normal(n), "highpass", 2500) * env(n, 0.0005, 0.004)
    x += np.sin(2 * np.pi * rng.uniform(2200, 3200) * np.arange(n) / SR) * env(n, 0, 0.006) * 0.3
    return x * 0.22 * g

def blip(g=1.0):
    n = int(0.06 * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * 1480 * t) * env(n, 0.001, 0.012) * 0.16 * g

def shutter(g=1.0):
    n = int(0.22 * SR); t = np.arange(n) / SR
    x = np.zeros(n)
    for off in (0.0, 0.028, 0.055):
        k = int(off * SR); m = int(0.03 * SR)
        x[k:k + m] += filt(rng.standard_normal(m), "bandpass", [600, 4000]) * env(m, 0.0005, 0.006)
    x += np.sin(2 * np.pi * 95 * t) * env(n, 0.002, 0.05) * 0.8
    return x * 0.45 * g

def stamp(g=1.0):
    n = int(0.5 * SR); t = np.arange(n) / SR
    f = 46 + 50 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.13)
    slap = filt(rng.standard_normal(n), "lowpass", 1800) * env(n, 0.0005, 0.025)
    crisp = filt(rng.standard_normal(n), "highpass", 3000) * env(n, 0.0, 0.008) * 0.4
    return (body * 1.0 + slap * 0.9 + crisp) * 0.7 * g

def thud(g=1.0):
    n = int(0.3 * SR); t = np.arange(n) / SR
    f = 70 + 30 * np.exp(-t / 0.02)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, 0.08) * 0.5 * g

def slide(g=1.0, dur=0.45):
    n = int(dur * SR); t = np.arange(n) / SR
    x = filt(rng.standard_normal(n), "bandpass", [500, 3500])
    e = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    return x * e * 0.10 * g

def bell(g=1.0):
    n = int(1.8 * SR); t = np.arange(n) / SR
    x = sum(a * np.sin(2 * np.pi * f * t) * env(n, 0.003, d) for f, a, d in ((659.3, 1.0, 0.9), (988.0, 0.5, 0.6), (1976.0, 0.18, 0.3)))
    return x * 0.16 * g

def rest(g=1.0):  # a quote comes to rest on the book: short wooden clack, pitched low
    n = int(0.16 * SR); t = np.arange(n) / SR
    f = 180 + 120 * np.exp(-t / 0.01)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.001, 0.035)
    click = filt(rng.standard_normal(n), "bandpass", [1200, 5000]) * env(n, 0.0003, 0.004)
    return (body * 0.8 + click * 0.5) * 0.5 * g

GEN = {"rest": rest, "tick": tick, "blip": blip, "shutter": shutter, "stamp": stamp, "thud": thud, "slide": slide, "bell": bell}

def main():
    cues, out, dur = json.load(open(sys.argv[1])), sys.argv[2], float(sys.argv[3])
    mix = np.zeros(int(dur * SR) + SR)
    def place(t, x):
        k = int(round(t * SR)); x = x[: max(0, len(mix) - k)]; mix[k:k + len(x)] += x
    for c in cues:
        s, t, g = c["s"], c["t"], c.get("g", 1.0)
        if s == "type":
            for i in range(c["n"]):
                place(t + i * c["dt"], tick(g * (0.8 + 0.4 * rng.random())))
        elif s == "lines":
            for i in range(c["n"]):
                place(t + i * c["dt"], blip(g))
        elif s == "slide":
            place(t, slide(g, c.get("dur", 0.45)))
        else:
            place(t, GEN[s](g))
    mix = mix[: int(dur * SR)]
    peak = np.max(np.abs(mix)) or 1.0
    mix = np.tanh(mix / peak * 1.8) / np.tanh(1.8) * 0.89  # soft-clip: lifts ticks, peaks ~ -1 dBFS
    stereo = np.stack([mix, mix], axis=1)
    import wave
    with wave.open(out, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((stereo * 32767).astype("<i2").tobytes())
    print(f"wrote {out} ({dur}s, {len(cues)} cues)")

if __name__ == "__main__":
    main()
