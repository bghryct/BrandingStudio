/**
 * Two-piece aluminium beverage cans. The printed area is the decorated body: the circumference
 * of the wall by the decoration height, which runs from the base curve to just under the
 * double seam. The neck taper and the base curve distort artwork, so they are marked as
 * distortion zones; the print splice (overlap) sits at the right edge.
 */
import type { Dieline, Opts, ProductTemplate } from './types';
import { num, str } from './types';
import { dim, fmtMm, mm, panel, rectPoly, zone } from './geom';

export interface CanSize { id: string; label: string; ml: number; oz: string; D: number; H: number; endD: number; neckH: number }

export const CAN_SIZES: CanSize[] = [
  { id: 'std-355', label: '355 ml standard (12 oz)', ml: 355, oz: '12 fl oz', D: 66.2, H: 122.2, endD: 57.4, neckH: 12 },
  { id: 'std-330', label: '330 ml standard', ml: 330, oz: '11.2 fl oz', D: 66.2, H: 115.2, endD: 57.4, neckH: 12 },
  { id: 'tall-473', label: '473 ml tall (16 oz)', ml: 473, oz: '16 fl oz', D: 66.2, H: 157.0, endD: 57.4, neckH: 12 },
  { id: 'tall-500', label: '500 ml tall', ml: 500, oz: '16.9 fl oz', D: 66.2, H: 168.0, endD: 57.4, neckH: 12 },
  { id: 'slim-250', label: '250 ml slim', ml: 250, oz: '8.4 fl oz', D: 53.0, H: 134.5, endD: 50.0, neckH: 10 },
  { id: 'sleek-330', label: '330 ml sleek', ml: 330, oz: '11.2 fl oz', D: 58.0, H: 146.0, endD: 52.5, neckH: 11 },
  { id: 'sleek-355', label: '355 ml sleek (12 oz)', ml: 355, oz: '12 fl oz', D: 58.0, H: 157.0, endD: 52.5, neckH: 11 },
];

export interface CanGeometry {
  size: CanSize;
  /** Body diameter, height, lid (end) diameter — pt. */
  D: number; H: number; endD: number;
  /** Height of the base curve (dome to full wall), of the neck taper and of the double seam. */
  baseH: number; neckH: number; rimH: number;
  /** Decorated band, measured from the bottom of the can. */
  printY0: number; printY1: number;
  circumference: number;
  overlap: number;
}

export function canGeometry(o: Opts): CanGeometry {
  const size = CAN_SIZES.find((s) => s.id === str(o, 'size')) ?? CAN_SIZES[0];
  const D = mm(size.D), H = mm(size.H), endD = mm(size.endD);
  const baseH = mm(8), neckH = mm(size.neckH), rimH = mm(3);
  const printY0 = mm(3.5);
  const printY1 = H - rimH - mm(2);
  return { size, D, H, endD, baseH, neckH, rimH, printY0, printY1, circumference: Math.PI * D, overlap: num(o, 'overlap', mm(3)) };
}

function dieline(o: Opts): Dieline {
  const g = canGeometry(o);
  const C = g.circumference;
  const w = C + g.overlap;
  const h = g.printY1 - g.printY0;
  const topZone = g.printY1 - (g.H - g.neckH);
  const bottomZone = g.baseH - g.printY0;
  const bare = str(o, 'base') === 'bare';
  return {
    surfaces: [{
      id: 'body',
      label: 'Can body',
      w, h,
      bleed: mm(2),
      cut: [rectPoly(0, 0, w, h)],
      cutKind: 'rect',
      folds: [],
      panels: [
        panel('back-l', 'Back · left', 0, 0, C * 0.25, h, 'zone', mm(2)),
        panel('front', 'Front (facing)', C * 0.25, 0, C * 0.5, h, 'face', mm(3)),
        panel('back-r', 'Back · right', C * 0.75, 0, C * 0.25, h, 'zone', mm(2)),
      ],
      zones: [
        zone('distortion', 'Neck taper · distorts', rectPoly(0, 0, w, topZone)),
        zone('distortion', 'Base curve · distorts', rectPoly(0, h - bottomZone, w, bottomZone)),
        zone('seam', 'Print splice / overlap', rectPoly(C, 0, g.overlap, h)),
      ],
      dims: [dim(0, 0, C, 0, -mm(8), `Circumference ${fmtMm(C)}`), dim(0, 0, 0, h, -mm(8), `Decoration ${fmtMm(h)}`), dim(C, h, w, h, mm(7), fmtMm(g.overlap))],
      substrate: bare ? '#c9ccd1' : '#ffffff',
      defaultGround: '#ffffff',
      notes: [
        bare ? 'Bare aluminium: inks are transparent and take on the metal; give items a white base (Finish → White base) to print them opaque.' : 'White base coat: colours print opaque on a white ground.',
        'Keep critical copy out of the neck and base distortion zones; the splice overlaps the start of the artwork.',
      ],
    }],
    specs: [
      { label: 'Capacity', value: `${g.size.ml} ml · ${g.size.oz}` },
      { label: 'Body Ø × height', value: `${fmtMm(g.D)} × ${fmtMm(g.H)}` },
      { label: 'End (lid) Ø', value: fmtMm(g.endD) },
      { label: 'Decorated area', value: `${fmtMm(C)} × ${fmtMm(h)}` },
    ],
  };
}

export const CAN_TEMPLATE: ProductTemplate = {
  id: 'can',
  name: 'Beverage can',
  category: 'Cans',
  description: 'Two-piece aluminium can: standard, tall, slim and sleek sizes, white base coat or bare metal, gloss or matte varnish.',
  options: [
    { key: 'size', label: 'Size', group: 'Size', kind: 'select', default: 'std-355', choices: CAN_SIZES.map((s) => ({ value: s.id, label: s.label })) },
    { key: 'overlap', label: 'Splice overlap', group: 'Size', kind: 'length', default: mm(3), min: 0, max: mm(10) },
    { key: 'base', label: 'Base coat', group: 'Material', kind: 'select', default: 'white', choices: [{ value: 'white', label: 'White base coat' }, { value: 'bare', label: 'Bare aluminium' }] },
    { key: 'varnish', label: 'Varnish', group: 'Material', kind: 'select', default: 'gloss', choices: [{ value: 'gloss', label: 'Gloss' }, { value: 'satin', label: 'Satin' }, { value: 'matte', label: 'Matte' }] },
    { key: 'lid', label: 'Lid & tab', group: 'Closure', kind: 'select', default: 'silver', choices: [{ value: 'silver', label: 'Silver' }, { value: 'black', label: 'Black' }, { value: 'gold', label: 'Gold' }, { value: 'custom', label: 'Custom colour' }] },
    { key: 'lidColor', label: 'Lid colour', group: 'Closure', kind: 'color', default: '#c0392b', when: (o) => o.lid === 'custom' },
    { key: 'condensation', label: 'Condensation droplets', group: 'Material', kind: 'toggle', default: false, hint: 'Ice-cold droplets in the 3D mockup' },
  ],
  dieline,
  animations: ['turntable', 'hero', 'roll', 'float', 'reveal'],
};
