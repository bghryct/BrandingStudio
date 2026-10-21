/**
 * Glass bottles: wine (Bordeaux, Burgundy), longneck beer, retro soda, flat-shoulder spirits and
 * an apothecary bottle. Each has a revolved glass profile (shared with the 3D builder), front
 * and back body labels on the cylindrical part and an optional neck label, which on a tapering
 * neck develops into an annular sector (a conical band).
 */
import type { Dieline, DielineSurface, Opts, P2, ProductTemplate } from './types';
import { bool, num, str } from './types';
import { dim, ellipsePoly, fmtMm, makeWrap, mm, panel, rectPoly, roundedRectPoly, wrapOutline, wrapOverlap, zone } from './geom';

export type BottleShape = 'bordeaux' | 'burgundy' | 'longneck' | 'soda' | 'spirits' | 'apothecary';

export interface BottleDef {
  id: BottleShape;
  label: string;
  ml: number;
  /** Outer profile [height, radius] in mm, from the base up to the lip. */
  profile: [number, number][];
  /** Cylindrical body zone usable for body labels, mm. */
  body: [number, number];
  /** Default neck-label band (heights, mm). */
  neck: [number, number];
  closure: 'capsule' | 'crown' | 'cork' | 'screw';
  /** Length of the capsule / stopper over the top, mm. */
  closureLen: number;
  front: { w: number; h: number; y: number };
  back: { w: number; h: number; y: number };
}

const heel = (R: number): [number, number][] => [[0, R - 5], [0.6, R - 2.2], [2.5, R - 0.6], [6, R]];

export const BOTTLES: BottleDef[] = [
  {
    id: 'bordeaux', label: 'Wine · Bordeaux 750 ml', ml: 750,
    profile: [...heel(38), [200, 38], [208, 37.4], [216, 35], [223, 30.5], [230, 24.5], [237, 19.2], [244, 16.4], [252, 15.4], [286, 14.8], [288.5, 15.6], [297, 15.6], [299, 15], [300, 13.5]],
    body: [10, 196], neck: [236, 251], closure: 'capsule', closureLen: 52,
    front: { w: 92, h: 106, y: 46 }, back: { w: 78, h: 86, y: 52 },
  },
  {
    id: 'burgundy', label: 'Wine · Burgundy 750 ml', ml: 750,
    profile: [...heel(40), [118, 40], [135, 39.6], [152, 37.5], [170, 33.5], [188, 28], [204, 22.6], [218, 18.6], [232, 16.2], [244, 15.4], [282, 15], [284.5, 15.8], [293, 15.8], [295, 15.1], [296, 13.6]],
    body: [10, 116], neck: [222, 240], closure: 'capsule', closureLen: 55,
    front: { w: 98, h: 90, y: 20 }, back: { w: 80, h: 76, y: 26 },
  },
  {
    id: 'longneck', label: 'Beer · Longneck 330 ml', ml: 330,
    profile: [...heel(30.5), [112, 30.5], [124, 29.6], [136, 26.4], [148, 21.6], [160, 16.8], [172, 14], [184, 13.2], [224, 12.7], [226, 13.6], [230, 14], [233.5, 13.6], [236, 12]],
    body: [8, 110], neck: [163, 182], closure: 'crown', closureLen: 8,
    front: { w: 84, h: 80, y: 20 }, back: { w: 70, h: 64, y: 26 },
  },
  {
    id: 'soda', label: 'Soda · Retro 355 ml', ml: 355,
    profile: [...heel(30), [108, 30], [120, 29.2], [132, 26], [143, 21.2], [153, 16.6], [162, 14.1], [172, 13.4], [195, 13], [197, 13.8], [201, 14.1], [203.5, 13.7], [205, 12.2]],
    body: [8, 104], neck: [150, 166], closure: 'crown', closureLen: 8,
    front: { w: 80, h: 72, y: 22 }, back: { w: 66, h: 56, y: 30 },
  },
  {
    id: 'spirits', label: 'Spirits · Flat shoulder 700 ml', ml: 700,
    profile: [[0, 37], [0.8, 41], [3, 42.6], [8, 43], [204, 43], [208.5, 42.4], [212, 40.4], [214.5, 36], [216.5, 28], [218.5, 21], [221, 17.4], [226, 16.4], [254, 16], [255.5, 17], [261, 17], [262, 16]],
    body: [12, 202], neck: [224, 244], closure: 'cork', closureLen: 30,
    front: { w: 104, h: 120, y: 54 }, back: { w: 88, h: 96, y: 60 },
  },
  {
    id: 'apothecary', label: 'Apothecary 250 ml', ml: 250,
    profile: [[0, 28], [0.6, 31], [2.5, 32.6], [6, 33], [98, 33], [104, 32.4], [109, 30.4], [113, 26.6], [116.5, 21], [119.5, 16], [122, 14], [137, 13.4], [138.5, 14.4], [143, 14.4], [144, 13.6]],
    body: [6, 96], neck: [123, 136], closure: 'cork', closureLen: 22,
    front: { w: 84, h: 62, y: 18 }, back: { w: 70, h: 50, y: 24 },
  },
];

