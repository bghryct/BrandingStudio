/**
 * Textile products: tote bag, t-shirt, hoodie and cap. Their surfaces are print areas placed on
 * the garment; the editor draws the garment around them for orientation, and the 3D builders
 * use the same silhouettes (garment coordinates in mm, origin at the high point of the shoulder
 * line at the centre of the neck, y down).
 */
import type { Dieline, DielineSurface, Opts, P2, ProductTemplate } from './types';
import { num, str } from './types';
import { dim, fmtMm, mm, panel, polyToPath, rectPoly, roundedRectPoly, zone } from './geom';

export const PRINT_METHODS = [
  { value: 'screen', label: 'Screen print' },
  { value: 'dtg', label: 'Direct to garment (DTG)' },
  { value: 'embroidery', label: 'Embroidery' },
];

export const FABRICS: { value: string; label: string; color: string }[] = [
  { value: 'natural', label: 'Natural (ecru)', color: '#e9e1cf' },
  { value: 'white', label: 'White', color: '#f4f3ef' },
  { value: 'black', label: 'Black', color: '#1d1d1f' },
  { value: 'heather', label: 'Heather grey', color: '#9fa0a3' },
  { value: 'navy', label: 'Navy', color: '#1f2a44' },
  { value: 'olive', label: 'Olive', color: '#5d6140' },
  { value: 'sand', label: 'Sand', color: '#cdb892' },
  { value: 'red', label: 'Red', color: '#a8262d' },
  { value: 'custom', label: 'Custom colour', color: '#7a8f9a' },
];

export const fabricColor = (o: Opts, key = 'fabric', customKey = 'fabricColor') => {
  const f = FABRICS.find((x) => x.value === str(o, key)) ?? FABRICS[0];
  return f.value === 'custom' ? str(o, customKey, f.color) : f.color;
};

const COLOR_OPTIONS = (def: string) => [
  { key: 'fabric', label: 'Colour', group: 'Material' as const, kind: 'select' as const, default: def, choices: FABRICS.map((f) => ({ value: f.value, label: f.label })) },
  { key: 'fabricColor', label: 'Custom colour', group: 'Material' as const, kind: 'color' as const, default: '#7a8f9a', when: (o: Opts) => o.fabric === 'custom' },
  { key: 'method', label: 'Print method', group: 'Print' as const, kind: 'select' as const, default: 'screen', choices: PRINT_METHODS },
];

/** Print-area surface with the garment drawn around it as context. */
function printArea(id: string, label: string, w: number, h: number, garment: P2[], origin: P2, substrate: string, extra: string[] = [], context = 'Garment'): DielineSurface {
  // Garment coordinates (mm) → surface coordinates (pt): the print area's top-left is `origin`.
  const ctx = garment.map((p) => ({ x: mm(p.x - origin.x), y: mm(p.y - origin.y) }));
  return {
    id, label, w, h, bleed: 0, cut: [rectPoly(0, 0, w, h)], cutKind: 'none', folds: [],
    panels: [panel('area', label, 0, 0, w, h, 'face', 0)],
    zones: [zone('print-area', 'Maximum print area', rectPoly(0, 0, w, h))],
    dims: [dim(0, 0, w, 0, -mm(10), fmtMm(w)), dim(0, 0, 0, h, -mm(10), fmtMm(h))],
    substrate, defaultGround: null,
    context: { d: polyToPath(ctx), fill: substrate, stroke: 'rgba(255,255,255,0.35)', label: context },
    notes: extra,
  };
}

/* -------------------------------------------------------------------------- */
/* Tote bag                                                                     */
/* -------------------------------------------------------------------------- */

export function toteGeometry(o: Opts) {
  const W = num(o, 'width', mm(380)), H = num(o, 'height', mm(420)), G = num(o, 'gusset', 0);
  const handleL = num(o, 'handle', mm(620)), handleW = mm(25);
  return { W, H, G, handleL, handleW };
}

