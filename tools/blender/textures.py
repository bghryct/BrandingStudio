"""
Tileable tangent-space normal maps (OpenGL convention: +Y = green = up the image) for the
Branding Studio materials. Pure numpy (run with Blender's Python, which bundles numpy):

    Blender -b --python tools/blender/textures.py -- [name ...]

Writes public/textures/{jersey,canvas,fleece,paper,kraft,brushed,ice}-normal.png (512 x 512).
Every map is periodic: noise is shaped in the frequency domain and strokes wrap around.
"""
import os
import struct
import sys
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'public', 'textures'))
N = 512


def write_png(path, rgb):
    """8-bit RGB PNG with per-row 'Up'/'Sub' filtering (smooth normal maps compress well)."""
    h, w, _ = rgb.shape
    a = rgb.astype(np.int16)
    up = (a - np.roll(a, 1, axis=0)) % 256
    up[0] = a[0]
    raw = b''.join(b'\x02' + up[y].astype(np.uint8).tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def spectral_noise(rng, fmin, fmax, power=1.0, aniso=(1.0, 1.0)):
    """Periodic band-limited noise in [−1, 1]; aniso scales frequencies (x, y)."""
    white = rng.standard_normal((N, N))
    F = np.fft.fft2(white)
    fy = np.fft.fftfreq(N)[:, None] * N * aniso[1]
    fx = np.fft.fftfreq(N)[None, :] * N * aniso[0]
    f = np.sqrt(fx * fx + fy * fy) + 1e-6
    filt = ((f >= fmin) & (f <= fmax)) / f ** power
    out = np.real(np.fft.ifft2(F * filt))
    return out / (np.abs(out).max() + 1e-9)


def blur(h, sigma):
    if sigma <= 0:
        return h
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.fftfreq(N)[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(h) * g))


def strokes(rng, count, length, width, jitter=0.15, angle=None, depth=1.0, angle_spread=np.pi):
    """Wrapped line strokes (fibres, cracks) splatted into a periodic height field."""
    h = np.zeros((N, N))
    for _ in range(count):
        x, y = rng.uniform(0, N, 2)
        a = (angle if angle is not None else 0.0) + rng.uniform(-angle_spread / 2, angle_spread / 2)
        L = length * rng.uniform(0.5, 1.4)
        steps = int(L * 2) + 2
        for t in np.linspace(0, 1, steps):
            a += rng.normal(0, jitter) / steps * 4
            px, py = (x + np.cos(a) * L * t) % N, (y + np.sin(a) * L * t) % N
            ix, iy = int(px), int(py)
            h[iy % N, ix % N] += depth * rng.uniform(0.6, 1.0)
    return blur(h, width)


