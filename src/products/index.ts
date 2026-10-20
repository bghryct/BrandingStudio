/**
 * Product template registry and derived dieline geometry (bleed outlines, cut segments,
 * panel anchors). Dielines are memoised on the product's options object, which immer keeps
 * identical until an option changes.
 */
import type { Product, OptionValue, SurfaceKey } from '../model/types';
import type { Dieline, DielineSurface, P2, ProductTemplate, TemplateCategory } from './types';
import { offsetPoly, polyArea, polyToPath } from './geom';
import { CAN_TEMPLATE } from './cans';
import { BOTTLE_TEMPLATE } from './bottles';
import { PERFUME_TEMPLATE } from './perfume';
import { TUCK_TEMPLATE, STRAIGHT_TUCK_TEMPLATE, MAILER_TEMPLATE, PILLOW_TEMPLATE, SLEEVE_TEMPLATE } from './cartons';
import { TUBE_TEMPLATE, POUCH_TEMPLATE, JAR_TEMPLATE } from './packaging';
import { TOTE_TEMPLATE, TEE_TEMPLATE, HOODIE_TEMPLATE, CAP_TEMPLATE } from './apparel';
import { CUP_TEMPLATE, MUG_TEMPLATE } from './drinkware';
import { CARD_TEMPLATE, LETTERHEAD_TEMPLATE } from './stationery';

export * from './types';

export const TEMPLATES: ProductTemplate[] = [
  CAN_TEMPLATE, BOTTLE_TEMPLATE, PERFUME_TEMPLATE,
  TUCK_TEMPLATE, STRAIGHT_TUCK_TEMPLATE, MAILER_TEMPLATE, PILLOW_TEMPLATE, SLEEVE_TEMPLATE,
  TUBE_TEMPLATE, POUCH_TEMPLATE, JAR_TEMPLATE,
  TOTE_TEMPLATE, TEE_TEMPLATE, HOODIE_TEMPLATE, CAP_TEMPLATE,
  CUP_TEMPLATE, MUG_TEMPLATE,
  CARD_TEMPLATE, LETTERHEAD_TEMPLATE,
];

export const CATEGORIES: TemplateCategory[] = ['Cans', 'Bottles', 'Perfume', 'Boxes', 'Packaging', 'Bags', 'Apparel', 'Drinkware', 'Stationery'];

export const getTemplate = (id: string): ProductTemplate => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

export function templateDefaults(t: ProductTemplate): Record<string, OptionValue> {
  return Object.fromEntries(t.options.map((o) => [o.key, o.default]));
}

/* -------------------------------------------------------------------------- */
/* Dieline cache                                                               */
/* -------------------------------------------------------------------------- */

const cache = new WeakMap<object, { template: string; dieline: Dieline }>();

export function optionsOf(product: Product): Record<string, OptionValue> {
  return { ...templateDefaults(getTemplate(product.template)), ...product.options };
}

export function dielineOf(product: Product): Dieline {
  const hit = cache.get(product.options);
  if (hit && hit.template === product.template) return hit.dieline;
  let dieline: Dieline;
  try {
    dieline = getTemplate(product.template).dieline(optionsOf(product));
  } catch (e) {
    console.error('Dieline failed', e);
    dieline = { surfaces: [], specs: [] };
  }
  cache.set(product.options, { template: product.template, dieline });
  return dieline;
}

export function surfaceOf(product: Product, surfaceId: string): DielineSurface | undefined {
  return dielineOf(product).surfaces.find((s) => s.id === surfaceId);
}

export const surfaceKey = (productId: string, surfaceId: string): SurfaceKey => `${productId}/${surfaceId}`;
export function parseSurfaceKey(key: SurfaceKey): { productId: string; surfaceId: string } {
  const i = key.indexOf('/');
  return { productId: key.slice(0, i), surfaceId: key.slice(i + 1) };
}

/* -------------------------------------------------------------------------- */
/* Derived geometry                                                            */
/* -------------------------------------------------------------------------- */

