/**
 * Geometry helpers for dielines: polygons, rounded corners, bleed offsets, dimension lines and
 * the unwrap of cylinders and cone frustums (cups, bottle necks) into flat print shapes.
 */
import type { Dimension, DielinePanel, FoldLine, P2, Zone } from './types';
import { mm } from '../model/units';

export { mm };

export const rectPoly = (x: number, y: number, w: number, h: number): P2[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

export const translatePoly = (poly: P2[], dx: number, dy: number): P2[] => poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));

/** Points of a circular arc from angle a0 to a1 (radians, y-down screen space). */
export function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 16): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** Rectangle with independently rounded corners [tl, tr, br, bl]. */
export function roundedRectPoly(x: number, y: number, w: number, h: number, r: number | [number, number, number, number], n = 8): P2[] {
  const rr = (Array.isArray(r) ? r : [r, r, r, r]).map((v) => Math.max(0, Math.min(v, w / 2, h / 2)));
  const out: P2[] = [];
  const corner = (cx: number, cy: number, rad: number, a0: number) => { out.push(...arcPts(cx, cy, rad, a0, a0 + Math.PI / 2, n)); };
  // Corner centres; sharp corners collapse to the corner point.
  if (rr[0] > 0.01) corner(x + rr[0], y + rr[0], rr[0], Math.PI); else out.push({ x, y });
  if (rr[1] > 0.01) corner(x + w - rr[1], y + rr[1], rr[1], -Math.PI / 2); else out.push({ x: x + w, y });
  if (rr[2] > 0.01) corner(x + w - rr[2], y + h - rr[2], rr[2], 0); else out.push({ x: x + w, y: y + h });
  if (rr[3] > 0.01) corner(x + rr[3], y + h - rr[3], rr[3], Math.PI / 2); else out.push({ x, y: y + h });
  return out;
}

export function ellipsePoly(cx: number, cy: number, rx: number, ry: number, n = 96): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

export function polyArea(poly: P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function polyBounds(polys: P2[][]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polys) for (const p of poly) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Remove consecutive duplicates and collinear points. */
export function cleanPoly(poly: P2[]): P2[] {
  const out: P2[] = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 0.01) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 0.01) out.pop();
  return out;
}

/**
 * Outward offset of a simple polygon by `d` (miter joins, bevelled beyond 3·d) — the bleed line
 * of a die shape. Orientation-independent.
 */
export function offsetPoly(poly: P2[], d: number): P2[] {
  const pts = cleanPoly(poly);
  const n = pts.length;
  if (n < 3 || d === 0) return pts;
  const sign = polyArea(pts) > 0 ? 1 : -1; // y-down: positive area = clockwise on screen
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const e1 = norm(p1.x - p0.x, p1.y - p0.y), e2 = norm(p2.x - p1.x, p2.y - p1.y);
    // Outward normals (screen y-down, clockwise polygon → normal = (dy, -dx)).
    const n1 = { x: e1.y * sign, y: -e1.x * sign }, n2 = { x: e2.y * sign, y: -e2.x * sign };
    const bis = norm(n1.x + n2.x, n1.y + n2.y);
    const cos = bis.x * n2.x + bis.y * n2.y;
    if (cos < 0.34 || !Number.isFinite(cos)) {
      // Very sharp corner: bevel.
      out.push({ x: p1.x + n1.x * d, y: p1.y + n1.y * d }, { x: p1.x + n2.x * d, y: p1.y + n2.y * d });
    } else {
      const k = d / cos;
      out.push({ x: p1.x + bis.x * k, y: p1.y + bis.y * k });
    }
  }
  return out;
}

function norm(x: number, y: number) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

export function polyToPath(poly: P2[], close = true): string {
  if (!poly.length) return '';
  let d = `M${f(poly[0].x)} ${f(poly[0].y)}`;
  for (let i = 1; i < poly.length; i++) d += `L${f(poly[i].x)} ${f(poly[i].y)}`;
  return close ? d + 'Z' : d;
}

export const polysToPath = (polys: P2[][]) => polys.map((p) => polyToPath(p)).join('');

const f = (n: number) => (Math.abs(n) < 1e-9 ? '0' : String(+n.toFixed(3)));

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

export const fold = (x1: number, y1: number, x2: number, y2: number, kind: FoldLine['kind'] = 'fold'): FoldLine => ({ pts: [{ x: x1, y: y1 }, { x: x2, y: y2 }], kind });

export const dim = (x1: number, y1: number, x2: number, y2: number, offset: number, label?: string): Dimension => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, offset, label });

export function panel(id: string, label: string, x: number, y: number, w: number, h: number, role: DielinePanel['role'], safe = mm(3), extra: Partial<DielinePanel> = {}): DielinePanel {
  return { id, label, x, y, w, h, role, safe, ...extra };
}

export const zone = (kind: Zone['kind'], label: string, poly: P2[]): Zone => ({ kind, label, poly });

/* -------------------------------------------------------------------------- */
/* Wraps: cylinders and cone frustums                                           */
/* -------------------------------------------------------------------------- */

/**
 * Flat development of a printed band around a cylinder or a cone frustum.
 *  - rBottom / rTop: radii at the bottom and top edges of the band
 *  - height: vertical height of the band
 *  - overlap: extra print length past the seam (pt, along the widest edge)
 *  - coverage: fraction of the circumference the band covers (labels may cover less)
 * Flat space: y down; the band's top edge is at the top of the sheet. The seam sits at the
 * left edge; the overlap extends past the right edge.
 */
