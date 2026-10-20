/**
 * Print finishing for the 3D materials (adapted from Book Design Studio's cover compositing):
 * the artwork canvas and its finish masks are baked into a colour map, a surface map
 * (R = clear-coat, G = roughness, B = metalness), a height map (emboss / deboss / foil
 * impression / ink pile) and an iridescence mask. Substrate behaviour — bare metal, clear film,
 * fabric with DTG or embroidery — is folded in here too.
 */
import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace, ShaderChunk, Texture, Vector2, type MeshPhysicalMaterial, type WebGLProgramParametersWithUniforms } from 'three';
import { hash2, rng } from '../lib/random';
import { parseColor } from '../lib/color';
import { createCanvas, context2d, tileFbm, tileNoise } from './texutil';
import type { FinishKey } from './types';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, x: number) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

/* -------------------------------------------------------------------------- */
/* Micro-relief tiles                                                          */
/* -------------------------------------------------------------------------- */

export type DetailKind = 'weave' | 'canvas' | 'jute' | 'tooth' | 'droplets' | 'knit' | 'none';

function heightCanvas(h: Float32Array, size: number): HTMLCanvasElement {
  const c = createCanvas(size, size);
  const ctx = context2d(c);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(clamp01(h[i]) * 255);
    img.data[4 * i] = v; img.data[4 * i + 1] = v; img.data[4 * i + 2] = v; img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const detailCache = new Map<string, HTMLCanvasElement>();

/** Tileable height map (luminance = height). */
export function detailCanvas(kind: DetailKind, seed = 7): HTMLCanvasElement {
  const key = `${kind}|${seed}`;
  const hit = detailCache.get(key);
  if (hit) return hit;
  const size = 256;
  const h = new Float32Array(size * size);
  const weave = (threads: number, fill: number, slub: number) => {
    const cell = size / threads;
    const prof = (t: number) => { const q = (t - 0.5) / 0.47; return q * q >= 1 ? 0 : Math.sqrt(1 - q * q); };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const gx = (x + 0.5) / cell, gy = (y + 0.5) / cell;
      const i = Math.floor(gx), j = Math.floor(gy);
      const fx = gx - i, fy = gy - j;
      const up = ((i + j) & 1) === 0;
      const warp = prof(fx) * (up ? 0.62 + 0.38 * Math.sin(Math.PI * fy) : 0.4);
      const weft = prof(fy) * (up ? 0.4 : 0.62 + 0.38 * Math.sin(Math.PI * fx));
      let v = Math.max(warp, weft);
      v += (tileNoise(x * 0.5, y / 8, size / 2, size / 8, seed) - 0.5) * 0.2;
      v += (tileNoise(x / 32, y / 32, size / 32, size / 32, seed + 3) - 0.5) * slub;
      h[y * size + x] = v * (1 - fill) + fill * 0.55;
    }
  };
  switch (kind) {
    case 'weave': weave(32, 0.05, 0.12); break;
    case 'canvas': weave(20, 0, 0.18); break;
    case 'jute': weave(10, 0, 0.35); break;
    case 'knit': {
      // Jersey knit: rows of V-shaped loops.
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const cols = 48, rows = 64;
        const gx = (x / size) * cols, gy = (y / size) * rows;
        const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy);
        const v = 1 - Math.abs(fx - 0.5 - (fy - 0.5) * 0.35 * (Math.floor(gx) % 2 ? 1 : -1)) * 2;
        h[y * size + x] = clamp01(0.25 + 0.7 * Math.pow(Math.max(0, v), 0.6) + (hash2(x, y, seed) - 0.5) * 0.08);
      }
      break;
    }
    case 'droplets': {
      h.fill(0.5);
      const r = rng(seed * 31 + 5);
      for (let k = 0; k < 520; k++) {
        const cx = r() * size, cy = r() * size, rad = 1.2 + Math.pow(r(), 3) * 7.5, el = 0.75 + r() * 0.5;
        for (let dy = -Math.ceil(rad * el) - 1; dy <= Math.ceil(rad * el) + 1; dy++) for (let dx = -Math.ceil(rad) - 1; dx <= Math.ceil(rad) + 1; dx++) {
          const px = ((Math.floor(cx) + dx) % size + size) % size, py = ((Math.floor(cy) + dy) % size + size) % size;
          const d = Math.hypot(dx / rad, dy / (rad * el));
          if (d < 1) h[py * size + px] = Math.max(h[py * size + px], 0.5 + 0.5 * Math.sqrt(1 - d * d));
        }
      }
      break;
    }
    case 'tooth':
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = tileFbm(x / 8, y / 8, size / 8, size / 8, 4, seed) + (hash2(x, y, seed + 1) - 0.5) * 0.15;
      break;
    case 'none':
      h.fill(0.5);
      break;
  }
  const c = heightCanvas(h, size);
  detailCache.set(key, c);
  return c;
}

