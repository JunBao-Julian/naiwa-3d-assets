"""Synthesized sound design (no music): drones, risers, booms, whooshes, glints, ticks."""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
import wave

SR = 48000
DUR = 37.0
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)

def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype='band', fs=SR, output='sos'), x)
def lp(x, f, order=2):
    return sosfilt(butter(order, f, btype='low', fs=SR, output='sos'), x)
def hp(x, f, order=2):
    return sosfilt(butter(order, f, btype='high', fs=SR, output='sos'), x)

def add(t0, sig, gain=1.0, pan=0.0):
    """pan: -1 left .. 1 right; sig mono or (2,n)"""
    i = int(t0 * SR)
    if sig.ndim == 1:
        a = np.cos((pan + 1) * np.pi / 4); b = np.sin((pan + 1) * np.pi / 4)
        sl, sr = sig * a * 1.414, sig * b * 1.414
    else:
        sl, sr = sig
    n = min(len(sl), N - i)
    if n <= 0: return
    L[i:i+n] += sl[:n] * gain; R[i:i+n] += sr[:n] * gain

def env_adsr(n, a, d_curve):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4))
    return e * d_curve(t)

def boom(dur=2.4, f0=120, f1=34, depth=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 9)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 1.6) * np.minimum(1, t / 0.004)
    click = hp(rng.standard_normal(n), 1800) * np.exp(-t * 90) * 0.25
    rumble = lp(rng.standard_normal(n), 90) * np.exp(-t * 1.2) * 0.6
    return (body + click + rumble * depth) * 0.9

def thump(dur=0.6, f0=95, f1=45):
    n = int(dur * SR); t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 14)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7) * np.minimum(1, t / 0.003)
    s += hp(rng.standard_normal(n), 2500) * np.exp(-t * 120) * 0.08
    return s

def whoosh(dur=1.2, lo=300, hi=3500, peak=0.45, pan0=-0.6, pan1=0.6, air=1.0):
    n = int(dur * SR); t = np.arange(n) / SR; x = t / dur
    noise = rng.standard_normal(n)
    # sweep a band-pass by processing in short blocks
    out = np.zeros(n); blk = 1024
    for s in range(0, n, blk):
        e = min(n, s + blk); xc = (s + e) / 2 / n
        fc = lo * (hi / lo) ** (np.sin(np.pi * min(1, xc / (2 * peak))) if xc < peak else 1 - (xc - peak) / (1 - peak) * 0.6)
        seg = noise[max(0, s - 512):e]
        f = bp(seg, max(60, fc * 0.6), min(SR / 2 - 100, fc * 1.6))
        out[s:e] = f[-(e - s):]
    envl = np.where(x < peak, (x / peak) ** 2.2, np.exp(-(x - peak) / (1 - peak) * 3.2))
    out *= envl
    out = out / (np.abs(out).max() + 1e-9)
    p = pan0 + (pan1 - pan0) * x
    a = np.cos((p + 1) * np.pi / 4) * 1.414; b = np.sin((p + 1) * np.pi / 4) * 1.414
    return np.stack([out * a, out * b]) * air

def riser(dur=2.5, f0=180, f1=900):
    n = int(dur * SR); t = np.arange(n) / SR; x = t / dur
    f = f0 * (f1 / f0) ** (x ** 1.6)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25 + np.sin(2 * np.pi * np.cumsum(f * 1.5) / SR) * 0.12
    nz = rng.standard_normal(n); out = np.zeros(n); blk = 2048
    for s in range(0, n, blk):
        e = min(n, s + blk); fc = 400 + 6000 * ((s + e) / 2 / n) ** 2
        seg = nz[max(0, s - 1024):e]; out[s:e] = bp(seg, fc * 0.5, min(fc * 1.8, 20000))[-(e - s):]
    out = out / (np.abs(out).max() + 1e-9) * 0.6
    e = x ** 2.6
    return (tone + out) * e

def glint(dur=1.6, base=2600, n_part=5, bright=1.0):
    n = int(dur * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for k in range(n_part):
        f = base * (1 + 0.37 * k) * (1 + rng.uniform(-0.01, 0.01)); dly = 0.012 * k
        tt = np.maximum(0, t - dly)
        s += np.sin(2 * np.pi * f * tt) * np.exp(-tt * (5 + 2.5 * k)) * (t >= dly) * (0.8 ** k)
    s += hp(rng.standard_normal(n), 6000) * np.exp(-t * 25) * 0.15
    return s * 0.35 * bright

def tick(f=3200):
    n = int(0.05 * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) * np.exp(-t * 160) * 0.5 + hp(rng.standard_normal(n), 3000) * np.exp(-t * 400) * 0.3)

def drone(dur=4.0):
    n = int(dur * SR); t = np.arange(n) / SR
    s = (np.sin(2 * np.pi * 41 * t) * 0.6 + np.sin(2 * np.pi * 61.5 * t + 1) * 0.25 + np.sin(2 * np.pi * 82 * t) * 0.1)
    s *= 1 + 0.15 * np.sin(2 * np.pi * 0.35 * t)
    s += lp(rng.standard_normal(n), 140) * 0.5
    sw = np.minimum(1, t / 3.2) ** 1.6
    return s * sw

