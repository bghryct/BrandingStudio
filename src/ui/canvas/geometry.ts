import type { Element, Product, Project } from '../../model/types';
import type { DielineSurface } from '../../products/types';
import { applyMatrix, invert, multiply, translate, type Matrix } from '../../render/primitives';
import { elementMatrix, anchorOffsetOf } from '../../render/compile';
import { guidesOf } from '../../model/surfaces';
import { dielineOf, surfaceKey } from '../../products';
import { parsePath, pathBounds } from '../../lib/pathData';

/** A product surface placed in the editor's scene (pt). */
export interface SurfaceDesc {
  key: string;
  id: string;
  s: DielineSurface;
  /** Offset of the surface's origin (top-left of the cut box) in scene coordinates. */
  x: number;
  y: number;
  /** Scene rectangle the surface occupies, bleed and context included. */
  bounds: { x: number; y: number; w: number; h: number };
  label: string;
}

export interface Pt { x: number; y: number }

const ctxBounds = new WeakMap<DielineSurface, { x: number; y: number; w: number; h: number }>();

/** Local bounds of a surface: cut box + bleed + the context drawing around a print area. */
export function localBounds(s: DielineSurface) {
  let b = ctxBounds.get(s);
  if (b) return b;
  let x0 = -s.bleed, y0 = -s.bleed, x1 = s.w + s.bleed, y1 = s.h + s.bleed;
  if (s.context) {
    const pb = pathBounds(parsePath(s.context.d));
    x0 = Math.min(x0, pb.x); y0 = Math.min(y0, pb.y); x1 = Math.max(x1, pb.x + pb.w); y1 = Math.max(y1, pb.y + pb.h);
  }
  b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  ctxBounds.set(s, b);
  return b;
}

/** Lay a product's surfaces out in a row (or only one of them). */
export function layoutSurfaces(product: Product | null, only: string | null): SurfaceDesc[] {
  if (!product) return [];
  const out: SurfaceDesc[] = [];
  const surfaces = dielineOf(product).surfaces.filter((s) => !only || s.id === only);
  const maxH = Math.max(1, ...surfaces.map((s) => localBounds(s).h));
  const gap = Math.max(48, maxH * 0.12);
  let x = 0;
  for (const s of surfaces) {
    const lb = localBounds(s);
    const ox = x - lb.x, oy = (maxH - lb.h) / 2 - lb.y;
    out.push({ key: surfaceKey(product.id, s.id), id: s.id, s, x: ox, y: oy, bounds: { x, y: (maxH - lb.h) / 2, w: lb.w, h: lb.h }, label: s.label });
    x += lb.w + gap;
  }
  return out;
}

/** Matrix from element-local coordinates to scene coordinates. */
export function sceneMatrix(el: Element, sd: SurfaceDesc): Matrix {
  const o = anchorOffsetOf(el, sd.s);
  return multiply(translate(sd.x + o.x, sd.y + o.y), elementMatrix(el));
}

export function toLocal(el: Element, sd: SurfaceDesc, p: Pt): Pt {
  const [x, y] = applyMatrix(invert(sceneMatrix(el, sd)), p.x, p.y);
  return { x, y };
}

export function corners(el: Element, sd: SurfaceDesc): Pt[] {
  const m = sceneMatrix(el, sd);
  return ([[0, 0], [el.w, 0], [el.w, el.h], [0, el.h]] as const).map(([x, y]) => {
    const [a, b] = applyMatrix(m, x, y);
    return { x: a, y: b };
  });
}

export function sceneBounds(el: Element, sd: SurfaceDesc) {
  const cs = corners(el, sd);
  const xs = cs.map((c) => c.x), ys = cs.map((c) => c.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function hitElement(el: Element, sd: SurfaceDesc, p: Pt, tolerance: number): boolean {
  const l = toLocal(el, sd, p);
  const t = el.type === 'rule' || el.h < tolerance * 2 || el.w < tolerance * 2 ? tolerance : 0;
  return l.x >= -t && l.y >= -t && l.x <= el.w + t && l.y <= el.h + t;
}

export function surfaceAt(surfaces: SurfaceDesc[], p: Pt, pad = 0): SurfaceDesc | null {
  for (const s of surfaces) {
    const b = s.bounds;
    if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) return s;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Snapping                                                                    */
/* -------------------------------------------------------------------------- */

export interface SnapLines { x: number[]; y: number[] }

/** Snap targets in scene coordinates: surface edges and centre, panels, safe lines, folds, guides, other items. */
export function snapTargets(project: Project, sd: SurfaceDesc, others: { el: Element; surface: SurfaceDesc }[], exclude: Set<string>): SnapLines {
  const xs: number[] = [0, sd.s.w, sd.s.w / 2], ys: number[] = [0, sd.s.h, sd.s.h / 2];
  for (const p of sd.s.panels) {
    xs.push(p.x, p.x + p.w, p.x + p.w / 2);
    ys.push(p.y, p.y + p.h, p.y + p.h / 2);
    if (p.safe > 0) { xs.push(p.x + p.safe, p.x + p.w - p.safe); ys.push(p.y + p.safe, p.y + p.h - p.safe); }
  }
  for (const f of sd.s.folds) {
    if (f.pts.length !== 2) continue;
    const [a, b] = f.pts;
    if (Math.abs(a.x - b.x) < 0.01) xs.push(a.x);
    if (Math.abs(a.y - b.y) < 0.01) ys.push(a.y);
  }
  if (!project.guidesHidden) {
    const g = guidesOf(project, sd.key);
    xs.push(...g.x);
    ys.push(...g.y);
  }
  for (const o of others) {
    if (exclude.has(o.el.id) || o.el.hidden) continue;
    const b = sceneBounds(o.el, o.surface);
    xs.push(b.x - sd.x, b.x + b.w / 2 - sd.x, b.x + b.w - sd.x);
    ys.push(b.y - sd.y, b.y + b.h / 2 - sd.y, b.y + b.h - sd.y);
  }
  return { x: xs.map((v) => v + sd.x), y: ys.map((v) => v + sd.y) };
}

export function snapAxis(candidates: number[], lines: number[], threshold: number): { delta: number; line: number | null } {
  let best = { delta: 0, line: null as number | null, dist: threshold + 1 };
  for (const c of candidates) {
    for (const l of lines) {
      const d = Math.abs(l - c);
      if (d < best.dist) best = { delta: l - c, line: l, dist: d };
    }
  }
  return best.dist <= threshold ? { delta: best.delta, line: best.line } : { delta: 0, line: null };
}
