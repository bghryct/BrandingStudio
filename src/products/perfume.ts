/**
 * Perfume flacons: a rectangular bottle, a round (cylindrical, pillow-edged) bottle and a faceted
 * octagonal bottle, with an atomizer collar and cap. Decoration is a paper label, a screen print
 * directly on the glass, or an acid-etched (frosted) mark.
 */
import type { Dieline, DielineSurface, Opts, ProductTemplate } from './types';
import { bool, num, str } from './types';
import { dim, fmtMm, mm, panel, polyToPath, rectPoly, roundedRectPoly } from './geom';

export type FlaconShape = 'rect' | 'round' | 'faceted';

export interface FlaconGeom {
  shape: FlaconShape;
  /** Body width (x), depth (z) and height (y) — pt. */
  W: number; D: number; H: number;
  /** Edge rounding of the body. */
  round: number;
  /** Visible face width for decoration (flat faces) or circumference share (round). */
  faceW: number;
  collarD: number; collarH: number;
  decoW: number; decoH: number; decoY: number;
}

const BASE: Record<FlaconShape, { W: number; D: number; H: number; round: number }> = {
  rect: { W: 60, D: 34, H: 82, round: 5 },
  round: { W: 66, D: 66, H: 74, round: 9 },
  faceted: { W: 64, D: 64, H: 84, round: 2 },
};

export function flaconGeometry(o: Opts): FlaconGeom {
  const shape = (str(o, 'shape', 'rect') as FlaconShape);
  const b = BASE[shape] ?? BASE.rect;
  const W = num(o, 'width', mm(b.W)), H = num(o, 'height', mm(b.H));
  const D = shape === 'rect' ? num(o, 'depth', mm(b.D)) : W;
  const round = mm(b.round);
  // Flat front face width: rectangle minus the rounded edges; octagon side = W·tan(22.5°).
  const faceW = shape === 'rect' ? W - 2 * round : shape === 'faceted' ? W * Math.tan(Math.PI / 8) : Math.PI * W * 0.5;
  const decoW = Math.min(num(o, 'decoW', mm(38)), faceW * (shape === 'faceted' ? 0.98 : 0.94));
  const decoH = Math.min(num(o, 'decoH', mm(30)), H - 2 * round - mm(4));
  const decoY = Math.max(round + mm(2), Math.min(num(o, 'decoY', mm(22)), H - round - mm(2) - decoH));
  return { shape, W, D, H, round, faceW, collarD: mm(17), collarH: mm(7), decoW, decoH, decoY };
}

function decoSurface(id: string, label: string, g: FlaconGeom, kind: string, ground: string | null, substrate: string): DielineSurface {
  const { decoW: w, decoH: h } = g;
  const isLabel = kind === 'label';
  // The bottle face around the decoration, drawn as context in the editor.
  const left = -(g.faceW - w) / 2, top = -(g.H - g.decoY - h);
  const face = g.shape === 'faceted'
    ? `${polyToPath(rectPoly(left, top, g.faceW, g.H))}`
    : polyToPath(roundedRectPoly(left, top, g.faceW, g.H, g.shape === 'rect' ? 0 : g.round));
  return {
    id, label, w, h, bleed: isLabel ? mm(1.5) : 0,
    cut: [isLabel ? roundedRectPoly(0, 0, w, h, num({}, 'r', 0)) : rectPoly(0, 0, w, h)],
    cutKind: isLabel ? 'rect' : 'none', folds: [],
    panels: [panel('deco', label, 0, 0, w, h, 'face', isLabel ? mm(2) : 0)],
    zones: [],
    dims: [dim(0, 0, w, 0, -mm(6), fmtMm(w)), dim(0, 0, 0, h, -mm(6), fmtMm(h))],
    substrate, defaultGround: ground,
    context: { d: face, fill: 'rgba(200,215,225,0.16)', stroke: 'rgba(160,190,210,0.7)', label: 'Bottle face' },
    notes: [isLabel ? 'Paper label on the flat front face.' : kind === 'screen' ? 'Screen print straight onto the glass: the ground is clear glass; use White base for opaque colours.' : 'Acid-etched decoration: artwork becomes a frosted mark in the glass (colour is ignored, tone sets the frost).'],
  };
}

