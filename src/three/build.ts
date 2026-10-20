/**
 * Geometry and material helpers shared by the product models: revolved profiles with analytic
 * normals and custom UVs (cans, bottles, cups, jars), revolved label patches, flat shapes with
 * net-space UVs, and the standard materials (glass, metal, paper, plastic, ceramic, fabric).
 */
import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial, ShapeUtils, Vector2,
  type Side,
} from 'three';
import type { P2 } from '../products/types';
import type { SurfaceTexture } from './types';

/** UV of a surface point (pt) inside a surface texture's box (y down → v up). */
export function surfaceUV(box: SurfaceTexture['box'], sx: number, sy: number): [number, number] {
  return [(sx - box.x) / box.w, 1 - (sy - box.y) / box.h];
}

/** The bleed box of a dieline surface (what its texture covers). */
export const bleedBox = (s: { w: number; h: number; bleed: number }) => ({ x: -s.bleed, y: -s.bleed, w: s.w + 2 * s.bleed, h: s.h + 2 * s.bleed });

/**
 * Revolve a profile of [y, r] points (bottom → top) about the y axis between phi0 and phi1
 * (phi = 0 faces +z / the camera, increasing toward +x). `uv(f, j)` gets the angular fraction
 * f ∈ [0, 1] and the profile index.
 */