function tote(o: Opts): Dieline {
  const g = toteGeometry(o);
  const fabric = fabricColor(o);
  const pw = Math.min(num(o, 'printW', mm(280)), g.W - mm(40)), ph = Math.min(num(o, 'printH', mm(330)), g.H - mm(40));
  const top = Math.min(mm(60), g.H - ph - mm(20));
  const wMm = g.W / mm(1), hMm = g.H / mm(1);
  const bag = roundedRectPoly(0, 0, wMm, hMm, [0, 0, 6, 6], 4);
  // Handles drawn as context too.
  const drop = Math.min(g.handleL / mm(1) / 2 - 40, 330);
  const handle = (cx: number) => {
    const out: P2[] = [];
    const span = wMm * 0.24;
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI + (Math.PI * i) / 24;
      out.push({ x: cx + (span / 2) * Math.cos(a), y: drop * 0.98 * Math.sin(a) });
    }
    return out;
  };
  const origin = { x: (wMm - pw / mm(1)) / 2, y: top / mm(1) };
  const surface = (id: string, label: string) => {
    const s = printArea(id, label, pw, ph, bag, origin, fabric, ['Screen print and DTG stay inside the print area; seams and handles are not printable.'], 'Bag panel');
    const hs = [handle(wMm * 0.3), handle(wMm * 0.7)].map((h) => polyToPath(h.map((p) => ({ x: mm(p.x - origin.x), y: mm(p.y - origin.y) })), false)).join('');
    s.context = { ...s.context!, d: `${s.context!.d}${hs}` };
    return s;
  };
  return {
    surfaces: [surface('front', 'Front print'), surface('back', 'Back print')],
    specs: [
      { label: 'Bag W × H', value: `${fmtMm(g.W)} × ${fmtMm(g.H)}${g.G ? ` × ${fmtMm(g.G)} gusset` : ''}` },
      { label: 'Handles', value: `${fmtMm(g.handleL)} × ${fmtMm(g.handleW)}` },
      { label: 'Print area', value: `${fmtMm(pw)} × ${fmtMm(ph)}` },
    ],
  };
}

export const TOTE_TEMPLATE: ProductTemplate = {
  id: 'tote',
  name: 'Tote bag',
  category: 'Bags',
  description: 'Cotton or canvas tote with front and back print areas and long handles.',
  options: [
    { key: 'width', label: 'Width', group: 'Size', kind: 'length', default: mm(380), min: mm(200), max: mm(600) },
    { key: 'height', label: 'Height', group: 'Size', kind: 'length', default: mm(420), min: mm(200), max: mm(600) },
    { key: 'gusset', label: 'Gusset', group: 'Size', kind: 'length', default: 0, min: 0, max: mm(200) },
    { key: 'handle', label: 'Handle length', group: 'Size', kind: 'length', default: mm(620), min: mm(300), max: mm(900) },
    { key: 'printW', label: 'Print area width', group: 'Print', kind: 'length', default: mm(280), min: mm(50), max: mm(500) },
    { key: 'printH', label: 'Print area height', group: 'Print', kind: 'length', default: mm(330), min: mm(50), max: mm(500) },
    { key: 'weave', label: 'Fabric', group: 'Material', kind: 'select', default: 'cotton', choices: [{ value: 'cotton', label: 'Cotton (5 oz)' }, { value: 'canvas', label: 'Heavy canvas (12 oz)' }, { value: 'jute', label: 'Jute' }] },
    ...COLOR_OPTIONS('natural'),
  ],
  dieline: tote,
  animations: ['sway', 'turntable', 'hero', 'float'],
};

/* -------------------------------------------------------------------------- */
/* Garments                                                                     */
/* -------------------------------------------------------------------------- */

export const GARMENT_SIZES = [
  { value: 'S', label: 'S', chest: 235, length: 700 },
  { value: 'M', label: 'M', chest: 255, length: 730 },
  { value: 'L', label: 'L', chest: 280, length: 760 },
  { value: 'XL', label: 'XL', chest: 305, length: 790 },
];

export interface Garment {
  kind: 'tee' | 'hoodie';
  chest: number; length: number; neckW: number; neckFront: number; neckBack: number;
  front: P2[]; back: P2[];
  /** Sleeve axis (garment mm): from the shoulder to the cuff centre, and the cuff width. */
  sleeve: { from: P2; to: P2; width: number };
  /** The right sleeve as a quad: shoulder, outer cuff, inner cuff, underarm. */
  sleevePoly: P2[];
  hood?: P2[];
  pocket?: P2[];
  rib?: number;
}

function mirror(right: P2[]): P2[] {
  const left = right.slice().reverse().map((p) => ({ x: -p.x, y: p.y }));
  return [...right, ...left];
}

