/**
 * Other packaging: a telescoping paper tube (body wrap, lid wrap and top disc), a stand-up pouch
 * (front and back webs with seals, zipper, tear notch and bottom gusset) and a jar label.
 */
import type { Dieline, DielineSurface, Opts, ProductTemplate } from './types';
import { bool, num, str } from './types';
import { dim, ellipsePoly, fmtMm, fold, mm, panel, rectPoly, roundedRectPoly, zone } from './geom';

/* -------------------------------------------------------------------------- */
/* Paper tube                                                                   */
/* -------------------------------------------------------------------------- */

export function tubeGeometry(o: Opts) {
  const D = num(o, 'diameter', mm(76)), Hb = num(o, 'bodyH', mm(140)), Hl = num(o, 'lidH', mm(42));
  const wall = mm(1.6);
  const roll = mm(12);
  return { D, Hb, Hl, wall, roll, Dl: D + 2 * wall + mm(0.4), overlap: mm(10) };
}

function tube(o: Opts): Dieline {
  const g = tubeGeometry(o);
  const material = str(o, 'material', 'kraft');
  const substrate = material === 'kraft' ? '#b48a5b' : material === 'black' ? '#1f1e20' : '#f7f5f0';
  const ground = material === 'white' ? '#ffffff' : null;
  const wrap = (id: string, label: string, circumference: number, h: number, top: number, bottom: number, note: string): DielineSurface => {
    const w = circumference + g.overlap;
    const H = h + top + bottom;
    return {
      id, label, w, h: H, bleed: mm(2), cut: [rectPoly(0, 0, w, H)], cutKind: 'rect',
      folds: [...(top ? [fold(0, top, w, top)] : []), ...(bottom ? [fold(0, H - bottom, w, H - bottom)] : [])],
      panels: [
        panel('front', 'Front (facing)', circumference * 0.25, top, circumference * 0.5, h, 'face', mm(3)),
        panel('back-l', 'Back · left', 0, top, circumference * 0.25, h, 'zone', mm(2)),
        panel('back-r', 'Back · right', circumference * 0.75, top, circumference * 0.25, h, 'zone', mm(2)),
      ],
      zones: [
        ...(top ? [zone('nonprint', 'Roll-in (turns inside)', rectPoly(0, 0, w, top))] : []),
        ...(bottom ? [zone('nonprint', 'Roll-in (turns inside)', rectPoly(0, H - bottom, w, bottom))] : []),
        zone('seam', 'Overlap (glued)', rectPoly(circumference, 0, g.overlap, H)),
      ],
      dims: [dim(0, H, circumference, H, mm(8), `Circumference ${fmtMm(circumference)}`), dim(w, top, w, top + h, mm(8), fmtMm(h))],
      substrate, defaultGround: ground, notes: [note],
    };
  };
  const surfaces: DielineSurface[] = [
    wrap('body', 'Tube body', Math.PI * g.D, g.Hb, g.roll, g.roll, 'The roll-ins turn over the top and bottom edges of the body tube.'),
    wrap('lid', 'Lid wrap', Math.PI * g.Dl, g.Hl, 0, g.roll, 'Lid wrap; the top disc label covers the lid end.'),
  ];
  if (bool(o, 'topLabel', true)) {
    const d = g.Dl - mm(2);
    surfaces.push({
      id: 'top', label: 'Lid top disc', w: d, h: d, bleed: mm(2), cut: [ellipsePoly(d / 2, d / 2, d / 2, d / 2)], cutKind: 'die', folds: [],
      panels: [panel('disc', 'Top disc', 0, 0, d, d, 'face', mm(4))], zones: [], dims: [dim(0, d, d, d, mm(7), `Ø ${fmtMm(d)}`)],
      substrate, defaultGround: ground,
    });
  }
  return {
    surfaces,
    specs: [
      { label: 'Tube Ø', value: fmtMm(g.D) },
      { label: 'Body + lid', value: `${fmtMm(g.Hb)} + ${fmtMm(g.Hl)}` },
      { label: 'Volume (approx.)', value: `${Math.round((Math.PI * (g.D / 2) ** 2 * (g.Hb + g.Hl * 0.6)) / (mm(10) ** 3))} ml` },
    ],
  };
}

export const TUBE_TEMPLATE: ProductTemplate = {
  id: 'tube',
  name: 'Paper tube',
  category: 'Packaging',
  description: 'Telescoping cardboard tube with a body wrap, a lid wrap and a top disc label.',
  options: [
    { key: 'diameter', label: 'Diameter', group: 'Size', kind: 'length', default: mm(76), min: mm(25), max: mm(200) },
    { key: 'bodyH', label: 'Body height', group: 'Size', kind: 'length', default: mm(140), min: mm(30), max: mm(500) },
    { key: 'lidH', label: 'Lid height', group: 'Size', kind: 'length', default: mm(42), min: mm(10), max: mm(200) },
    { key: 'topLabel', label: 'Top disc label', group: 'Size', kind: 'toggle', default: true },
    { key: 'material', label: 'Paper', group: 'Material', kind: 'select', default: 'kraft', choices: [{ value: 'kraft', label: 'Kraft' }, { value: 'white', label: 'White' }, { value: 'black', label: 'Black' }] },
    { key: 'finish', label: 'Coating', group: 'Material', kind: 'select', default: 'matte', choices: [{ value: 'matte', label: 'Matte' }, { value: 'gloss', label: 'Gloss' }, { value: 'soft-touch', label: 'Soft-touch' }, { value: 'uncoated', label: 'Uncoated' }] },
  ],
  dieline: tube,
  animations: ['turntable', 'hero', 'open', 'float'],
};