function dieline(o: Opts): Dieline {
  const g = flaconGeometry(o);
  const kind = str(o, 'deco', 'label');
  const substrate = kind === 'label' ? '#f5f1e8' : '#00000000';
  const ground = kind === 'label' ? null : null;
  const surfaces = [decoSurface('front', kind === 'label' ? 'Front label' : 'Front decoration', g, kind, ground, substrate)];
  if (bool(o, 'backDeco', false)) surfaces.push(decoSurface('back', kind === 'label' ? 'Back label' : 'Back decoration', g, kind, ground, substrate));
  return {
    surfaces,
    specs: [
      { label: 'Flacon', value: `${fmtMm(g.W)} × ${fmtMm(g.D)} × ${fmtMm(g.H)}` },
      { label: 'Capacity (approx.)', value: `${Math.round((g.shape === 'round' ? Math.PI * (g.W / 2) ** 2 * g.H : g.W * g.D * g.H) / (mm(10) ** 3) * 0.55)} ml` },
      { label: 'Decoration', value: `${fmtMm(g.decoW)} × ${fmtMm(g.decoH)}` },
    ],
  };
}

export const PERFUME_TEMPLATE: ProductTemplate = {
  id: 'perfume',
  name: 'Perfume bottle',
  category: 'Perfume',
  description: 'Rectangular, round or faceted flacon with atomizer and cap; label, screen print or etched decoration.',
  options: [
    { key: 'shape', label: 'Flacon', group: 'Size', kind: 'select', default: 'rect', choices: [{ value: 'rect', label: 'Rectangular' }, { value: 'round', label: 'Round' }, { value: 'faceted', label: 'Faceted octagon' }] },
    { key: 'width', label: 'Width', group: 'Size', kind: 'length', default: mm(60), min: mm(30), max: mm(110) },
    { key: 'depth', label: 'Depth', group: 'Size', kind: 'length', default: mm(34), min: mm(15), max: mm(80), when: (o) => o.shape === 'rect' || o.shape == null },
    { key: 'height', label: 'Height', group: 'Size', kind: 'length', default: mm(82), min: mm(40), max: mm(160) },
    { key: 'deco', label: 'Decoration', group: 'Print', kind: 'select', default: 'label', choices: [{ value: 'label', label: 'Paper label' }, { value: 'screen', label: 'Screen print on glass' }, { value: 'etched', label: 'Acid-etched (frosted)' }] },
    { key: 'decoW', label: 'Decoration width', group: 'Print', kind: 'length', default: mm(38), min: mm(10), max: mm(100) },
    { key: 'decoH', label: 'Decoration height', group: 'Print', kind: 'length', default: mm(30), min: mm(8), max: mm(140) },
    { key: 'decoY', label: 'Decoration from base', group: 'Print', kind: 'length', default: mm(22), min: 0, max: mm(140) },
    { key: 'backDeco', label: 'Back decoration', group: 'Print', kind: 'toggle', default: false },
    { key: 'glass', label: 'Glass', group: 'Material', kind: 'select', default: 'flint', choices: [{ value: 'flint', label: 'Clear' }, { value: 'blush', label: 'Blush pink' }, { value: 'smoke', label: 'Smoke grey' }, { value: 'amber', label: 'Amber' }, { value: 'frosted', label: 'Frosted' }] },
    { key: 'liquidColor', label: 'Fragrance colour', group: 'Contents', kind: 'color', default: '#f2c98a' },
    { key: 'fill', label: 'Fill level', group: 'Contents', kind: 'slider', default: 0.8, min: 0.05, max: 0.95, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
    { key: 'cap', label: 'Cap', group: 'Closure', kind: 'select', default: 'cube', choices: [{ value: 'cube', label: 'Cube' }, { value: 'cylinder', label: 'Cylinder' }, { value: 'sphere', label: 'Sphere' }, { value: 'tall', label: 'Tall column' }, { value: 'faceted', label: 'Faceted gem' }] },
    { key: 'capMaterial', label: 'Cap material', group: 'Closure', kind: 'select', default: 'gold', choices: [{ value: 'gold', label: 'Polished gold' }, { value: 'silver', label: 'Polished silver' }, { value: 'black', label: 'Black lacquer' }, { value: 'white', label: 'White ceramic' }, { value: 'wood', label: 'Wood' }, { value: 'glass', label: 'Glass' }, { value: 'color', label: 'Colour lacquer' }] },
    { key: 'capColor', label: 'Cap colour', group: 'Closure', kind: 'color', default: '#8e2c48', when: (o) => o.capMaterial === 'color' },
  ],
  dieline,
  animations: ['turntable', 'hero', 'float', 'reveal'],
};