export interface Wrap {
  kind: 'cylinder' | 'cone';
  rBottom: number;
  rTop: number;
  height: number;
  slant: number;
  overlap: number;
  coverage: number;
  /** Bounding box of the flat shape. */
  w: number;
  h: number;
  /** Cone only: apex position in flat space, radii of the edges and the sweep (radians). */
  apex?: P2;
  rFlatTop?: number;
  rFlatBottom?: number;
  sweep?: number;
  /** Cone only: the sweep of the printed band without the overlap. */
  sweepPrint?: number;
  /** +1 when the apex lies below the sheet (cup, widening upward), −1 when above (bottle neck). */
  apexSide?: 1 | -1;
}

export function makeWrap(rBottom: number, rTop: number, height: number, overlap = 0, coverage = 1): Wrap {
  const slant = Math.hypot(height, rTop - rBottom);
  if (Math.abs(rTop - rBottom) < 0.2) {
    const r = (rTop + rBottom) / 2;
    const len = 2 * Math.PI * r * coverage;
    return { kind: 'cylinder', rBottom: r, rTop: r, height, slant: height, overlap, coverage, w: len + overlap, h: height };
  }
  const widening = rTop > rBottom; // cup
  const rMin = Math.min(rTop, rBottom), rMax = Math.max(rTop, rBottom);
  const Rs = (slant * rMin) / (rMax - rMin);
  const Rb = Rs + slant;
  const sweepPrint = ((2 * Math.PI * rMax) / Rb) * coverage;
  const sweep = sweepPrint + overlap / Rb;
  const half = sweep / 2;
  // Flat radii of the top and bottom edges.
  const rFlatTop = widening ? Rb : Rs;
  const rFlatBottom = widening ? Rs : Rb;
  // Bounds relative to an apex at (0,0): apex below (widening) → points at y = -R cos(a).
  const pts: P2[] = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const a = -half + (sweep * i) / N;
    for (const R of [Rs, Rb]) pts.push(widening ? { x: R * Math.sin(a), y: -R * Math.cos(a) } : { x: R * Math.sin(a), y: R * Math.cos(a) });
  }
  if (half > Math.PI / 2) for (const R of [Rb]) pts.push({ x: -R, y: 0 }, { x: R, y: 0 });
  const b = polyBounds([pts]);
  const apex = { x: -b.x, y: -b.y };
  return { kind: 'cone', rBottom, rTop, height, slant, overlap, coverage, w: b.w, h: b.h, apex, rFlatTop, rFlatBottom, sweep, sweepPrint, apexSide: widening ? 1 : -1 };
}

/**
 * Flat position of a point on the band: `t` 0 = bottom edge … 1 = top edge; `u` 0 … 1 around the
 * printed part of the band (u > 1 runs into the overlap).
 */
export function wrapToFlat(w: Wrap, t: number, u: number): P2 {
  if (w.kind === 'cylinder') {
    const len = w.w - w.overlap;
    return { x: u * len, y: (1 - t) * w.h };
  }
  const R = w.rFlatBottom! + (w.rFlatTop! - w.rFlatBottom!) * t;
  const a = -w.sweep! / 2 + w.sweepPrint! * u;
  const s = w.apexSide!;
  return { x: w.apex!.x + R * Math.sin(a), y: w.apex!.y - s * R * Math.cos(a) };
}

/** Outline of the flat band (closed polygon), including the overlap. */
export function wrapOutline(w: Wrap, n = 64): P2[] {
  if (w.kind === 'cylinder') return rectPoly(0, 0, w.w, w.h);
  const out: P2[] = [];
  const uMax = 1 + (w.sweep! - w.sweepPrint!) / w.sweepPrint!;
  for (let i = 0; i <= n; i++) out.push(wrapToFlat(w, 1, (uMax * i) / n));
  for (let i = n; i >= 0; i--) out.push(wrapToFlat(w, 0, (uMax * i) / n));
  return out;
}

/** The overlap strip at the end of the band. */
export function wrapOverlap(w: Wrap, n = 12): P2[] {
  if (w.overlap <= 0) return [];
  if (w.kind === 'cylinder') return rectPoly(w.w - w.overlap, 0, w.overlap, w.h);
  const uMax = 1 + (w.sweep! - w.sweepPrint!) / w.sweepPrint!;
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) out.push(wrapToFlat(w, 1, 1 + ((uMax - 1) * i) / n));
  for (let i = n; i >= 0; i--) out.push(wrapToFlat(w, 0, 1 + ((uMax - 1) * i) / n));
  return out;
}

/** A band of the wrap between heights t0 and t1 (distortion zones, seams). */
export function wrapBand(w: Wrap, t0: number, t1: number, n = 48): P2[] {
  const uMax = w.kind === 'cylinder' ? w.w / (w.w - w.overlap || 1) : 1 + (w.sweep! - w.sweepPrint!) / w.sweepPrint!;
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) out.push(wrapToFlat(w, t1, (uMax * i) / n));
  for (let i = n; i >= 0; i--) out.push(wrapToFlat(w, t0, (uMax * i) / n));
  return out;
}

/** Circumference helpers. */
export const circ = (diameter: number) => Math.PI * diameter;

export const fmtMm = (pt: number, d = 1) => `${(+(pt / mm(1)).toFixed(d)).toString()} mm`;