/* -------------------------------------------------------------------------- */
/* Stand-up pouch                                                               */
/* -------------------------------------------------------------------------- */

export function pouchGeometry(o: Opts) {
  const W = num(o, 'width', mm(140)), H = num(o, 'height', mm(210)), G = num(o, 'gusset', mm(40));
  return { W, H, G, side: mm(5), top: mm(10), zip: bool(o, 'zipper', true), zipY: mm(26), notchY: mm(16) };
}

export const POUCH_FILMS = [
  { value: 'matte', label: 'Matte white film', color: '#f4f3ef' },
  { value: 'gloss', label: 'Gloss white film', color: '#f8f8f6' },
  { value: 'kraft', label: 'Kraft paper laminate', color: '#b38758' },
  { value: 'metallised', label: 'Metallised film', color: '#c9ccd1' },
  { value: 'black', label: 'Matte black film', color: '#1c1b1d' },
];

function pouch(o: Opts): Dieline {
  const g = pouchGeometry(o);
  const film = POUCH_FILMS.find((f) => f.value === str(o, 'film')) ?? POUCH_FILMS[0];
  const ground = film.value === 'matte' || film.value === 'gloss' ? '#ffffff' : null;
  const web = (id: string, label: string): DielineSurface => {
    const { W, H, G, side, top } = g;
    const zones = [
      zone('seal', 'Top seal', rectPoly(0, 0, W, top)),
      zone('seal', 'Side seal', rectPoly(0, top, side, H - top)),
      zone('seal', 'Side seal', rectPoly(W - side, top, side, H - top)),
      zone('distortion', 'Bottom gusset (folds under)', rectPoly(side, H - G, W - 2 * side, G)),
    ];
    const folds = [fold(0, H - G, W, H - G, 'reverse')];
    if (g.zip) folds.push(fold(side, g.zipY, W - side, g.zipY, 'perf'));
    const notch = [{ x: 0, y: g.notchY - mm(2.5) }, { x: mm(3.5), y: g.notchY }, { x: 0, y: g.notchY + mm(2.5) }];
    return {
      id, label, w: W, h: H, bleed: mm(3),
      cut: [roundedRectPoly(0, 0, W, H, [mm(3), mm(3), mm(3), mm(3)])], holes: bool(o, 'notch', true) ? [notch, notch.map((p) => ({ x: W - p.x, y: p.y }))] : [],
      cutKind: 'die', folds,
      panels: [panel('panel', label, 0, 0, W, H, 'face', mm(8))],
      zones, dims: [dim(0, H, W, H, mm(8), `W ${fmtMm(W)}`), dim(W, 0, W, H, mm(8), `H ${fmtMm(H)}`), dim(W, H - G, W, H, mm(20), `Gusset ${fmtMm(G)}`)],
      substrate: film.color, defaultGround: ground,
      notes: ['Seals, the zipper track and the tear notch stay clear of critical copy; the bottom of the panel folds into the gusset.'],
    };
  };
  return {
    surfaces: [web('front', 'Front'), web('back', 'Back')],
    specs: [{ label: 'Pouch W × H', value: `${fmtMm(g.W)} × ${fmtMm(g.H)}` }, { label: 'Bottom gusset', value: fmtMm(g.G) }, { label: 'Film', value: film.label }],
  };
}

export const POUCH_TEMPLATE: ProductTemplate = {
  id: 'pouch',
  name: 'Stand-up pouch',
  category: 'Packaging',
  description: 'Doypack with bottom gusset, side and top seals, zipper and tear notches.',
  options: [
    { key: 'width', label: 'Width', group: 'Size', kind: 'length', default: mm(140), min: mm(60), max: mm(400) },
    { key: 'height', label: 'Height', group: 'Size', kind: 'length', default: mm(210), min: mm(80), max: mm(500) },
    { key: 'gusset', label: 'Bottom gusset', group: 'Size', kind: 'length', default: mm(40), min: mm(15), max: mm(150) },
    { key: 'zipper', label: 'Zipper', group: 'Construction', kind: 'toggle', default: true },
    { key: 'notch', label: 'Tear notches', group: 'Construction', kind: 'toggle', default: true },
    { key: 'film', label: 'Film', group: 'Material', kind: 'select', default: 'matte', choices: POUCH_FILMS.map((f) => ({ value: f.value, label: f.label })) },
  ],
  dieline: pouch,
  animations: ['turntable', 'hero', 'float', 'reveal'],
};