export const bottleDef = (o: Opts) => BOTTLES.find((b) => b.id === str(o, 'shape')) ?? BOTTLES[0];

/**
 * Smooth the profile, returning [y, r] in pt: a monotone cubic (Fritsch–Carlson) of the radius
 * over the height. Heights only ever increase, so the glass never folds back on itself (a
 * Catmull-Rom through the points as 2D control points overshot in height at the heel and the
 * shoulder: rings of doubled glass, and a heel 3–9 mm below the floor), and the radius never
 * overshoots the control points; straight runs stay straight.
 */
export function sampleProfile(pts: [number, number][], per = 6): [number, number][] {
  const n = pts.length;
  if (n < 2) return pts.map(([y, r]) => [mm(y), mm(r)]);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / Math.max(1e-6, pts[i + 1][0] - pts[i][0]));
  const m: number[] = pts.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) if (Math.abs(d[i]) < 1e-9) { m[i] = 0; m[i + 1] = 0; }
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-9) continue;
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < n - 1; i++) {
    const [y0, r0] = pts[i], [y1, r1] = pts[i + 1];
    const h = y1 - y0;
    const seg = Math.max(1, Math.round(per * Math.min(4, Math.hypot(h, r1 - r0) / 8)));
    for (let k = 0; k < seg; k++) {
      const t = k / seg, t2 = t * t, t3 = t2 * t;
      const r = (2 * t3 - 3 * t2 + 1) * r0 + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * r1 + (t3 - t2) * h * m[i + 1];
      out.push([mm(y0 + h * t), mm(Math.max(0, r))]);
    }
  }
  out.push([mm(pts[n - 1][0]), mm(pts[n - 1][1])]);
  return out;
}