export function revolve(profile: [number, number][], segments: number, uv?: (f: number, j: number, y: number, r: number) => [number, number], phi0 = -Math.PI, phi1 = Math.PI, inward = false): BufferGeometry {
  const rows = profile.length, cols = segments + 1;
  const pos = new Float32Array(rows * cols * 3), nrm = new Float32Array(rows * cols * 3), uvs = new Float32Array(rows * cols * 2);
  // Profile normals in the (r, y) plane.
  const pn: [number, number][] = profile.map((_, j) => {
    const a = profile[Math.max(0, j - 1)], b = profile[Math.min(rows - 1, j + 1)];
    let dy = b[0] - a[0], dr = b[1] - a[1];
    const l = Math.hypot(dy, dr) || 1;
    dy /= l; dr /= l;
    return inward ? [-dy, dr] : [dy, -dr];
  });
  let k = 0;
  for (let j = 0; j < rows; j++) {
    const [y, r] = profile[j];
    for (let i = 0; i < cols; i++) {
      const f = i / segments;
      const phi = phi0 + (phi1 - phi0) * f;
      const s = Math.sin(phi), c = Math.cos(phi);
      pos[3 * k] = r * s; pos[3 * k + 1] = y; pos[3 * k + 2] = r * c;
      nrm[3 * k] = pn[j][0] * s; nrm[3 * k + 1] = pn[j][1]; nrm[3 * k + 2] = pn[j][0] * c;
      const t = uv ? uv(f, j, y, r) : [f, j / (rows - 1)];
      uvs[2 * k] = t[0]; uvs[2 * k + 1] = t[1];
      k++;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < segments; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols + 1, d = a + cols;
    if (inward) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** Sample a radius function between two heights into a profile. */
export function profileBetween(r: (y: number) => number, y0: number, y1: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let j = 0; j <= n; j++) { const y = y0 + ((y1 - y0) * j) / n; out.push([y, r(y)]); }
  return out;
}

/** Flat polygon (net / shape coordinates, y down) → geometry in the XY plane (y up), UVs from `uv`. */
export function flatShape(poly: P2[], uv: (p: P2) => [number, number], z = 0, flip = false): BufferGeometry {
  const contour = poly.map((p) => new Vector2(p.x, -p.y));
  if (ShapeUtils.isClockWise(contour)) contour.reverse();
  const tris = ShapeUtils.triangulateShape(contour, []);
  const pos = new Float32Array(contour.length * 3), nrm = new Float32Array(contour.length * 3), uvs = new Float32Array(contour.length * 2);
  contour.forEach((v, i) => {
    pos[3 * i] = v.x; pos[3 * i + 1] = v.y; pos[3 * i + 2] = z;
    nrm[3 * i + 2] = flip ? -1 : 1;
    const t = uv({ x: v.x, y: -v.y });
    uvs[2 * i] = t[0]; uvs[2 * i + 1] = t[1];
  });
  const idx: number[] = [];
  for (const t of tris) if (flip) idx.push(t[0], t[2], t[1]); else idx.push(t[0], t[1], t[2]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** A grid in the XY plane (w × h, origin top-left in "surface" space → y up in 3D) for displacement. */
export function grid(w: number, h: number, nx: number, ny: number, f: (u: number, v: number) => { x: number; y: number; z: number; uv: [number, number] }): BufferGeometry {
  const cols = nx + 1, rows = ny + 1;
  const pos = new Float32Array(cols * rows * 3), uvs = new Float32Array(cols * rows * 2);
  let k = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const p = f(i / nx, j / ny);
    pos[3 * k] = p.x; pos[3 * k + 1] = p.y; pos[3 * k + 2] = p.z;
    uvs[2 * k] = p.uv[0]; uvs[2 * k + 1] = p.uv[1];
    k++;
  }
  const idx: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols + 1, d = a + cols;
    idx.push(a, d, c, a, c, b);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  void w; void h;
  return g;
}

/* -------------------------------------------------------------------------- */
/* Materials                                                                   */
/* -------------------------------------------------------------------------- */

export type GlassKind = 'flint' | 'amber' | 'green' | 'blue' | 'frosted' | 'black' | 'blush' | 'smoke';

const GLASS: Record<GlassKind, { tint: string; dist: number; rough: number; transmission: number }> = {
  flint: { tint: '#f4fbf8', dist: 900, rough: 0.02, transmission: 1 },
  amber: { tint: '#b4621c', dist: 60, rough: 0.03, transmission: 1 },
  green: { tint: '#3d6a2d', dist: 55, rough: 0.03, transmission: 1 },
  blue: { tint: '#2850a8', dist: 60, rough: 0.03, transmission: 1 },
  frosted: { tint: '#eef4f2', dist: 600, rough: 0.42, transmission: 1 },
  black: { tint: '#2a2622', dist: 8, rough: 0.05, transmission: 0.9 },
  blush: { tint: '#f2c7c4', dist: 160, rough: 0.02, transmission: 1 },
  smoke: { tint: '#6f6c68', dist: 90, rough: 0.02, transmission: 1 },
};

/**
 * Physically based glass (transmission, IOR 1.5, Beer–Lambert tint). Thickness is given in the
 * model's own units (three.js scales it by the object's world scale); attenuation distances are
 * in world units, so `scale` (world units per pt) converts them.
 */
export function glassMaterial(kind: GlassKind, wall: number, scale: number, side: Side = DoubleSide): MeshPhysicalMaterial {
  const g = GLASS[kind] ?? GLASS.flint;
  return new MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: g.rough, transmission: g.transmission, ior: 1.5, thickness: wall,
    attenuationColor: new Color(g.tint), attenuationDistance: g.dist * scale, specularIntensity: 1, envMapIntensity: 1.15,
    clearcoat: kind === 'frosted' ? 0 : 0.6, clearcoatRoughness: 0.03, side,
  });
}

/** Glass filled with a liquid: the liquid's colour as attenuation over the liquid's depth. */
export function liquidGlassMaterial(kind: GlassKind, liquid: string, depth: number, scale: number, darkness = 1): MeshPhysicalMaterial {
  const m = glassMaterial(kind, depth, scale);
  const base = GLASS[kind] ?? GLASS.flint;
  const c = new Color(liquid);
  if (base.dist < 200) c.multiply(new Color(base.tint).lerp(new Color('#ffffff'), 0.35));
  m.attenuationColor = c;
  m.attenuationDistance = (depth * scale) * 0.55 / Math.max(0.2, darkness);
  m.thickness = depth;
  m.roughness = Math.min(m.roughness, 0.06);
  return m;
}

export const metalMaterial = (color: string, roughness = 0.28, metalness = 1) => new MeshStandardMaterial({ color: new Color(color), metalness, roughness });

export const plasticMaterial = (color: string, roughness = 0.45) => new MeshPhysicalMaterial({ color: new Color(color), metalness: 0, roughness, clearcoat: roughness < 0.3 ? 0.6 : 0, clearcoatRoughness: 0.2 });

export const paperMaterial = (color: string, roughness = 0.85, side: Side = DoubleSide) => new MeshStandardMaterial({ color: new Color(color), roughness, metalness: 0, side });

/** A printable surface material (maps come from a composite). */
export function printMaterial(opts: { sheen?: number; sheenColor?: string; side?: Side; bumpScale?: number } = {}): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: 0xffffff, roughness: 1, metalness: 1, sheen: opts.sheen ?? 0, sheenRoughness: 0.6, sheenColor: new Color(opts.sheenColor ?? '#ffffff'),
    clearcoat: 0, clearcoatRoughness: 0.08, bumpScale: opts.bumpScale ?? 1.6, iridescenceIOR: 1.65, iridescenceThicknessRange: [180, 650], side: opts.side ?? DoubleSide,
  });
}

export const CAP_COLORS: Record<string, { color: string; metal: number; rough: number }> = {
  gold: { color: '#d8b25a', metal: 1, rough: 0.18 },
  silver: { color: '#d6d9dd', metal: 1, rough: 0.16 },
  black: { color: '#121214', metal: 0, rough: 0.2 },
  white: { color: '#f2f0ec', metal: 0, rough: 0.28 },
  wood: { color: '#9a6b42', metal: 0, rough: 0.7 },
  glass: { color: '#ffffff', metal: 0, rough: 0.02 },
};