export interface DetailUniforms {
  detailMap: { value: Texture };
  detailRepeat: { value: Vector2 };
  detailScale: { value: number };
}

/** A tiled micro-relief on top of the material's bump map, independent of the art resolution. */
export function installDetailBump(m: MeshPhysicalMaterial, u: DetailUniforms, key: string): void {
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.detailMap = u.detailMap;
    shader.uniforms.detailRepeat = u.detailRepeat;
    shader.uniforms.detailScale = u.detailScale;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <bumpmap_pars_fragment>', `#include <bumpmap_pars_fragment>
#ifdef USE_BUMPMAP
uniform sampler2D detailMap;
uniform vec2 detailRepeat;
uniform float detailScale;
vec2 detailDHdxy() {
  vec2 uvD = vBumpMapUv * detailRepeat;
  vec2 dx = dFdx( uvD );
  vec2 dy = dFdy( uvD );
  float h = detailScale * texture2D( detailMap, uvD ).x;
  return vec2( detailScale * texture2D( detailMap, uvD + dx ).x - h, detailScale * texture2D( detailMap, uvD + dy ).x - h );
}
#endif`)
      .replace('#include <normal_fragment_maps>', ShaderChunk.normal_fragment_maps.replace('dHdxy_fwd()', 'dHdxy_fwd() + detailDHdxy() * ( 1.0 - 0.8 * metalnessFactor )'));
  };
  m.customProgramCacheKey = () => `brs-detail-${key}`;
}

export function detailUniforms(kind: DetailKind, repeatX: number, repeatY: number, scale: number, anisotropy: number, owned: Texture[]): DetailUniforms {
  const t = new CanvasTexture(detailCanvas(kind));
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = anisotropy;
  owned.push(t);
  return { detailMap: { value: t }, detailRepeat: { value: new Vector2(repeatX, repeatY) }, detailScale: { value: kind === 'none' ? 0 : scale } };
}

/* -------------------------------------------------------------------------- */
/* Composite                                                                   */
/* -------------------------------------------------------------------------- */

const FOIL: Partial<Record<FinishKey, { color: [number, number, number]; rough: number }>> = {
  'gold-foil': { color: [236, 192, 98], rough: 0.17 },
  'silver-foil': { color: [226, 229, 233], rough: 0.14 },
  'copper-foil': { color: [222, 136, 92], rough: 0.18 },
  'holo-foil': { color: [218, 222, 228], rough: 0.12 },
};

export interface Composite {
  color: CanvasTexture;
  /** R = clear-coat, G = roughness, B = metalness. */
  surface: CanvasTexture;
  bump: CanvasTexture;
  holo: CanvasTexture | null;
  /** Coverage of the art (for clear substrates), as an alpha map; null when opaque. */
  alpha: CanvasTexture | null;
  hasClearcoat: boolean;
  hasGloss: boolean;
  dispose(): void;
}