/** Radius of the smoothed profile at height y (pt). */
export function radiusAt(profile: [number, number][], y: number): number {
  for (let i = 0; i < profile.length - 1; i++) {
    const [y0, r0] = profile[i], [y1, r1] = profile[i + 1];
    if (y >= y0 && y <= y1) return y1 - y0 < 1e-6 ? Math.max(r0, r1) : r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return profile[profile.length - 1][1];
}

export interface BottleLabelGeom {
  /** Label size (flat) and the height of its bottom edge above the base, pt. */
  w: number; h: number; y: number;
  /** Radius of the body where the label sits. */
  r: number;
  /** Angular centre (radians, 0 = front). */
  angle: number;
}

export function bottleLabels(o: Opts) {
  const def = bottleDef(o);
  const prof = sampleProfile(def.profile);
  const R = mm(def.profile.find((p) => p[0] >= def.body[0])?.[1] ?? 30);
  const maxW = Math.PI * R * 2 * 0.46;
  const clampH = (y: number, h: number) => {
    const y0 = Math.max(mm(def.body[0]), y), y1 = Math.min(mm(def.body[1]), y0 + h);
    return { y: y0, h: Math.max(mm(10), y1 - y0) };
  };
  const fw = Math.min(maxW, num(o, 'frontW', mm(def.front.w)));
  const fv = clampH(num(o, 'frontY', mm(def.front.y)), num(o, 'frontH', mm(def.front.h)));
  const bw = Math.min(maxW, num(o, 'backW', mm(def.back.w)));
  const bv = clampH(num(o, 'backY', mm(def.back.y)), num(o, 'backH', mm(def.back.h)));
  const front: BottleLabelGeom = { w: fw, h: fv.h, y: fv.y, r: R, angle: 0 };
  const back: BottleLabelGeom = { w: bw, h: bv.h, y: bv.y, r: R, angle: Math.PI };
  const ny0 = mm(def.neck[0]), ny1 = mm(def.neck[1]);
  const neck = { y0: ny0, y1: ny1, rBottom: radiusAt(prof, ny0), rTop: radiusAt(prof, ny1) };
  return { def, prof, R, front, back, neck, maxW };
}

type LabelShape = 'rect' | 'rounded' | 'oval' | 'arch' | 'shield';

export function labelOutline(shape: LabelShape, w: number, h: number): P2[] {
  switch (shape) {
    case 'rounded': return roundedRectPoly(0, 0, w, h, Math.min(w, h) * 0.08);
    case 'oval': return ellipsePoly(w / 2, h / 2, w / 2, h / 2);
    case 'arch': {
      const top = Math.min(w / 2, h * 0.5);
      const pts: P2[] = [{ x: 0, y: h }];
      for (let i = 0; i <= 40; i++) {
        const a = Math.PI + (Math.PI * i) / 40;
        pts.push({ x: w / 2 + (w / 2) * Math.cos(a), y: top + top * Math.sin(a) });
      }
      pts.push({ x: w, y: h });
      return pts;
    }
    case 'shield': {
      const c = h * 0.24;
      const pts: P2[] = [{ x: 0, y: 0 }, { x: w, y: 0 }];
      for (let i = 0; i <= 32; i++) {
        const a = (Math.PI * i) / 32;
        pts.push({ x: w / 2 + (w / 2) * Math.cos(a), y: h - c + c * Math.sin(a) });
      }
      return pts;
    }
    default: return rectPoly(0, 0, w, h);
  }
}

function labelSurface(id: string, label: string, w: number, h: number, shape: LabelShape, substrate: string, ground: string | null, note: string): DielineSurface {
  const cut = labelOutline(shape, w, h);
  return {
    id, label, w, h, bleed: mm(2), cut: [cut], cutKind: shape === 'rect' ? 'rect' : 'die', folds: [],
    panels: [panel('label', label, 0, 0, w, h, 'face', mm(3))],
    zones: [], dims: [dim(0, 0, w, 0, -mm(7), fmtMm(w)), dim(0, 0, 0, h, -mm(7), fmtMm(h))],
    substrate, defaultGround: ground, notes: [note],
  };
}

export const LABEL_STOCKS: { value: string; label: string; color: string; ground: string | null }[] = [
  { value: 'white', label: 'White paper', color: '#f6f4ef', ground: null },
  { value: 'cream', label: 'Cream textured', color: '#eee4cc', ground: null },
  { value: 'kraft', label: 'Kraft', color: '#b48a5a', ground: null },
  { value: 'black', label: 'Black paper', color: '#1d1c1c', ground: null },
  { value: 'metallic', label: 'Metallised silver', color: '#c9cdd2', ground: null },
  { value: 'clear', label: 'Clear film (no-label look)', color: '#00000000', ground: null },
];

export const labelStock = (o: Opts) => LABEL_STOCKS.find((s) => s.value === str(o, 'stock')) ?? LABEL_STOCKS[0];

function dieline(o: Opts): Dieline {
  const L = bottleLabels(o);
  const stock = labelStock(o);
  const shape = str(o, 'labelShape', 'rect') as LabelShape;
  const surfaces: DielineSurface[] = [
    labelSurface('front', 'Front label', L.front.w, L.front.h, shape, stock.color, stock.ground, `Wraps ${Math.round((L.front.w / (2 * Math.PI * L.R)) * 360)}° of the ${fmtMm(2 * L.R)} body.`),
  ];
  if (bool(o, 'backLabel', true)) surfaces.push(labelSurface('back', 'Back label', L.back.w, L.back.h, 'rect', stock.color, stock.ground, 'Back label: ingredients, legal copy and the barcode.'));
  if (bool(o, 'neckLabel', true)) {
    const n = L.neck;
    const wrap = makeWrap(n.rBottom, n.rTop, n.y1 - n.y0, mm(5));
    const outline = wrapOutline(wrap);
    surfaces.push({
      id: 'neck', label: 'Neck label', w: wrap.w, h: wrap.h, bleed: mm(1.5), cut: [outline], cutKind: wrap.kind === 'cylinder' ? 'rect' : 'die', folds: [],
      panels: [panel('band', 'Neck band', 0, 0, wrap.w - wrap.overlap, wrap.h, 'band', mm(1.5))],
      zones: wrap.overlap > 0 ? [zone('seam', 'Overlap (glued under)', wrapOverlap(wrap))] : [],
      dims: [dim(0, wrap.h, wrap.w, wrap.h, mm(7), `${fmtMm(wrap.w)} flat`), dim(0, 0, 0, wrap.h, -mm(6), fmtMm(n.y1 - n.y0))],
      substrate: stock.color, defaultGround: stock.ground,
      notes: [wrap.kind === 'cone' ? `The neck tapers from Ø${fmtMm(2 * n.rBottom)} to Ø${fmtMm(2 * n.rTop)}, so the band develops into an arc.` : 'Cylindrical neck band.'],
    });
  }
  return {
    surfaces,
    specs: [
      { label: 'Bottle', value: L.def.label },
      { label: 'Body Ø', value: fmtMm(2 * L.R) },
      { label: 'Height', value: fmtMm(mm(L.def.profile[L.def.profile.length - 1][0])) },
      { label: 'Label zone', value: `${fmtMm(mm(L.def.body[0]))} – ${fmtMm(mm(L.def.body[1]))} from base` },
    ],
  };
}

export const BOTTLE_TEMPLATE: ProductTemplate = {
  id: 'bottle',
  name: 'Glass bottle',
  category: 'Bottles',
  description: 'Wine, beer, soda, spirits and apothecary bottles with front, back and neck labels, a capsule or closure, tinted glass and liquid.',
  options: [
    { key: 'shape', label: 'Bottle', group: 'Size', kind: 'select', default: 'bordeaux', choices: BOTTLES.map((b) => ({ value: b.id, label: b.label })) },
    { key: 'frontW', label: 'Front label width', group: 'Size', kind: 'length', default: mm(92), min: mm(20), max: mm(140) },
    { key: 'frontH', label: 'Front label height', group: 'Size', kind: 'length', default: mm(106), min: mm(15), max: mm(200) },
    { key: 'frontY', label: 'Front label from base', group: 'Size', kind: 'length', default: mm(46), min: 0, max: mm(200) },
    { key: 'labelShape', label: 'Front label shape', group: 'Size', kind: 'select', default: 'rect', choices: [{ value: 'rect', label: 'Rectangle' }, { value: 'rounded', label: 'Rounded' }, { value: 'oval', label: 'Oval' }, { value: 'arch', label: 'Arch' }, { value: 'shield', label: 'Shield' }] },
    { key: 'backLabel', label: 'Back label', group: 'Size', kind: 'toggle', default: true },
    { key: 'backW', label: 'Back label width', group: 'Size', kind: 'length', default: mm(78), min: mm(20), max: mm(140), when: (o) => o.backLabel !== false },
    { key: 'backH', label: 'Back label height', group: 'Size', kind: 'length', default: mm(86), min: mm(15), max: mm(200), when: (o) => o.backLabel !== false },
    { key: 'neckLabel', label: 'Neck label', group: 'Size', kind: 'toggle', default: true },
    { key: 'stock', label: 'Label stock', group: 'Material', kind: 'select', default: 'white', choices: LABEL_STOCKS.map((s) => ({ value: s.value, label: s.label })) },
    { key: 'glass', label: 'Glass', group: 'Material', kind: 'select', default: 'green', choices: [{ value: 'flint', label: 'Flint (clear)' }, { value: 'amber', label: 'Amber' }, { value: 'green', label: 'Antique green' }, { value: 'blue', label: 'Cobalt blue' }, { value: 'frosted', label: 'Frosted' }, { value: 'black', label: 'Black glass' }] },
    { key: 'liquid', label: 'Liquid inside', group: 'Contents', kind: 'toggle', default: true },
    { key: 'liquidColor', label: 'Liquid colour', group: 'Contents', kind: 'color', default: '#5b0f1c', when: (o) => o.liquid !== false },
    { key: 'fill', label: 'Fill level', group: 'Contents', kind: 'slider', default: 0.82, min: 0.05, max: 0.97, step: 0.01, when: (o) => o.liquid !== false, format: (v) => `${Math.round(v * 100)}%` },
    { key: 'closure', label: 'Closure', group: 'Closure', kind: 'select', default: 'auto', choices: [{ value: 'auto', label: 'Typical for the bottle' }, { value: 'capsule', label: 'Foil capsule' }, { value: 'crown', label: 'Crown cap' }, { value: 'screw', label: 'Screw cap' }, { value: 'cork', label: 'Cork stopper' }] },
    { key: 'closureColor', label: 'Capsule / cap colour', group: 'Closure', kind: 'color', default: '#2b2b2e' },
    { key: 'closureFinish', label: 'Capsule finish', group: 'Closure', kind: 'select', default: 'metallic', choices: [{ value: 'metallic', label: 'Metallic foil' }, { value: 'matte', label: 'Matte' }, { value: 'gloss', label: 'Gloss' }] },
  ],
  dieline,
  adjust: (key, o): Record<string, string | number | boolean> => {
    if (key !== 'shape') return {};
    const d = bottleDef(o);
    const liquid: Record<string, string> = { bordeaux: '#4a0d18', burgundy: '#5e1420', longneck: '#c9851c', soda: '#3b1d0e', spirits: '#d8a24a', apothecary: '#7a4a1e' };
    const glass: Record<string, string> = { bordeaux: 'green', burgundy: 'green', longneck: 'amber', soda: 'flint', spirits: 'flint', apothecary: 'amber' };
    return { frontW: mm(d.front.w), frontH: mm(d.front.h), frontY: mm(d.front.y), backW: mm(d.back.w), backH: mm(d.back.h), backY: mm(d.back.y), liquidColor: liquid[d.id], glass: glass[d.id], closure: 'auto' };
  },
  animations: ['turntable', 'hero', 'float', 'reveal'],
};

/** Effective closure for a bottle. */
export const bottleClosure = (o: Opts) => (str(o, 'closure', 'auto') === 'auto' ? bottleDef(o).closure : (str(o, 'closure') as BottleDef['closure']));