def to_normal(h, strength):
    """Height (rows downward) → OpenGL normal map; tangent x = right, y = up the image."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    drow = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx = -dx * strength
    ny = drow * strength  # dh/dv with v up = −dh/drow; n.y = −dh/dv
    nz = np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / l, ny / l, nz / l], axis=-1) * 0.5 + 0.5
    return np.clip(np.round(rgb * 255), 0, 255).astype(np.uint8)


def norm01(h):
    return (h - h.min()) / (h.max() - h.min() + 1e-9)


def jersey(rng):
    # Plain-knit face: columns (wales) of V-shaped stitches; each leg is an inclined loop.
    cw, ch = 16, 16
    y, x = np.mgrid[0:N, 0:N].astype(float)
    gx, gy = x / cw, y / ch
    fx, fy = gx - np.floor(gx), gy - np.floor(gy)
    side = np.where(fx < 0.5, -1.0, 1.0)
    lx = np.where(fx < 0.5, fx * 2, (fx - 0.5) * 2)  # 0..1 across each leg
    # Each leg leans inward toward the bottom (the V), centre line offset by fy.
    c = 0.5 + side * (0.5 - fy) * 0.45
    d = np.abs(lx - c)
    leg = np.clip(1 - (d / 0.42) ** 2, 0, 1) ** 0.6
    loop = leg * (0.75 + 0.25 * np.sin(np.pi * fy))
    h = loop + 0.08 * spectral_noise(rng, 20, 200) + 0.1 * spectral_noise(rng, 2, 8)
    return to_normal(blur(h, 0.6), 2.2)


def weave(rng, threads, fill, slub, strength):
    cell = N / threads
    y, x = np.mgrid[0:N, 0:N].astype(float)
    gx, gy = (x + 0.5) / cell, (y + 0.5) / cell
    i, j = np.floor(gx), np.floor(gy)
    fx, fy = gx - i, gy - j
    up = ((i + j) % 2) == 0
    prof = lambda t: np.sqrt(np.clip(1 - ((t - 0.5) / 0.47) ** 2, 0, 1))
    warp = prof(fx) * np.where(up, 0.62 + 0.38 * np.sin(np.pi * fy), 0.4)
    weft = prof(fy) * np.where(up, 0.4, 0.62 + 0.38 * np.sin(np.pi * fx))
    h = np.maximum(warp, weft)
    h += 0.12 * spectral_noise(rng, 30, 220, aniso=(0.3, 1.0))  # fibre hairiness along threads
    h += slub * spectral_noise(rng, 1, 6)
    h = h * (1 - fill) + fill * 0.55
    return to_normal(blur(h, 0.5), strength)


def fleece(rng):
    fuzz = spectral_noise(rng, 18, 140, power=0.6)
    soft = spectral_noise(rng, 3, 18, power=1.0)
    knit = np.sin(np.mgrid[0:N, 0:N][1] * 2 * np.pi / 10.6667) * 0.06  # faint wales (48 per tile)
    h = 0.55 * fuzz + 0.4 * soft + knit
    return to_normal(blur(h, 1.2), 2.6)


def paper(rng):
    fib = strokes(rng, 900, 18, 0.7, jitter=0.3)
    h = 0.6 * norm01(fib) + 0.35 * spectral_noise(rng, 40, 256, power=0.3) + 0.25 * spectral_noise(rng, 4, 30)
    return to_normal(blur(h, 0.5), 1.6)


def kraft(rng):
    fib = strokes(rng, 700, 34, 1.0, jitter=0.25)
    fl = np.zeros((N, N))
    for _ in range(26):
        x, y = rng.integers(0, N, 2)
        fl[y, x] = rng.uniform(6, 14)
    flecks = blur(fl, 2.2)
    h = 0.7 * norm01(fib) + 0.35 * spectral_noise(rng, 20, 200, power=0.4) + 0.4 * spectral_noise(rng, 2, 16) + flecks
    return to_normal(blur(h, 0.6), 2.2)


def brushed(rng):
    # Very long correlation along x (the brushing direction), fine across.
    streak = spectral_noise(rng, 3, 220, power=0.8, aniso=(18.0, 1.0))
    fine = spectral_noise(rng, 60, 256, power=0.2, aniso=(6.0, 1.0))
    h = 0.8 * streak + 0.2 * fine
    return to_normal(h, 1.4)


def ice(rng):
    ripple = spectral_noise(rng, 2, 9, power=1.2)
    cracks = strokes(rng, 22, 120, 0.8, jitter=0.5, depth=4.0)
    pits = np.zeros((N, N))
    for _ in range(420):
        x, y = rng.integers(0, N, 2)
        pits[y, x] = rng.uniform(0.6, 1.4)
    pits = blur(pits, 1.4)
    h = 1.6 * ripple - 0.9 * norm01(cracks) - 0.5 * norm01(pits) + 0.08 * spectral_noise(rng, 60, 256, power=0.2)
    return to_normal(blur(h, 0.4), 3.0)


MAPS = {
    'jersey': jersey,
    'canvas': lambda r: weave(r, 24, 0.0, 0.18, 2.6),
    'fleece': fleece,
    'paper': paper,
    'kraft': kraft,
    'brushed': brushed,
    'ice': ice,
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    os.makedirs(OUT, exist_ok=True)
    for i, name in enumerate(argv or list(MAPS)):
        rng = np.random.default_rng(1000 + i * 17 + len(name))
        img = MAPS[name](rng)
        path = os.path.join(OUT, f'{name}-normal.png')
        write_png(path, img)
        print(f'[{name}] {path} {os.path.getsize(path)} bytes')


main()
