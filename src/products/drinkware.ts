/**
 * Drinkware: a paper coffee cup, whose wrap is a conical frustum that develops into an arc
 * (annular sector), and a ceramic mug with a sublimation wrap that stops short of the handle.
 */
import type { Dieline, Opts, ProductTemplate } from './types';
import { num, str } from './types';
import { dim, fmtMm, makeWrap, mm, panel, rectPoly, wrapBand, wrapOutline, wrapOverlap, wrapToFlat, zone } from './geom';

export const CUP_SIZES = [
  { value: '8oz', label: '8 oz (240 ml)', top: 80, bottom: 56, h: 92 },
  { value: '12oz', label: '12 oz (350 ml)', top: 90, bottom: 60, h: 112 },
  { value: '16oz', label: '16 oz (470 ml)', top: 90, bottom: 60, h: 136 },
];

export function cupGeometry(o: Opts) {
  const s = CUP_SIZES.find((x) => x.value === str(o, 'size')) ?? CUP_SIZES[1];
  const H = mm(s.h), rTop = mm(s.top / 2), rBottom = mm(s.bottom / 2);
  const rim = mm(3.2), foot = mm(6);
  const rAt = (y: number) => rBottom + ((rTop - rBottom) * y) / H;
  // Printed band from the foot to just under the rolled rim.
  const y0 = foot, y1 = H - rim;
  const wrap = makeWrap(rAt(y0), rAt(y1), y1 - y0, mm(8));
  return { size: s, H, rTop, rBottom, rim, foot, rAt, y0, y1, wrap };
}

function cup(o: Opts): Dieline {
  const g = cupGeometry(o);
  const w = g.wrap;
  const paper = str(o, 'paper', 'white');
  const substrate = paper === 'kraft' ? '#b38858' : paper === 'black' ? '#1d1c1e' : '#fbfaf7';
  // Front zone: the middle half of the band.
  const mid = wrapToFlat(w, 0.5, 0.5);
  return {
    surfaces: [{
      id: 'wrap', label: 'Cup wrap', w: w.w, h: w.h, bleed: mm(2), cut: [wrapOutline(w)], cutKind: 'die', folds: [],
      panels: [panel('front', 'Front (seam at the back)', mid.x - w.w * 0.22, 0, w.w * 0.44, w.h, 'face', mm(4))],
      zones: [zone('seam', 'Side seam overlap', wrapOverlap(w)), zone('distortion', 'Rim curl', wrapBand(w, 0.94, 1))],
      dims: [dim(0, 0, w.w, 0, -mm(8), `${fmtMm(w.w)} flat`), dim(0, 0, 0, w.h, -mm(8), fmtMm(w.h))],
      substrate, defaultGround: paper === 'white' ? '#ffffff' : null,
      notes: [`A cone frustum (Ø${fmtMm(2 * g.rAt(g.y0))} → Ø${fmtMm(2 * g.rAt(g.y1))}) unrolls into an arc; text set straight on the arc will curve on the cup.`],
    }],
    specs: [{ label: 'Cup', value: g.size.label }, { label: 'Top / bottom Ø', value: `${fmtMm(2 * g.rTop)} / ${fmtMm(2 * g.rBottom)}` }, { label: 'Height', value: fmtMm(g.H) }],
  };
}

export const CUP_TEMPLATE: ProductTemplate = {
  id: 'cup',
  name: 'Coffee cup',
  category: 'Drinkware',
  description: 'Single-wall paper cup with an arc-shaped (conical) wrap and a lid.',
  options: [
    { key: 'size', label: 'Size', group: 'Size', kind: 'select', default: '12oz', choices: CUP_SIZES.map((s) => ({ value: s.value, label: s.label })) },
    { key: 'paper', label: 'Cup board', group: 'Material', kind: 'select', default: 'white', choices: [{ value: 'white', label: 'White' }, { value: 'kraft', label: 'Kraft' }, { value: 'black', label: 'Black' }] },
    { key: 'lid', label: 'Lid', group: 'Closure', kind: 'select', default: 'white', choices: [{ value: 'white', label: 'White' }, { value: 'black', label: 'Black' }, { value: 'none', label: 'No lid' }] },
    { key: 'sleeve', label: 'Kraft sleeve', group: 'Closure', kind: 'toggle', default: false },
  ],
  dieline: cup,
  animations: ['turntable', 'hero', 'float', 'reveal'],
};

export const MUG_SIZES = [
  { value: '11oz', label: '11 oz (325 ml)', d: 82, h: 95, pw: 200, ph: 85 },
  { value: '15oz', label: '15 oz (440 ml)', d: 87, h: 113, pw: 216, ph: 100 },
];

export function mugGeometry(o: Opts) {
  const s = MUG_SIZES.find((x) => x.value === str(o, 'size')) ?? MUG_SIZES[0];
  return { size: s, D: mm(s.d), H: mm(s.h), pw: mm(s.pw), ph: mm(s.ph), C: Math.PI * mm(s.d) };
}

function mug(o: Opts): Dieline {
  const g = mugGeometry(o);
  return {
    surfaces: [{
      id: 'wrap', label: 'Mug wrap', w: g.pw, h: g.ph, bleed: mm(2), cut: [rectPoly(0, 0, g.pw, g.ph)], cutKind: 'none', folds: [],
      panels: [
        panel('left', 'Left half', 0, 0, g.pw / 2, g.ph, 'face', mm(5)),
        panel('right', 'Right half · faces out, handle right', g.pw / 2, 0, g.pw / 2, g.ph, 'face', mm(5)),
      ],
      zones: [], dims: [dim(0, 0, g.pw, 0, -mm(7), fmtMm(g.pw)), dim(0, 0, 0, g.ph, -mm(7), fmtMm(g.ph))],
      substrate: '#ffffff', defaultGround: null,
      notes: [`The print wraps ${Math.round((g.pw / g.C) * 360)}° and stops ${fmtMm((g.C - g.pw) / 2)} either side of the handle.`],
    }],
    specs: [{ label: 'Mug', value: g.size.label }, { label: 'Ø × H', value: `${fmtMm(g.D)} × ${fmtMm(g.H)}` }, { label: 'Print area', value: `${fmtMm(g.pw)} × ${fmtMm(g.ph)}` }],
  };
}

export const MUG_TEMPLATE: ProductTemplate = {
  id: 'mug',
  name: 'Mug',
  category: 'Drinkware',
  description: 'Ceramic mug with a sublimation wrap; glossy glaze, coloured inside.',
  options: [
    { key: 'size', label: 'Size', group: 'Size', kind: 'select', default: '11oz', choices: MUG_SIZES.map((s) => ({ value: s.value, label: s.label })) },
    { key: 'glaze', label: 'Body colour', group: 'Material', kind: 'color', default: '#f7f6f2' },
    { key: 'inside', label: 'Inside & handle', group: 'Material', kind: 'color', default: '#f7f6f2' },
    { key: 'finish', label: 'Glaze', group: 'Material', kind: 'select', default: 'gloss', choices: [{ value: 'gloss', label: 'Gloss' }, { value: 'matte', label: 'Matte' }] },
  ],
  dieline: mug,
  animations: ['turntable', 'hero', 'float', 'reveal'],
};