export interface CompositeSource {
  art: HTMLCanvasElement | null;
  masks: Partial<Record<FinishKey, HTMLCanvasElement>>;
  /** Colour under the art (the substrate). */
  base: string;
  /** Substrate finish where nothing special is printed. */
  roughness: number;
  metalness: number;
  clearcoat: number;
  /**
   * How ink sits on the substrate:
   *  - 'opaque': ink covers the substrate (paper, board, white-coated metal)
   *  - 'metal':  transparent inks on bare metal (metallic everywhere except white base)
   *  - 'clear':  ink on clear film / glass (alpha = ink coverage; white base makes it opaque)
   *  - 'dtg' / 'screen' / 'embroidery': fabric prints
   */
  mode: 'opaque' | 'metal' | 'clear' | 'dtg' | 'screen' | 'embroidery' | 'etched';
  /** Physical size of the art in pt (for blur radii). */
  widthPt: number;
  anisotropy: number;
  maxPx?: number;
}

function readMask(src: HTMLCanvasElement, w: number, h: number, scratch: HTMLCanvasElement): Float32Array | null {
  const ctx = context2d(scratch, true);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const n = w * h;
  const out = new Float32Array(n);
  let any = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = d[j + 3];
    if (a === 0) continue;
    const v = ((0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) * a) / 65025;
    out[i] = v;
    any += v;
  }
  return any > 0 ? out : null;
}

function blurInPlace(a: Float32Array, w: number, h: number, r: number): void {
  if (r < 1) return;
  const line = new Float32Array(Math.max(w, h));
  const norm = 1 / (2 * r + 1);
  for (let iter = 0; iter < 2; iter++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[o + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) { line[x] = acc * norm; acc += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; }
      a.set(line.subarray(0, w), o);
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) { line[y] = acc * norm; acc += a[Math.min(h - 1, y + r + 1) * w + x] - a[Math.max(0, y - r) * w + x]; }
      for (let y = 0; y < h; y++) a[y * w + x] = line[y];
    }
  }
}

export function colorTexture(canvas: HTMLCanvasElement, anisotropy: number): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

export function dataTexture(canvas: HTMLCanvasElement, anisotropy: number): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = NoColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