export function garmentShape(kind: 'tee' | 'hoodie', size: string): Garment {
  const s = GARMENT_SIZES.find((x) => x.value === size) ?? GARMENT_SIZES[1];
  const cw = s.chest + (kind === 'hoodie' ? 20 : 0), L = s.length + (kind === 'hoodie' ? -40 : 0);
  const nw = kind === 'hoodie' ? 95 : 82;
  const nf = kind === 'hoodie' ? 70 : 95, nb = 22;
  const sw = cw * 0.9;
  const ang = ((kind === 'hoodie' ? 66 : 32) * Math.PI) / 180;
  const sl = (kind === 'hoodie' ? 600 : 205) * (s.chest / 255);
  const cuff = kind === 'hoodie' ? 105 : 178;
  const sh = { x: sw, y: 24 };
  const outer = { x: sh.x + Math.cos(ang) * sl, y: sh.y + Math.sin(ang) * sl };
  const inner = { x: outer.x - Math.sin(ang) * cuff, y: outer.y + Math.cos(ang) * cuff };
  const under = { x: cw, y: kind === 'hoodie' ? 280 : 250 };
  const neckCurve = (depth: number) => {
    const pts: P2[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = (Math.PI * i) / 16;
      pts.push({ x: -nw * Math.cos(a), y: depth * Math.sin(a) });
    }
    return pts; // from (−nw, 0) down through (0, depth) to (nw, 0)
  };
  const right: P2[] = [sh, outer, inner, under, { x: cw + 6, y: L }, { x: cw * 0.5, y: L + 4 }];
  const body = (depth: number): P2[] => {
    const halves = mirror([{ x: nw, y: 0 }, ...right]);
    // halves ends at (−nw, 0); close with the neckline back to (nw, 0)
    return [...halves, ...neckCurve(depth).slice(1, -1)];
  };
  const g: Garment = {
    kind, chest: cw, length: L, neckW: nw, neckFront: nf, neckBack: nb,
    front: body(nf), back: body(nb),
    sleeve: { from: { x: (sh.x + under.x) / 2, y: (sh.y + under.y) / 2 }, to: { x: (outer.x + inner.x) / 2, y: (outer.y + inner.y) / 2 }, width: cuff },
    sleevePoly: [sh, outer, inner, under],
  };
  if (kind === 'hoodie') {
    const hood: P2[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI + (Math.PI * i) / 24;
      hood.push({ x: (nw + 38) * Math.cos(a) * (1 + 0.12 * Math.sin(Math.PI * i / 24)), y: -20 + 215 * Math.sin(a) });
    }
    g.hood = [{ x: -nw - 10, y: 10 }, ...hood, { x: nw + 10, y: 10 }];
    const pt = L - 270, pb = L - 75;
    g.pocket = [{ x: -150, y: pt }, { x: 150, y: pt }, { x: 175, y: pt + 40 }, { x: 205, y: pb }, { x: -205, y: pb }, { x: -175, y: pt + 40 }];
    g.rib = 65;
  }
  return g;
}

interface GarmentPrint { id: string; label: string; w: number; h: number; x: number; y: number; view: 'front' | 'back' | 'sleeve' }

export function garmentPrints(kind: 'tee' | 'hoodie', o: Opts): GarmentPrint[] {
  const g = garmentShape(kind, str(o, 'size', 'M'));
  const fw = num(o, 'frontW', mm(kind === 'tee' ? 305 : 305)) / mm(1), fh = num(o, 'frontH', mm(kind === 'tee' ? 406 : 230)) / mm(1);
  const bw = num(o, 'backW', mm(305)) / mm(1), bh = num(o, 'backH', mm(kind === 'tee' ? 406 : 380)) / mm(1);
  const fw2 = Math.min(fw, g.chest * 2 - 80), bw2 = Math.min(bw, g.chest * 2 - 80);
  const fTop = kind === 'tee' ? 125 : 120;
  const fh2 = Math.min(fh, kind === 'hoodie' ? g.pocket![0].y - fTop - 25 : g.length - fTop - 60);
  const bh2 = Math.min(bh, g.length - 80 - 60);
  const out: GarmentPrint[] = [
    { id: 'front', label: 'Front print', w: fw2, h: fh2, x: -fw2 / 2, y: fTop, view: 'front' },
    { id: 'back', label: 'Back print', w: bw2, h: bh2, x: -bw2 / 2, y: 80, view: 'back' },
  ];
  if (str(o, 'sleevePrint', 'left') !== 'none') {
    const sw = kind === 'tee' ? 89 : 76, sh = kind === 'tee' ? 89 : 305;
    out.push({ id: 'sleeve', label: kind === 'tee' ? 'Sleeve print' : 'Sleeve print (along the arm)', w: sw, h: sh, x: 0, y: 0, view: 'sleeve' });
  }
  return out;
}