const derived = new WeakMap<DielineSurface, { bleed: P2[][]; cutD: string; bleedD: string; pieceD: string; holesD: string }>();

function derive(s: DielineSurface) {
  let d = derived.get(s);
  if (d) return d;
  // One winding direction for every piece, so overlapping outlines unite under the non-zero rule.
  const orient = (p: P2[]) => (polyArea(p) < 0 ? [...p].reverse() : p);
  const bleed = (s.cutKind === 'none' || s.bleed <= 0 ? s.cut : s.cut.map((p) => offsetPoly(p, s.bleed))).map(orient);
  const segs = cutSegments(s);
  const cutD = segs.map(([a, b]) => `M${r(a.x)} ${r(a.y)}L${r(b.x)} ${r(b.y)}`).join('') + (s.holes ?? []).map((h) => polyToPath(h)).join('');
  d = { bleed, cutD, bleedD: bleed.map((p) => polyToPath(p)).join(''), pieceD: s.cut.map((p) => polyToPath(orient(p))).join(''), holesD: (s.holes ?? []).map((h) => polyToPath(h)).join('') };
  derived.set(s, d);
  return d;
}

const r = (n: number) => +n.toFixed(3);

/** Bleed outline(s): each piece offset by the bleed (union = printable area). */
export const bleedPolys = (s: DielineSurface) => derive(s).bleed;
/** SVG path data: the art clip (bleed union), the cut contour, the material pieces, the holes. */
export const bleedPath = (s: DielineSurface) => derive(s).bleedD;
export const cutPath = (s: DielineSurface) => derive(s).cutD;
export const piecePath = (s: DielineSurface) => derive(s).pieceD;
export const holesPath = (s: DielineSurface) => derive(s).holesD;

/**
 * Cut contour as segments: every edge of every piece, minus the parts that lie on a fold line
 * (hinges are creased, not cut), with duplicates removed.
 */
export function cutSegments(s: DielineSurface): [P2, P2][] {
  const out: [P2, P2][] = [];
  const folds = s.folds.filter((f) => f.pts.length === 2).map((f) => [f.pts[0], f.pts[1]] as [P2, P2]);
  for (const poly of s.cut) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.05) continue;
      let intervals: [number, number][] = [[0, 1]];
      for (const [f0, f1] of folds) {
        if (!collinear(a, b, f0) || !collinear(a, b, f1)) continue;
        const t0 = param(a, b, f0), t1 = param(a, b, f1);
        intervals = subtract(intervals, Math.min(t0, t1), Math.max(t0, t1));
      }
      for (const [t0, t1] of intervals) {
        if ((t1 - t0) * len < 0.2) continue;
        const p = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
        const q = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
        if (!out.some(([u, v]) => (near(u, p) && near(v, q)) || (near(u, q) && near(v, p)))) out.push([p, q]);
      }
    }
  }
  return out;
}

const near = (p: P2, q: P2) => Math.abs(p.x - q.x) < 0.05 && Math.abs(p.y - q.y) < 0.05;

function collinear(a: P2, b: P2, p: P2): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len < 0.05;
}

function param(a: P2, b: P2, p: P2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1);
}

function subtract(iv: [number, number][], s: number, e: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of iv) {
    if (e <= a || s >= b) { out.push([a, b]); continue; }
    if (s > a) out.push([a, s]);
    if (e < b) out.push([e, b]);
  }
  return out;
}

/** Origin of a panel (anchoring); 0,0 when the panel is unknown. */
export function panelOrigin(s: DielineSurface | undefined, panelId: string | null | undefined): P2 {
  if (!s || !panelId) return { x: 0, y: 0 };
  const p = s.panels.find((q) => q.id === panelId);
  return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
}

/** The panel whose bounds contain a point (faces before zones). */
export function panelAt(s: DielineSurface, x: number, y: number): string | null {
  const inside = s.panels.filter((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h);
  if (!inside.length) return null;
  inside.sort((a, b) => a.w * a.h - b.w * b.h);
  return inside[0].id;
}