export function compose(src: CompositeSource): Composite {
  const art = src.art;
  const maxPx = src.maxPx ?? 2048;
  let w = 2, h = 2;
  if (art && art.width > 1 && art.height > 1) {
    const k = Math.min(1, maxPx / Math.max(art.width, art.height), Math.sqrt(4e6 / (art.width * art.height)));
    w = Math.max(2, Math.round(art.width * k));
    h = Math.max(2, Math.round(art.height * k));
  }
  const colorCanvas = createCanvas(w, h);
  const cctx = context2d(colorCanvas, true);
  const clear = src.mode === 'clear' || src.mode === 'etched';
  if (!clear) { cctx.fillStyle = src.base; cctx.fillRect(0, 0, w, h); }
  if (art && art.width > 1) cctx.drawImage(art, 0, 0, w, h);
  const n = w * h;
  const scratch = createCanvas(w, h);
  const masks: Partial<Record<FinishKey, Float32Array>> = {};
  for (const [key, cnv] of Object.entries(src.masks) as [FinishKey, HTMLCanvasElement | undefined][]) {
    if (!cnv || cnv.width < 1) continue;
    const m = readMask(cnv, w, h, scratch);
    if (m) masks[key] = m;
  }
  // Art coverage (alpha) for the substrate-dependent modes.
  const needCoverage = src.mode !== 'opaque';
  let coverage: Float32Array | null = null;
  if (needCoverage && art && art.width > 1) {
    const actx = context2d(scratch, true);
    actx.clearRect(0, 0, w, h);
    actx.drawImage(art, 0, 0, w, h);
    const d = actx.getImageData(0, 0, w, h).data;
    coverage = new Float32Array(n);
    for (let i = 0; i < n; i++) coverage[i] = d[4 * i + 3] / 255;
  }
  const ppp = w / Math.max(1, src.widthPt);
  const deb = masks['blind-deboss'] ?? null, emb = masks.emboss ?? null, gloss = masks['spot-gloss'] ?? null, white = masks['white-base'] ?? null;
  const foilKeys = (['gold-foil', 'silver-foil', 'copper-foil', 'holo-foil'] as FinishKey[]).filter((k) => masks[k]);
  const foilMasks = foilKeys.map((k) => masks[k] as Float32Array), foilDefs = foilKeys.map((k) => FOIL[k]!);
  const holo = masks['holo-foil'] ?? null;
  const height = new Float32Array(n).fill(0.5);
  if (deb) for (let i = 0; i < n; i++) height[i] -= 0.42 * deb[i];
  if (emb) for (let i = 0; i < n; i++) height[i] += 0.42 * emb[i];
  for (const fm of foilMasks) for (let i = 0; i < n; i++) height[i] -= 0.08 * fm[i];
  if (gloss) for (let i = 0; i < n; i++) height[i] += 0.05 * gloss[i];
  if (coverage && (src.mode === 'screen')) for (let i = 0; i < n; i++) height[i] += 0.06 * coverage[i];
  if (coverage && src.mode === 'embroidery') for (let i = 0; i < n; i++) height[i] += 0.35 * coverage[i];
  blurInPlace(height, w, h, Math.max(1, Math.round(0.4 * ppp)));
  const base = parseColor(src.base);
  const colorImg = cctx.getImageData(0, 0, w, h);
  const cd = colorImg.data;
  const surfaceCanvas = createCanvas(w, h), bumpCanvas = createCanvas(w, h);
  const sctx = context2d(surfaceCanvas), bctx = context2d(bumpCanvas);
  const surf = sctx.createImageData(w, h), bimg = bctx.createImageData(w, h);
  const sd = surf.data, bd = bimg.data;
  let alphaCanvas: HTMLCanvasElement | null = null, ad: Uint8ClampedArray | null = null, aimg: ImageData | null = null;
  if (clear) { alphaCanvas = createCanvas(w, h); aimg = context2d(alphaCanvas).createImageData(w, h); ad = aimg.data; }
  let holoCanvas: HTMLCanvasElement | null = null, hd: Uint8ClampedArray | null = null, himg: ImageData | null = null;
  if (holo) { holoCanvas = createCanvas(w, h); himg = context2d(holoCanvas).createImageData(w, h); hd = himg.data; }
  const grain = new Float32Array(64 * 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) grain[y * 64 + x] = 0.94 + 0.06 * hash2(x, y >> 2, 3);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    let r = cd[j], g = cd[j + 1], b = cd[j + 2];
    let rough = src.roughness, metal = src.metalness, cc = src.clearcoat;
    const cov = coverage ? coverage[i] : 1;
    const wb = white ? white[i] : 0;
    if (src.mode === 'metal') {
      // Transparent inks over bare aluminium stay metallic; a white base turns them opaque.
      metal = 1 - 0.95 * wb;
      rough = src.roughness + 0.12 * wb;
      if (cov < 1) { r = r * cov + base.r * (1 - cov); g = g * cov + base.g * (1 - cov); b = b * cov + base.b * (1 - cov); }
    } else if (src.mode === 'dtg' && coverage) {
      // Ink soaks into the fibres: multiply with the fabric, slightly muted.
      const k = cov * 0.92;
      r = base.r + (r * (0.25 + 0.75 * base.r / 255) - base.r) * k;
      g = base.g + (g * (0.25 + 0.75 * base.g / 255) - base.g) * k;
      b = base.b + (b * (0.25 + 0.75 * base.b / 255) - base.b) * k;
      if (base.r + base.g + base.b < 200) { r = base.r + (cd[j] * 0.92 - base.r) * k; g = base.g + (cd[j + 1] * 0.92 - base.g) * k; b = base.b + (cd[j + 2] * 0.92 - base.b) * k; }
    } else if (src.mode === 'screen' && coverage) {
      rough -= 0.25 * cov; // plastisol sits on top with a soft sheen
    } else if (src.mode === 'embroidery' && coverage) {
      rough -= 0.35 * cov; // thread sheen
      cc = Math.max(cc, 0.15 * cov);
    }
    if (deb && deb[i] > 0) { const k = 1 - 0.18 * deb[i]; r *= k; g *= k; b *= k; rough += 0.06 * deb[i]; }
    for (let f = 0; f < foilMasks.length; f++) {
      const mf = foilMasks[f][i];
      if (mf <= 0) continue;
      const fc = foilDefs[f].color;
      const gr = grain[((((i / w) | 0) & 63) << 6) | (i % w & 63)];
      r += (fc[0] * gr - r) * mf; g += (fc[1] * gr - g) * mf; b += (fc[2] * gr - b) * mf;
      rough += (foilDefs[f].rough - rough) * mf;
      metal = Math.max(metal, mf);
      cc *= 1 - mf;
    }
    if (gloss && gloss[i] > 0) { rough += (0.08 - rough) * gloss[i]; cc = Math.max(cc, gloss[i]); }
    cd[j] = r; cd[j + 1] = g; cd[j + 2] = b;
    if (clear) cd[j + 3] = 255;
    sd[j] = clamp01(cc) * 255; sd[j + 1] = clamp01(rough) * 255; sd[j + 2] = clamp01(metal) * 255; sd[j + 3] = 255;
    const hv = clamp01(height[i]) * 255;
    bd[j] = hv; bd[j + 1] = hv; bd[j + 2] = hv; bd[j + 3] = 255;
    if (ad) {
      let a = src.mode === 'etched' ? Math.min(1, cov) * 0.9 : Math.max(cov, wb);
      for (const fm of foilMasks) a = Math.max(a, fm[i]);
      const v = clamp01(a) * 255;
      ad[j] = v; ad[j + 1] = v; ad[j + 2] = v; ad[j + 3] = 255;
    }
    if (hd && holo) { const v = holo[i] * 255; hd[j] = v; hd[j + 1] = v; hd[j + 2] = v; hd[j + 3] = 255; }
  }
  cctx.putImageData(colorImg, 0, 0);
  sctx.putImageData(surf, 0, 0);
  bctx.putImageData(bimg, 0, 0);
  if (alphaCanvas && aimg) context2d(alphaCanvas).putImageData(aimg, 0, 0);
  if (holoCanvas && himg) context2d(holoCanvas).putImageData(himg, 0, 0);
  const an = src.anisotropy;
  const color = colorTexture(colorCanvas, an), surface = dataTexture(surfaceCanvas, an), bump = dataTexture(bumpCanvas, an);
  const holoTex = holoCanvas ? dataTexture(holoCanvas, an) : null;
  const alphaTex = alphaCanvas ? dataTexture(alphaCanvas, an) : null;
  const hasGloss = !!gloss;
  return {
    color, surface, bump, holo: holoTex, alpha: alphaTex, hasGloss,
    hasClearcoat: hasGloss || src.clearcoat > 0 || src.mode === 'embroidery',
    dispose() { color.dispose(); surface.dispose(); bump.dispose(); holoTex?.dispose(); alphaTex?.dispose(); },
  };
}

/** Assign a composite to a physical material. */
export function applyComposite(m: MeshPhysicalMaterial, c: Composite, clearcoatRoughness = 0.06): void {
  m.map = c.color;
  m.roughnessMap = c.surface;
  m.metalnessMap = c.surface;
  m.roughness = 1;
  m.metalness = 1;
  m.bumpMap = c.bump;
  m.clearcoat = c.hasClearcoat ? 1 : 0;
  m.clearcoatMap = c.hasClearcoat ? c.surface : null;
  m.clearcoatRoughness = c.hasGloss ? 0.04 : clearcoatRoughness;
  m.iridescence = c.holo ? 1 : 0;
  m.iridescenceMap = c.holo;
  m.alphaMap = c.alpha;
  m.transparent = !!c.alpha;
  m.alphaTest = c.alpha ? 0.02 : 0;
  m.needsUpdate = true;
}