/** Sleeve polygon in the print area's frame (print upright, sleeve running down the page), mm. */
export function sleeveFrame(g: Garment, hMm: number) {
  const { from, to } = g.sleeve;
  const ax = { x: to.x - from.x, y: to.y - from.y };
  const len = Math.hypot(ax.x, ax.y);
  const u = { x: ax.x / len, y: ax.y / len };
  const v = { x: u.y, y: -u.x };
  const centreAlong = g.kind === 'tee' ? len * 0.45 : Math.min(len - hMm / 2 - 20, 110 + hMm / 2);
  const centre = { x: from.x + u.x * centreAlong, y: from.y + u.y * centreAlong };
  return { u, v, centre, len };
}

function sleeveContext(g: Garment, w: number, h: number): P2[] {
  const f = sleeveFrame(g, h / mm(1));
  return g.sleevePoly.map((p) => {
    const d = { x: p.x - f.centre.x, y: p.y - f.centre.y };
    return { x: d.x * f.v.x + d.y * f.v.y + w / mm(1) / 2, y: d.x * f.u.x + d.y * f.u.y + h / mm(1) / 2 };
  });
}

function garmentDieline(kind: 'tee' | 'hoodie', o: Opts): Dieline {
  const g = garmentShape(kind, str(o, 'size', 'M'));
  const fabric = fabricColor(o);
  const method = str(o, 'method', 'screen');
  const note = method === 'embroidery' ? 'Embroidery: keep shapes bold, minimum line ≈ 1 mm, at most 12 thread colours.' : method === 'dtg' ? 'DTG: full colour on the fabric; on dark garments a white underbase prints first.' : 'Screen print: each colour is a separate screen; flat spot colours print best.';
  const surfaces: DielineSurface[] = garmentPrints(kind, o).map((p) => {
    const W = mm(p.w), H = mm(p.h);
    if (p.view === 'sleeve') {
      const ctx = sleeveContext(g, W, H);
      return printArea(p.id, p.label, W, H, ctx, { x: 0, y: 0 }, fabric, [note], 'Sleeve');
    }
    const outline = p.view === 'front' ? g.front : g.back;
    const all = kind === 'hoodie' && p.view === 'back' && g.hood ? outline : outline;
    const s = printArea(p.id, p.label, W, H, all, { x: p.x, y: p.y }, fabric, [note], kind === 'tee' ? 'T-shirt' : 'Hoodie');
    if (kind === 'hoodie' && p.view === 'front' && g.pocket) {
      const pk = polyToPath(g.pocket.map((q) => ({ x: mm(q.x - p.x), y: mm(q.y - p.y) })));
      s.context = { ...s.context!, d: s.context!.d + pk };
      s.zones.push(zone('nonprint', 'Kangaroo pocket', g.pocket.map((q) => ({ x: mm(q.x - p.x), y: mm(q.y - p.y) }))));
    }
    return s;
  });
  return {
    surfaces,
    specs: [
      { label: 'Garment', value: `${kind === 'tee' ? 'T-shirt' : 'Hoodie'} · size ${str(o, 'size', 'M')}` },
      { label: 'Chest (flat) × length', value: `${fmtMm(mm(g.chest * 2))} × ${fmtMm(mm(g.length))}` },
      { label: 'Method', value: PRINT_METHODS.find((m) => m.value === method)?.label ?? method },
    ],
  };
}

const GARMENT_OPTIONS = (kind: 'tee' | 'hoodie') => [
  { key: 'size', label: 'Size', group: 'Size' as const, kind: 'select' as const, default: 'M', choices: GARMENT_SIZES.map((s) => ({ value: s.value, label: s.label })) },
  { key: 'frontW', label: 'Front print width', group: 'Print' as const, kind: 'length' as const, default: mm(305), min: mm(40), max: mm(400) },
  { key: 'frontH', label: 'Front print height', group: 'Print' as const, kind: 'length' as const, default: mm(kind === 'tee' ? 406 : 230), min: mm(40), max: mm(500) },
  { key: 'backW', label: 'Back print width', group: 'Print' as const, kind: 'length' as const, default: mm(305), min: mm(40), max: mm(400) },
  { key: 'backH', label: 'Back print height', group: 'Print' as const, kind: 'length' as const, default: mm(kind === 'tee' ? 406 : 380), min: mm(40), max: mm(500) },
  { key: 'sleevePrint', label: 'Sleeve print', group: 'Print' as const, kind: 'select' as const, default: 'left', choices: [{ value: 'left', label: 'Left sleeve' }, { value: 'none', label: 'None' }] },
  ...COLOR_OPTIONS(kind === 'tee' ? 'white' : 'heather'),
];