def air_swell(dur=3.0):
    n = int(dur * SR); t = np.arange(n) / SR; x = t / dur
    s = bp(rng.standard_normal(n), 2500, 9000) * np.sin(np.pi * x) ** 2
    return s / (np.abs(s).max() + 1e-9)

def bloop(f0=260, f1=820, dur=0.22):
    n = int(dur * SR); t = np.arange(n) / SR
    f = f0 + (f1 - f0) * (1 - np.exp(-t * 30))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 18) * np.minimum(1, t / 0.004) * 0.6

# ---------------- timeline ----------------
# A: dark contour slide (0-4)
add(0.0, drone(4.05), 0.55)
add(0.4, air_swell(3.0), 0.10)
add(0.3, whoosh(3.3, 220, 2400, peak=0.55, pan0=0.7, pan1=-0.5), 0.32)
add(1.7, riser(2.3, 160, 820), 0.30)
# B: snap push onto the eye + rack focus (4-8)
add(3.96, whoosh(0.9, 400, 5200, peak=0.22, pan0=-0.5, pan1=0.3), 0.55)
add(4.0, thump(0.7, 100, 44), 0.8)
add(4.85, glint(1.6, 2900, 5), 0.5, pan=-0.35)
add(5.0, tick(3400), 0.17, pan=0.4)
# C: crane up around the belly (8-12)
add(8.0, thump(0.6, 92, 44), 0.65)
add(8.0, whoosh(3.7, 180, 2000, peak=0.5, pan0=0.7, pan1=-0.7), 0.32)
add(8.5, tick(3000), 0.15, pan=-0.4)
# D: tilt down the arm (12-16)
add(12.0, thump(0.6, 88, 42), 0.65)
add(12.0, whoosh(3.2, 2400, 300, peak=0.45, pan0=0.4, pan1=0.1), 0.26)
add(13.6, tick(3200), 0.15, pan=-0.4)
add(14.2, riser(1.85, 140, 700), 0.30)
# E: floor-level swoop up to the title (16-22)
add(16.0, whoosh(1.7, 160, 3000, peak=0.18, pan0=-0.6, pan1=0.6), 0.5)
add(16.08, boom(3.6, 130, 32), 1.0)
add(16.1, glint(2.4, 1800, 6, 0.8), 0.3)
add(17.7, glint(2.2, 3100, 6), 0.55, pan=0.1)
add(17.65, air_swell(1.6), 0.08)
# F: overhead crane-down while spinning (22-27)
add(22.0, thump(0.6, 95, 44), 0.7)
add(22.05, whoosh(4.5, 1600, 180, peak=0.5, pan0=-0.9, pan1=0.9), 0.36)
add(22.4, tick(3000), 0.14, pan=-0.5)
# G: pull back as the colours fan out (27-32)
add(27.0, thump(0.45, 120, 60), 0.5)
add(27.0, whoosh(1.9, 2200, 400, peak=0.2, pan0=0.0, pan1=0.0), 0.34)
add(27.4, bloop(240, 760), 0.32, pan=-0.3); add(27.55, bloop(280, 900), 0.28, pan=0.3)
add(28.5, glint(1.4, 3400, 5), 0.3)
add(29.1, tick(3600), 0.12)
# H: arc to front, end lockup (32-37)
add(31.2, riser(0.8, 300, 1400), 0.18)
add(32.0, whoosh(2.4, 300, 1800, peak=0.3, pan0=0.6, pan1=0.0), 0.2)
add(32.05, boom(4.2, 115, 30), 0.95)
add(33.3, glint(2.6, 2400, 7), 0.55)
add(35.0, tick(3000), 0.14)

# ---------------- reverb + master ----------------
def ir(sec=2.2, seed=1):
    r = np.random.default_rng(seed); n = int(sec * SR); t = np.arange(n) / SR
    x = r.standard_normal(n) * np.exp(-t * 3.0)
    x = lp(x, 7000); x[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    return x / np.sqrt(np.sum(x ** 2))
wetL = fftconvolve(L, ir(seed=1))[:N]; wetR = fftconvolve(R, ir(seed=2))[:N]
outL = L + wetL * 0.32; outR = R + wetR * 0.32
outL = hp(outL, 24); outR = hp(outR, 24)
# gentle soft clip + normalize to -1 dBFS
peak = max(np.abs(outL).max(), np.abs(outR).max())
outL /= peak; outR /= peak
outL = np.tanh(outL * 1.2) / np.tanh(1.2); outR = np.tanh(outR * 1.2) / np.tanh(1.2)
g = 10 ** (-1 / 20) / max(np.abs(outL).max(), np.abs(outR).max())
st = np.stack([outL * g, outR * g], 1)
# fade tail
fade = int(0.8 * SR); st[-fade:] *= np.linspace(1, 0, fade)[:, None]
pcm = (st * 32767).astype(np.int16)
with wave.open('sfx.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('sfx.wav written', pcm.shape)