/* -------------------------------------------------------------------------- */
/* Jar                                                                          */
/* -------------------------------------------------------------------------- */

export function jarGeometry(o: Opts) {
  const D = num(o, 'diameter', mm(72)), H = num(o, 'height', mm(88));
  const lidH = mm(16), lidD = D * 0.94;
  const shoulder = mm(10);
  const C = Math.PI * D;
  const lw = Math.min(num(o, 'labelW', C * 0.62), C - mm(4));
  const lh = Math.min(num(o, 'labelH', mm(50)), H - shoulder - mm(8));
  const ly = Math.max(mm(4), Math.min(num(o, 'labelY', mm(14)), H - shoulder - lh - mm(2)));
  return { D, H, lidH, lidD, shoulder, C, lw, lh, ly };
}

function jar(o: Opts): Dieline {
  const g = jarGeometry(o);
  const stock = str(o, 'stock', 'white');
  const substrate = stock === 'kraft' ? '#b48a5a' : stock === 'clear' ? '#00000000' : '#f6f4ef';
  const surfaces: DielineSurface[] = [{
    id: 'label', label: 'Jar label', w: g.lw, h: g.lh, bleed: mm(2), cut: [rectPoly(0, 0, g.lw, g.lh)], cutKind: 'rect', folds: [],
    panels: [
      panel('front', 'Front', g.lw / 2 - Math.min(g.lw, g.C * 0.5) / 2, 0, Math.min(g.lw, g.C * 0.5), g.lh, 'face', mm(3)),
    ],
    zones: [], dims: [dim(0, g.lh, g.lw, g.lh, mm(7), fmtMm(g.lw)), dim(g.lw, 0, g.lw, g.lh, mm(7), fmtMm(g.lh))],
    substrate, defaultGround: null, notes: [`Wraps ${Math.round((g.lw / g.C) * 360)}° of the ${fmtMm(g.D)} jar.`],
  }];
  if (bool(o, 'lidLabel', true)) {
    const d = g.lidD - mm(6);
    surfaces.push({
      id: 'lid', label: 'Lid top', w: d, h: d, bleed: mm(1.5), cut: [ellipsePoly(d / 2, d / 2, d / 2, d / 2)], cutKind: 'die', folds: [],
      panels: [panel('disc', 'Lid top', 0, 0, d, d, 'face', mm(4))], zones: [], dims: [dim(0, d, d, d, mm(7), `Ø ${fmtMm(d)}`)],
      substrate, defaultGround: null,
    });
  }
  return { surfaces, specs: [{ label: 'Jar Ø × H', value: `${fmtMm(g.D)} × ${fmtMm(g.H)}` }, { label: 'Label', value: `${fmtMm(g.lw)} × ${fmtMm(g.lh)}` }] };
}

export const JAR_TEMPLATE: ProductTemplate = {
  id: 'jar',
  name: 'Jar label',
  category: 'Packaging',
  description: 'Glass jar with a wrap label, a printed lid and visible contents.',
  options: [
    { key: 'diameter', label: 'Jar diameter', group: 'Size', kind: 'length', default: mm(72), min: mm(35), max: mm(160) },
    { key: 'height', label: 'Jar height', group: 'Size', kind: 'length', default: mm(88), min: mm(40), max: mm(220) },
    { key: 'labelW', label: 'Label width', group: 'Size', kind: 'length', default: mm(140), min: mm(30), max: mm(480) },
    { key: 'labelH', label: 'Label height', group: 'Size', kind: 'length', default: mm(50), min: mm(15), max: mm(200) },
    { key: 'labelY', label: 'Label from base', group: 'Size', kind: 'length', default: mm(14), min: 0, max: mm(150) },
    { key: 'lidLabel', label: 'Lid label', group: 'Size', kind: 'toggle', default: true },
    { key: 'stock', label: 'Label stock', group: 'Material', kind: 'select', default: 'white', choices: [{ value: 'white', label: 'White paper' }, { value: 'kraft', label: 'Kraft' }, { value: 'clear', label: 'Clear film' }] },
    { key: 'lid', label: 'Lid', group: 'Closure', kind: 'select', default: 'gold', choices: [{ value: 'gold', label: 'Gold metal' }, { value: 'silver', label: 'Silver metal' }, { value: 'black', label: 'Black metal' }, { value: 'white', label: 'White metal' }, { value: 'wood', label: 'Wood' }] },
    { key: 'contents', label: 'Contents colour', group: 'Contents', kind: 'color', default: '#d9921c' },
    { key: 'fill', label: 'Fill level', group: 'Contents', kind: 'slider', default: 0.88, min: 0, max: 0.98, step: 0.01, format: (v) => `${Math.round(v * 100)}%` },
  ],
  dieline: jar,
  animations: ['turntable', 'hero', 'float', 'reveal'],
};