export const TEE_TEMPLATE: ProductTemplate = {
  id: 'tee',
  name: 'T-shirt',
  category: 'Apparel',
  description: 'Crew-neck tee with front, back and sleeve print areas; screen print, DTG or embroidery.',
  options: GARMENT_OPTIONS('tee'),
  dieline: (o) => garmentDieline('tee', o),
  animations: ['turntable', 'hero', 'sway', 'float'],
};

export const HOODIE_TEMPLATE: ProductTemplate = {
  id: 'hoodie',
  name: 'Hoodie',
  category: 'Apparel',
  description: 'Pullover hoodie with kangaroo pocket: front, back and along-the-sleeve print areas.',
  options: GARMENT_OPTIONS('hoodie'),
  dieline: (o) => garmentDieline('hoodie', o),
  animations: ['turntable', 'hero', 'sway', 'float'],
};

/* -------------------------------------------------------------------------- */
/* Cap                                                                          */
/* -------------------------------------------------------------------------- */

export function capPrints(o: Opts) {
  return {
    front: { w: Math.min(num(o, 'frontW', mm(110)), mm(130)), h: Math.min(num(o, 'frontH', mm(55)), mm(65)) },
    side: { w: mm(55), h: mm(35) },
    back: { w: mm(70), h: mm(25) },
  };
}

function cap(o: Opts): Dieline {
  const p = capPrints(o);
  const fabric = fabricColor(o);
  // Front view of the crown and brim (mm), centred on the front print.
  const crown: P2[] = [];
  for (let i = 0; i <= 32; i++) {
    const a = Math.PI + (Math.PI * i) / 32;
    crown.push({ x: 95 * Math.cos(a), y: 30 + 110 * Math.sin(a) * 0.92 });
  }
  const brim: P2[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (Math.PI * i) / 24;
    brim.push({ x: 100 * Math.cos(a), y: 30 + 26 * Math.sin(a) });
  }
  const front = printArea('front', 'Front panel', p.front.w, p.front.h, [...crown, ...brim], { x: -p.front.w / mm(1) / 2, y: -82 }, fabric, ['Embroidery on the structured front panels; keep detail above 1 mm.'], 'Cap front');
  const sidePanel: P2[] = [{ x: -60, y: 50 }, { x: -30, y: -40 }, { x: 40, y: -45 }, { x: 75, y: 50 }];
  const side = printArea('side', 'Side (left)', p.side.w, p.side.h, sidePanel, { x: -p.side.w / mm(1) / 2, y: -p.side.h / mm(1) / 2 }, fabric, [], 'Side panel');
  const backPanel: P2[] = [{ x: -70, y: 30 }, { x: -60, y: -40 }, { x: 60, y: -40 }, { x: 70, y: 30 }, { x: 25, y: 30 }, { x: 22, y: 10 }, { x: -22, y: 10 }, { x: -25, y: 30 }];
  const back = printArea('back', 'Back (above strap)', p.back.w, p.back.h, backPanel, { x: -p.back.w / mm(1) / 2, y: -35 }, fabric, [], 'Back panel');
  return {
    surfaces: [front, side, back],
    specs: [{ label: 'Style', value: '6-panel structured cap' }, { label: 'Front print', value: `${fmtMm(p.front.w)} × ${fmtMm(p.front.h)}` }],
  };
}

export const CAP_TEMPLATE: ProductTemplate = {
  id: 'cap',
  name: 'Cap',
  category: 'Apparel',
  description: 'Six-panel structured cap with front, side and back decoration (embroidery or print).',
  options: [
    { key: 'frontW', label: 'Front width', group: 'Print', kind: 'length', default: mm(110), min: mm(30), max: mm(130) },
    { key: 'frontH', label: 'Front height', group: 'Print', kind: 'length', default: mm(55), min: mm(15), max: mm(65) },
    { key: 'fabric', label: 'Crown colour', group: 'Material', kind: 'select', default: 'navy', choices: FABRICS.map((f) => ({ value: f.value, label: f.label })) },
    { key: 'fabricColor', label: 'Custom colour', group: 'Material', kind: 'color', default: '#7a8f9a', when: (o) => o.fabric === 'custom' },
    { key: 'brim', label: 'Brim colour', group: 'Material', kind: 'color', default: '#1f2a44' },
    { key: 'method', label: 'Decoration', group: 'Print', kind: 'select', default: 'embroidery', choices: PRINT_METHODS },
  ],
  dieline: cap,
  animations: ['turntable', 'hero', 'float'],
};
