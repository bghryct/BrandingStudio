/**
 * Stationery: business cards (EU, US, Japanese, square; optional rounded corners and painted
 * edges) and a letterhead (A4 / US Letter) with fold marks and the envelope address window.
 */
import type { Dieline, DielineSurface, Opts, ProductTemplate } from './types';
import { num, str } from './types';
import { dim, fmtMm, mm, panel, rectPoly, roundedRectPoly, zone } from './geom';

export const CARD_SIZES = [
  { value: 'eu', label: 'EU · 85 × 55 mm', w: 85, h: 55 },
  { value: 'us', label: 'US · 3.5 × 2 in', w: 88.9, h: 50.8 },
  { value: 'jp', label: 'Japan · 91 × 55 mm', w: 91, h: 55 },
  { value: 'square', label: 'Square · 65 × 65 mm', w: 65, h: 65 },
];

export const CARD_STOCKS = [
  { value: 'white', label: 'Bright white 400 gsm', color: '#fbfbf8' },
  { value: 'cotton', label: 'Cotton 600 gsm', color: '#f4f0e6' },
  { value: 'cream', label: 'Cream laid', color: '#efe6d0' },
  { value: 'kraft', label: 'Kraft', color: '#b58c5c' },
  { value: 'black', label: 'Black duplex', color: '#19181a' },
];

export function cardGeometry(o: Opts) {
  const s = CARD_SIZES.find((x) => x.value === str(o, 'size')) ?? CARD_SIZES[0];
  const portrait = str(o, 'orientation', 'landscape') === 'portrait';
  const w = mm(portrait ? s.h : s.w), h = mm(portrait ? s.w : s.h);
  const r = str(o, 'corners', 'square') === 'round' ? mm(3.5) : 0;
  const thick = ({ standard: 0.45, thick: 0.8, duplex: 1.2 } as Record<string, number>)[str(o, 'thickness', 'thick')] ?? 0.8;
  return { size: s, w, h, r, thickness: mm(thick), us: s.value === 'us' };
}

function card(o: Opts): Dieline {
  const g = cardGeometry(o);
  const stock = CARD_STOCKS.find((x) => x.value === str(o, 'stock')) ?? CARD_STOCKS[0];
  const bleed = g.us ? mm(3.175) : mm(3);
  const face = (id: string, label: string): DielineSurface => ({
    id, label, w: g.w, h: g.h, bleed, cut: [g.r ? roundedRectPoly(0, 0, g.w, g.h, g.r) : rectPoly(0, 0, g.w, g.h)], cutKind: g.r ? 'die' : 'rect', folds: [],
    panels: [panel('card', label, 0, 0, g.w, g.h, 'face', g.us ? mm(3.175) : mm(3.5))],
    zones: [], dims: [dim(0, g.h, g.w, g.h, mm(6), fmtMm(g.w)), dim(g.w, 0, g.w, g.h, mm(6), fmtMm(g.h))],
    substrate: stock.color, defaultGround: null,
  });
  return {
    surfaces: [face('front', 'Front'), face('back', 'Back')],
    specs: [{ label: 'Card', value: g.size.label }, { label: 'Stock', value: stock.label }, { label: 'Bleed', value: fmtMm(bleed) }],
  };
}

export const CARD_TEMPLATE: ProductTemplate = {
  id: 'card',
  name: 'Business card',
  category: 'Stationery',
  description: 'Two-sided business card on premium stock, square or rounded corners, painted edges.',
  options: [
    { key: 'size', label: 'Size', group: 'Size', kind: 'select', default: 'eu', choices: CARD_SIZES.map((s) => ({ value: s.value, label: s.label })) },
    { key: 'orientation', label: 'Orientation', group: 'Size', kind: 'select', default: 'landscape', choices: [{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }] },
    { key: 'corners', label: 'Corners', group: 'Construction', kind: 'select', default: 'square', choices: [{ value: 'square', label: 'Square' }, { value: 'round', label: 'Rounded 3.5 mm' }] },
    { key: 'thickness', label: 'Thickness', group: 'Construction', kind: 'select', default: 'thick', choices: [{ value: 'standard', label: 'Standard 0.45 mm' }, { value: 'thick', label: 'Thick 0.8 mm' }, { value: 'duplex', label: 'Duplex 1.2 mm' }] },
    { key: 'stock', label: 'Stock', group: 'Material', kind: 'select', default: 'cotton', choices: CARD_STOCKS.map((s) => ({ value: s.value, label: s.label })) },
    { key: 'finish', label: 'Finish', group: 'Material', kind: 'select', default: 'uncoated', choices: [{ value: 'uncoated', label: 'Uncoated' }, { value: 'matte', label: 'Matte' }, { value: 'soft-touch', label: 'Soft-touch' }, { value: 'gloss', label: 'Gloss' }] },
    { key: 'edge', label: 'Painted edge', group: 'Material', kind: 'color', default: '#00000000', hint: 'Transparent = no edge paint' },
  ],
  dieline: card,
  animations: ['spin', 'hero', 'float', 'turntable'],
};

export const PAPER_SIZES = [
  { value: 'a4', label: 'A4 · 210 × 297 mm', w: 210, h: 297 },
  { value: 'letter', label: 'US Letter · 8.5 × 11 in', w: 215.9, h: 279.4 },
];

function letterhead(o: Opts): Dieline {
  const s = PAPER_SIZES.find((x) => x.value === str(o, 'size')) ?? PAPER_SIZES[0];
  const w = mm(s.w), h = mm(s.h);
  const stock = CARD_STOCKS.find((x) => x.value === str(o, 'stock')) ?? CARD_STOCKS[0];
  const a4 = s.value === 'a4';
  const marks = a4 ? [105, 210] : [93.1, 186.2];
  const zones = [
    zone('window', 'Envelope window', rectPoly(mm(20), mm(45), mm(85), mm(45))),
    ...marks.map((y) => zone('info', 'Fold mark', rectPoly(0, mm(y) - 0.5, mm(5), 1))),
    zone('info', 'Punch mark', rectPoly(0, h / 2 - 0.5, mm(8), 1)),
  ];
  return {
    surfaces: [{
      id: 'sheet', label: 'Letterhead', w, h, bleed: mm(3), cut: [rectPoly(0, 0, w, h)], cutKind: 'rect', folds: [],
      panels: [panel('sheet', 'Sheet', 0, 0, w, h, 'face', mm(15))],
      zones, dims: [dim(0, h, w, h, mm(8), fmtMm(w)), dim(w, 0, w, h, mm(8), fmtMm(h))],
      substrate: stock.color, defaultGround: null,
      notes: ['DIN 5008 address window and fold marks are shown for reference; they are not printed.'],
    }],
    specs: [{ label: 'Sheet', value: s.label }, { label: 'Stock', value: stock.label }],
  };
}

export const LETTERHEAD_TEMPLATE: ProductTemplate = {
  id: 'letterhead',
  name: 'Letterhead',
  category: 'Stationery',
  description: 'A4 or US Letter letterhead with envelope window and fold marks.',
  options: [
    { key: 'size', label: 'Size', group: 'Size', kind: 'select', default: 'a4', choices: PAPER_SIZES.map((s) => ({ value: s.value, label: s.label })) },
    { key: 'stock', label: 'Stock', group: 'Material', kind: 'select', default: 'white', choices: CARD_STOCKS.filter((s) => s.value !== 'black').map((s) => ({ value: s.value, label: s.label })) },
  ],
  dieline: letterhead,
  animations: ['hero', 'float', 'turntable'],
};

export { num };
