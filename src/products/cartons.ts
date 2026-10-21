/**
 * Folding cartons generated from length × width × depth:
 *   - straight tuck end (both closures hinge on the back panel)
 *   - reverse tuck end (top closure on the back, bottom closure on the front)
 *   - roll-end tuck-front mailer box with double side walls and ears
 *   - pillow box with curved end creases
 *   - sleeve (open-ended wrap around a tray)
 * Every carton also returns its hinge tree so the 3D view can fold it up from the flat sheet.
 */
import type { Dieline, DielinePanel, FoldLine, NetNode, Opts, P2, ProductTemplate, Zone } from './types';
import { num, str } from './types';
import { arcPts, dim, fmtMm, fold, mm, panel, polyBounds, rectPoly, roundedRectPoly, translatePoly, zone } from './geom';

export interface BoardStock { value: string; label: string; outside: string; inside: string; caliper: number }

export const BOARDS: BoardStock[] = [
  { value: 'sbs', label: 'White SBS board', outside: '#fbfaf7', inside: '#f1eee6', caliper: 0.45 },
  { value: 'kraft', label: 'Kraft board', outside: '#b58a5b', inside: '#a57b4f', caliper: 0.5 },
  { value: 'gc1', label: 'GC1 (white / grey back)', outside: '#f7f6f2', inside: '#cfccc4', caliper: 0.5 },
  { value: 'black', label: 'Black-through board', outside: '#1e1d1f', inside: '#1a191b', caliper: 0.5 },
  { value: 'corrugated', label: 'E-flute corrugated', outside: '#c49a6c', inside: '#b98f62', caliper: 1.6 },
];

export const boardOf = (o: Opts) => BOARDS.find((b) => b.value === str(o, 'board')) ?? BOARDS[0];

const FINISH_OPTION = { key: 'finish', label: 'Coating', group: 'Material' as const, kind: 'select' as const, default: 'matte', choices: [{ value: 'matte', label: 'Matte varnish' }, { value: 'gloss', label: 'Gloss varnish' }, { value: 'soft-touch', label: 'Soft-touch laminate' }, { value: 'uncoated', label: 'Uncoated' }] };

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Dust flap rising from a hinge at y (pointing up when dir = −1, down when dir = +1). */
function dustFlap(x: number, y: number, w: number, h: number, dir: -1 | 1, angledRight: boolean): P2[] {
  const g = mm(0.5), c = h * 0.32;
  const yy = (v: number) => y + dir * v;
  const pts: P2[] = angledRight
    ? [{ x: x + g, y }, { x: x + g, y: yy(h - mm(2)) }, { x: x + g + mm(2), y: yy(h) }, { x: x + w - g - c * 1.4, y: yy(h) }, { x: x + w - g, y: yy(h - c) }, { x: x + w - g, y }]
    : [{ x: x + g, y }, { x: x + g, y: yy(h - c) }, { x: x + g + c * 1.4, y: yy(h) }, { x: x + w - g - mm(2), y: yy(h) }, { x: x + w - g, y: yy(h - mm(2)) }, { x: x + w - g, y }];
  return pts;
}

/** Tuck flap on a hinge at y spanning x … x+w, with rounded free corners and lock shoulders. */
function tuckFlap(x: number, y: number, w: number, h: number, dir: -1 | 1): P2[] {
  const s = mm(1.2), r = Math.min(h * 0.55, mm(9));
  const yy = (v: number) => y + dir * v;
  const pts: P2[] = [{ x: x + s * 0.4, y }, { x: x + s, y: yy(mm(1.5)) }];
  // Rounded far corners.
  const far = yy(h);
  const cy = far - dir * r;
  const arcL = arcPts(x + s + r, cy, r, Math.PI, dir === -1 ? 1.5 * Math.PI : 0.5 * Math.PI, 10);
  const arcR = arcPts(x + w - s - r, cy, r, dir === -1 ? 1.5 * Math.PI : 0.5 * Math.PI, dir === -1 ? 2 * Math.PI : 0, 10);
  pts.push(...arcL, ...arcR, { x: x + w - s, y: yy(mm(1.5)) }, { x: x + w - s * 0.4, y });
  return pts;
}

function glueFlap(x: number, y: number, g: number, h: number, side: 'left' | 'right'): P2[] {
  const i = mm(1), t = g * Math.tan((20 * Math.PI) / 180);
  return side === 'left'
    ? [{ x: x + g, y: y + i }, { x, y: y + i + t }, { x, y: y + h - i - t }, { x: x + g, y: y + h - i }]
    : [{ x, y: y + i }, { x: x + g, y: y + i + t }, { x: x + g, y: y + h - i - t }, { x, y: y + h - i }];
}

const node = (id: string, poly: P2[], parent: string | null, hinge: [P2, P2] | null, angle: number, stage: [number, number]): NetNode => ({ id, poly, parent, hinge, angle, stage });
const H = (x1: number, y1: number, x2: number, y2: number): [P2, P2] => [{ x: x1, y: y1 }, { x: x2, y: y2 }];

/** Move everything so the bounding box starts at (0, 0). */
function normalise(nodes: NetNode[], panels: DielinePanel[], folds: FoldLine[], zones: Zone[]) {
  const b = polyBounds(nodes.map((n) => n.poly));
  const dx = -b.x, dy = -b.y;
  const tp = (p: P2) => ({ x: p.x + dx, y: p.y + dy });
  return {
    w: b.w, h: b.h, dx, dy,
    nodes: nodes.map((n) => ({ ...n, poly: n.poly.map(tp), hinge: n.hinge ? [tp(n.hinge[0]), tp(n.hinge[1])] as [P2, P2] : null })),
    panels: panels.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy, poly: p.poly?.map(tp) })),
    folds: folds.map((f) => ({ ...f, pts: f.pts.map(tp) })),
    zones: zones.map((z) => ({ ...z, poly: z.poly.map(tp) })),
  };
}

/* -------------------------------------------------------------------------- */
/* Tuck end cartons                                                            */
/* -------------------------------------------------------------------------- */

export function tuckCarton(o: Opts, reverse: boolean): Dieline {
  const L = num(o, 'length', mm(60)), W = num(o, 'width', mm(40)), D = num(o, 'depth', mm(140));
  const board = boardOf(o);
  const g = Math.min(mm(14), D * 0.3);
  const t = Math.max(mm(10), Math.min(mm(20), W * 0.6));
  const dh = Math.max(mm(8), Math.min(W * 0.8, L * 0.45));
  const xBack = g, xSL = g + L, xFront = g + L + W, xSR = g + 2 * L + W;
  const y0 = 0, y1 = D; // main panels; closures above (negative y) and below
  const nodes: NetNode[] = [];
  const panels: DielinePanel[] = [];
  const folds: FoldLine[] = [];
  const zones: Zone[] = [];

  // Main panels.
  nodes.push(node('front', rectPoly(xFront, y0, L, D), null, null, 0, [0, 0]));
  nodes.push(node('side-l', rectPoly(xSL, y0, W, D), 'front', H(xFront, y1, xFront, y0), 90, [0, 0.3]));
  nodes.push(node('back', rectPoly(xBack, y0, L, D), 'side-l', H(xSL, y1, xSL, y0), 90, [0.04, 0.34]));
  nodes.push(node('glue', glueFlap(0, y0, g, D, 'left'), 'back', H(xBack, y1, xBack, y0), 91.5, [0.08, 0.38]));
  nodes.push(node('side-r', rectPoly(xSR, y0, W, D), 'front', H(xSR, y0, xSR, y1), 90, [0.12, 0.42]));
  panels.push(
    panel('front', 'Front', xFront, y0, L, D, 'face'),
    panel('side-l', 'Left side', xSL, y0, W, D, 'side'),
    panel('back', 'Back', xBack, y0, L, D, 'face'),
    panel('side-r', 'Right side', xSR, y0, W, D, 'side'),
    panel('glue', 'Glue flap', 0, y0, g, D, 'glue', 0),
  );
  for (const x of [xBack, xSL, xFront, xSR]) folds.push(fold(x, y0, x, y1));
  zones.push(zone('glue', 'Glue', glueFlap(0, y0, g, D, 'left')));

  // Top closure: lid on the back panel, tuck into the front.
  const lidTop = rectPoly(xBack, y0 - W, L, W);
  nodes.push(node('lid-top', lidTop, 'back', H(xBack, y0, xBack + L, y0), 90, [0.62, 0.82]));
  nodes.push(node('tuck-top', tuckFlap(xBack, y0 - W, L, t, -1), 'lid-top', H(xBack, y0 - W, xBack + L, y0 - W), 92, [0.8, 0.98]));
  nodes.push(node('dust-tl', dustFlap(xSL, y0, W, dh, -1, false), 'side-l', H(xSL, y0, xSL + W, y0), 93, [0.44, 0.6]));
  nodes.push(node('dust-tr', dustFlap(xSR, y0, W, dh, -1, true), 'side-r', H(xSR, y0, xSR + W, y0), 93, [0.44, 0.6]));
  panels.push(
    panel('lid-top', 'Top (lid)', xBack, y0 - W, L, W, 'lid', mm(2.5), { read: 180 }),
    panel('tuck-top', 'Top tuck', xBack, y0 - W - t, L, t, 'tuck', 0, { read: 180 }),
  );
  folds.push(fold(xBack, y0, xBack + L, y0), fold(xBack + mm(0.5), y0 - W, xBack + L - mm(0.5), y0 - W), fold(xSL + mm(0.5), y0, xSL + W - mm(0.5), y0), fold(xSR + mm(0.5), y0, xSR + W - mm(0.5), y0));

  // Bottom closure: on the front (reverse tuck) or on the back (straight tuck).
  const bx = reverse ? xFront : xBack;
  const bParent = reverse ? 'front' : 'back';
  nodes.push(node('lid-bottom', rectPoly(bx, y1, L, W), bParent, H(bx + L, y1, bx, y1), 90, [0.62, 0.82]));
  nodes.push(node('tuck-bottom', tuckFlap(bx, y1 + W, L, t, 1), 'lid-bottom', H(bx + L, y1 + W, bx, y1 + W), 92, [0.8, 0.98]));
  nodes.push(node('dust-bl', dustFlap(xSL, y1, W, dh, 1, false), 'side-l', H(xSL + W, y1, xSL, y1), 93, [0.44, 0.6]));
  nodes.push(node('dust-br', dustFlap(xSR, y1, W, dh, 1, true), 'side-r', H(xSR + W, y1, xSR, y1), 93, [0.44, 0.6]));
  panels.push(
    panel('lid-bottom', 'Bottom', bx, y1, L, W, 'lid', mm(2.5), { read: reverse ? 0 : 180 }),
    panel('tuck-bottom', 'Bottom tuck', bx, y1 + W, L, t, 'tuck', 0),
  );
  folds.push(fold(bx, y1, bx + L, y1), fold(bx + mm(0.5), y1 + W, bx + L - mm(0.5), y1 + W), fold(xSL + mm(0.5), y1, xSL + W - mm(0.5), y1), fold(xSR + mm(0.5), y1, xSR + W - mm(0.5), y1));

  const n = normalise(nodes, panels, folds, zones);
  const ox = n.dx, oy = n.dy;
  return {
    surfaces: [{
      id: 'outside', label: reverse ? 'Reverse tuck end carton' : 'Straight tuck end carton',
      w: n.w, h: n.h, bleed: mm(3),
      cut: n.nodes.map((x) => x.poly), cutKind: 'die',
      folds: n.folds, panels: n.panels, zones: n.zones,
      dims: [
        dim(xFront + ox, y1 + oy, xFront + L + ox, y1 + oy, mm(9) + (reverse ? W + t : 0), `L ${fmtMm(L)}`),
        dim(xSR + ox, y1 + oy, xSR + W + ox, y1 + oy, mm(9), `W ${fmtMm(W)}`),
        dim(xSR + W + ox, y0 + oy, xSR + W + ox, y1 + oy, mm(9), `D ${fmtMm(D)}`),
        dim(ox, oy - W - t, n.w + ox, oy - W - t, -mm(9), `Flat ${fmtMm(n.w)} × ${fmtMm(n.h)}`),
      ],
      substrate: board.outside, defaultGround: board.value === 'kraft' || board.value === 'corrugated' ? null : '#ffffff',
      net: n.nodes,
      notes: ['Artwork on the top lid reads upside down in the flat (the lid hinges at the back).', `Board: ${board.label}, ${board.caliper} mm caliper.`],
    }],
    specs: [
      { label: 'Style', value: reverse ? 'Reverse tuck end (RTE)' : 'Straight tuck end (STE)' },
      { label: 'Inside L × W × D', value: `${fmtMm(L)} × ${fmtMm(W)} × ${fmtMm(D)}` },
      { label: 'Flat sheet', value: `${fmtMm(n.w)} × ${fmtMm(n.h)}` },
      { label: 'Board', value: `${board.label} · ${board.caliper} mm` },
    ],
  };
}

const DIM_OPTIONS = (L: number, W: number, D: number) => [
  { key: 'length', label: 'Length (L)', group: 'Size' as const, kind: 'length' as const, default: mm(L), min: mm(15), max: mm(600) },
  { key: 'width', label: 'Width (W)', group: 'Size' as const, kind: 'length' as const, default: mm(W), min: mm(10), max: mm(400) },
  { key: 'depth', label: 'Depth (D)', group: 'Size' as const, kind: 'length' as const, default: mm(D), min: mm(10), max: mm(600) },
];

export const TUCK_TEMPLATE: ProductTemplate = {
  id: 'tuck-reverse',
  name: 'Tuck box · reverse tuck end',
  category: 'Boxes',
  description: 'Reverse tuck end folding carton (top tuck from the back, bottom tuck from the front), generated from L × W × D.',
  options: [...DIM_OPTIONS(60, 40, 140), { key: 'board', label: 'Board', group: 'Material', kind: 'select', default: 'sbs', choices: BOARDS.map((b) => ({ value: b.value, label: b.label })) }, FINISH_OPTION],
  dieline: (o) => tuckCarton(o, true),
  animations: ['fold', 'turntable', 'hero', 'float'],
};

export const STRAIGHT_TUCK_TEMPLATE: ProductTemplate = {
  ...TUCK_TEMPLATE,
  id: 'tuck-straight',
  name: 'Tuck box · straight tuck end',
  description: 'Straight tuck end folding carton: both closures hinge on the back panel and tuck in at the front.',
  dieline: (o) => tuckCarton(o, false),
};

/* -------------------------------------------------------------------------- */
/* Mailer box (roll end tuck front)                                            */
/* -------------------------------------------------------------------------- */

export function mailerBox(o: Opts): Dieline {
  const L = num(o, 'length', mm(220)), W = num(o, 'width', mm(160)), D = num(o, 'depth', mm(70));
  const board = boardOf(o);
  const c = mm(board.caliper);
  const ear = Math.min(W * 0.42, D * 1.1);
  const tk = D * 0.82, ld = D * 0.86;
  // Column / row origins (base at the centre).
  const xb = 0, yb = 0;
  const nodes: NetNode[] = [];
  const panels: DielinePanel[] = [];
  const folds: FoldLine[] = [];
  nodes.push(node('base', rectPoly(xb, yb, L, W), null, null, 0, [0, 0]));
  // Front wall + inner front (folds over into the box).
  nodes.push(node('front', rectPoly(xb, yb + W, L, D), 'base', H(xb + L, yb + W, xb, yb + W), 90, [0, 0.25]));
  nodes.push(node('front-in', rectPoly(xb + c * 2, yb + W + D, L - c * 4, D - c), 'front', H(xb + L - c * 2, yb + W + D, xb + c * 2, yb + W + D), 178, [0.42, 0.6]));
  // Back wall, lid, lid tuck.
  nodes.push(node('back', rectPoly(xb, yb - D, L, D), 'base', H(xb, yb, xb + L, yb), 90, [0, 0.25]));
  nodes.push(node('lid', rectPoly(xb, yb - D - W - c, L, W + c), 'back', H(xb, yb - D, xb + L, yb - D), 90, [0.7, 0.88]));
  nodes.push(node('lid-tuck', tuckFlap(xb + mm(1), yb - D - W - c, L - mm(2), tk, -1), 'lid', H(xb, yb - D - W - c, xb + L, yb - D - W - c), 91, [0.82, 0.98]));
  // Ears on the ends of the front and back walls.
  const earPoly = (x: number, y: number, dir: -1 | 1) => {
    const x2 = x + dir * ear;
    return [{ x, y: y + mm(0.5) }, { x: x2, y: y + mm(4) }, { x: x2, y: y + D - mm(1) }, { x, y: y + D - mm(0.5) }];
  };
  nodes.push(node('ear-bl', earPoly(xb, yb - D, -1), 'back', H(xb, yb - D, xb, yb), 92, [0.25, 0.4]));
  nodes.push(node('ear-br', earPoly(xb + L, yb - D, 1), 'back', H(xb + L, yb, xb + L, yb - D), 92, [0.25, 0.4]));
  nodes.push(node('ear-fl', earPoly(xb, yb + W, -1), 'front', H(xb, yb + W, xb, yb + W + D), 92, [0.25, 0.4]));
  nodes.push(node('ear-fr', earPoly(xb + L, yb + W, 1), 'front', H(xb + L, yb + W + D, xb + L, yb + W), 92, [0.25, 0.4]));
  // Double side walls.
  nodes.push(node('side-l', rectPoly(xb - D, yb, D, W), 'base', H(xb, yb + W, xb, yb), 90, [0.3, 0.45]));
  nodes.push(node('side-l-in', rectPoly(xb - 2 * D + c, yb + c, D - c, W - 2 * c), 'side-l', H(xb - D, yb + W - c, xb - D, yb + c), 178, [0.45, 0.62]));
  nodes.push(node('side-r', rectPoly(xb + L, yb, D, W), 'base', H(xb + L, yb, xb + L, yb + W), 90, [0.3, 0.45]));
  nodes.push(node('side-r-in', rectPoly(xb + L + D, yb + c, D - c, W - 2 * c), 'side-r', H(xb + L + D, yb + c, xb + L + D, yb + W - c), 178, [0.45, 0.62]));
  // Lid dust flaps.
  const lidY = yb - D - W - c;
  const lidFlap = (x: number, dir: -1 | 1): P2[] => {
    const x2 = x + dir * ld;
    return [{ x, y: lidY + mm(1) }, { x: x2 + -dir * ld * 0.35, y: lidY + mm(1) }, { x: x2, y: lidY + W * 0.3 }, { x: x2, y: lidY + W + c - mm(1) }, { x, y: lidY + W + c - mm(1) }];
  };
  nodes.push(node('lid-l', lidFlap(xb, -1), 'lid', H(xb, lidY + W + c, xb, lidY), 92, [0.72, 0.86]));
  nodes.push(node('lid-r', lidFlap(xb + L, 1), 'lid', H(xb + L, lidY, xb + L, lidY + W + c), 92, [0.72, 0.86]));

  panels.push(
    panel('lid', 'Lid (top)', xb, lidY, L, W + c, 'lid', mm(4), { read: 180 }),
    panel('lid-tuck', 'Lid front flap', xb, lidY - tk, L, tk, 'tuck', mm(2), { read: 180 }),
    panel('back', 'Back wall', xb, yb - D, L, D, 'face', mm(3)),
    panel('base', 'Base (outside bottom)', xb, yb, L, W, 'face', mm(4)),
    panel('front', 'Front wall', xb, yb + W, L, D, 'face', mm(3), { read: 180 }),
    panel('front-in', 'Inner front', xb + 2 * c, yb + W + D, L - 4 * c, D - c, 'zone', mm(3)),
    panel('side-l', 'Left wall', xb - D, yb, D, W, 'side', mm(3), { read: 270 }),
    panel('side-r', 'Right wall', xb + L, yb, D, W, 'side', mm(3), { read: 90 }),
  );
  folds.push(
    fold(xb, yb, xb + L, yb), fold(xb, yb + W, xb + L, yb + W), fold(xb + 2 * c, yb + W + D, xb + L - 2 * c, yb + W + D),
    fold(xb, yb - D, xb + L, yb - D), fold(xb, lidY, xb + L, lidY),
    fold(xb, yb, xb, yb + W), fold(xb + L, yb, xb + L, yb + W), fold(xb - D, yb + c, xb - D, yb + W - c), fold(xb + L + D, yb + c, xb + L + D, yb + W - c),
    fold(xb, yb - D, xb, yb), fold(xb + L, yb - D, xb + L, yb), fold(xb, yb + W, xb, yb + W + D), fold(xb + L, yb + W, xb + L, yb + W + D),
    fold(xb, lidY, xb, lidY + W + c), fold(xb + L, lidY, xb + L, lidY + W + c),
  );
  const n = normalise(nodes, panels, folds, []);
  return {
    surfaces: [{
      id: 'outside', label: 'Mailer box (outside)', w: n.w, h: n.h, bleed: mm(3),
      cut: n.nodes.map((x) => x.poly), cutKind: 'die', folds: n.folds, panels: n.panels, zones: n.zones,
      dims: [
        dim(n.dx, n.dy + W, n.dx + L, n.dy + W, mm(8) + D + D, `L ${fmtMm(L)}`),
        dim(n.dx + L, n.dy, n.dx + L, n.dy + W, mm(8) + 2 * D, `W ${fmtMm(W)}`),
        dim(n.dx - D, n.dy + W, n.dx, n.dy + W, mm(8), `D ${fmtMm(D)}`),
      ],
      substrate: board.outside, defaultGround: board.value === 'kraft' || board.value === 'corrugated' ? null : '#ffffff', net: n.nodes,
      notes: ['Roll-end tuck-front mailer: double side walls lock the ears; the lid tucks in at the front.'],
    }],
    specs: [
      { label: 'Style', value: 'Roll end tuck front (RETF) mailer' },
      { label: 'Inside L × W × D', value: `${fmtMm(L)} × ${fmtMm(W)} × ${fmtMm(D)}` },
      { label: 'Flat sheet', value: `${fmtMm(n.w)} × ${fmtMm(n.h)}` },
      { label: 'Board', value: `${board.label} · ${board.caliper} mm` },
    ],
  };
}

export const MAILER_TEMPLATE: ProductTemplate = {
  id: 'mailer',
  name: 'Mailer box',
  category: 'Boxes',
  description: 'Roll-end tuck-front e-commerce mailer with double side walls, ears and a tucking lid.',
  options: [...DIM_OPTIONS(220, 160, 70), { key: 'board', label: 'Board', group: 'Material', kind: 'select', default: 'corrugated', choices: BOARDS.map((b) => ({ value: b.value, label: b.label })) }, FINISH_OPTION],
  dieline: mailerBox,
  animations: ['fold', 'hero', 'turntable', 'float'],
};

/* -------------------------------------------------------------------------- */
/* Pillow box                                                                   */
/* -------------------------------------------------------------------------- */

export function pillowGeometry(o: Opts) {
  const L = num(o, 'length', mm(160)), W = num(o, 'width', mm(90)), T = num(o, 'thickness', mm(30));
  // Depth of the curved end creases: the ends close when the crease sagitta ≈ thickness/2.
  const e = Math.min(W * 0.35, Math.max(T * 0.62, mm(8)));
  return { L, W, T, e };
}

function pillowBox(o: Opts): Dieline {
  const { L, W, e } = pillowGeometry(o);
  const board = boardOf(o);
  const g = mm(12);
  // Rows: glue | front | back; ends at x = 0 and x = L bulge outward by e (cut) and inward (crease).
  const lens = (y0: number, h: number, x: number, dir: -1 | 1) => {
    const pts: P2[] = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const s = Math.sin(Math.PI * t);
      pts.push({ x: x + dir * e * s, y: y0 + h * t });
    }
    return pts;
  };
  const piece = (y0: number, h: number): P2[] => {
    const right = lens(y0, h, L, 1);
    const left = lens(y0, h, 0, -1).reverse();
    return [...right, ...left];
  };
  const pieces = [piece(g, W), piece(g + W, W)];
  const glue = [{ x: mm(4), y: g }, { x: mm(10), y: 0 }, { x: L - mm(10), y: 0 }, { x: L - mm(4), y: g }];
  const folds: FoldLine[] = [fold(0, g, L, g), fold(0, g + W, L, g + W)];
  for (const y0 of [g, g + W]) {
    folds.push({ pts: lens(y0, W, L, -1), kind: 'crease' }, { pts: lens(y0, W, 0, 1), kind: 'crease' });
  }
  const all = [glue, ...pieces];
  const b = polyBounds(all);
  const dx = -b.x;
  const sh = (p: P2[]) => translatePoly(p, dx, 0);
  return {
    surfaces: [{
      id: 'outside', label: 'Pillow box', w: b.w, h: b.h, bleed: mm(3),
      cut: all.map(sh), cutKind: 'die',
      folds: folds.map((f) => ({ ...f, pts: sh(f.pts) })),
      panels: [
        panel('front', 'Front', dx, g, L, W, 'face', mm(3) + e * 0.3),
        panel('back', 'Back', dx, g + W, L, W, 'face', mm(3) + e * 0.3),
        panel('glue', 'Glue flap', dx, 0, L, g, 'glue', 0),
      ],
      zones: [zone('glue', 'Glue', sh(glue))],
      dims: [dim(dx, g + 2 * W, dx + L, g + 2 * W, mm(8) + e, `L ${fmtMm(L)}`), dim(dx + L, g, dx + L, g + W, mm(8) + e, `W ${fmtMm(W)}`)],
      substrate: board.outside, defaultGround: board.value === 'kraft' ? null : '#ffffff',
      notes: ['The curved creases at each end fold in to close the pillow; keep copy away from the ends.'],
    }],
    specs: [
      { label: 'Style', value: 'Pillow box' },
      { label: 'Size L × W', value: `${fmtMm(L)} × ${fmtMm(W)}` },
      { label: 'Flat sheet', value: `${fmtMm(b.w)} × ${fmtMm(b.h)}` },
    ],
  };
}

export const PILLOW_TEMPLATE: ProductTemplate = {
  id: 'pillow',
  name: 'Pillow box',
  category: 'Boxes',
  description: 'Gift pillow box with curved end creases.',
  options: [
    { key: 'length', label: 'Length', group: 'Size', kind: 'length', default: mm(160), min: mm(50), max: mm(400) },
    { key: 'width', label: 'Width', group: 'Size', kind: 'length', default: mm(90), min: mm(30), max: mm(250) },
    { key: 'thickness', label: 'Thickness (closed)', group: 'Size', kind: 'length', default: mm(30), min: mm(8), max: mm(90) },
    { key: 'board', label: 'Board', group: 'Material', kind: 'select', default: 'kraft', choices: BOARDS.filter((b) => b.value !== 'corrugated').map((b) => ({ value: b.value, label: b.label })) },
    FINISH_OPTION,
  ],
  dieline: pillowBox,
  animations: ['fold', 'turntable', 'float', 'hero'],
};

/* -------------------------------------------------------------------------- */
/* Sleeve                                                                       */
/* -------------------------------------------------------------------------- */

function sleeve(o: Opts): Dieline {
  const L = num(o, 'length', mm(180)), W = num(o, 'width', mm(35)), D = num(o, 'depth', mm(120));
  const board = boardOf(o);
  const g = Math.min(mm(14), W * 0.8);
  // A sleeve runs around L × W (the tray's footprint) and is D wide: panels are L (top/bottom) and W (edges).
  const xTop = g, xEdgeR = g + L, xBottom = g + L + W, xEdgeL = g + 2 * L + W;
  const nodes: NetNode[] = [
    node('top', rectPoly(xTop, 0, L, D), null, null, 0, [0, 0]),
    node('edge-r', rectPoly(xEdgeR, 0, W, D), 'top', H(xEdgeR, 0, xEdgeR, D), 90, [0, 0.35]),
    node('bottom', rectPoly(xBottom, 0, L, D), 'edge-r', H(xBottom, 0, xBottom, D), 90, [0.15, 0.55]),
    node('edge-l', rectPoly(xEdgeL, 0, W, D), 'bottom', H(xEdgeL, 0, xEdgeL, D), 90, [0.35, 0.75]),
    node('glue', glueFlap(0, 0, g, D, 'left'), 'top', H(xTop, D, xTop, 0), 91.5, [0.5, 0.9]),
  ];
  const panels = [
    // The edges turn down (right) and up (left) from the top panel: their art reads sideways,
    // opposite ways round, so both read upright on the finished sleeve.
    panel('top', 'Top (front)', xTop, 0, L, D, 'face'), panel('edge-r', 'Right edge', xEdgeR, 0, W, D, 'side', mm(3), { read: 270 }),
    panel('bottom', 'Bottom (back)', xBottom, 0, L, D, 'face'), panel('edge-l', 'Left edge', xEdgeL, 0, W, D, 'side', mm(3), { read: 90 }),
    panel('glue', 'Glue flap', 0, 0, g, D, 'glue', 0),
  ];
  const folds = [xTop, xEdgeR, xBottom, xEdgeL].map((x) => fold(x, 0, x, D));
  const w = g + 2 * L + 2 * W;
  return {
    surfaces: [{
      id: 'outside', label: 'Sleeve', w, h: D, bleed: mm(3), cut: nodes.map((x) => x.poly), cutKind: 'die', folds, panels,
      zones: [zone('glue', 'Glue', glueFlap(0, 0, g, D, 'left'))],
      dims: [dim(xTop, D, xTop + L, D, mm(8), `L ${fmtMm(L)}`), dim(xEdgeR, D, xEdgeR + W, D, mm(8), `W ${fmtMm(W)}`), dim(w, 0, w, D, mm(8), `D ${fmtMm(D)}`)],
      substrate: board.outside, defaultGround: board.value === 'kraft' ? null : '#ffffff', net: nodes,
      notes: ['The sleeve slides over a tray of L × W × D; the open ends show the tray.'],
    }],
    specs: [{ label: 'Sleeve around', value: `${fmtMm(L)} × ${fmtMm(W)}, ${fmtMm(D)} deep` }, { label: 'Flat sheet', value: `${fmtMm(w)} × ${fmtMm(D)}` }],
  };
}

export const SLEEVE_TEMPLATE: ProductTemplate = {
  id: 'sleeve',
  name: 'Sleeve & tray',
  category: 'Boxes',
  description: 'Printed sleeve that slides over a plain tray (chocolate, soap, tea).',
  options: [
    { key: 'length', label: 'Length (L)', group: 'Size', kind: 'length', default: mm(180), min: mm(30), max: mm(500) },
    { key: 'width', label: 'Thickness (W)', group: 'Size', kind: 'length', default: mm(35), min: mm(8), max: mm(200) },
    { key: 'depth', label: 'Depth (D)', group: 'Size', kind: 'length', default: mm(120), min: mm(20), max: mm(400) },
    { key: 'board', label: 'Board', group: 'Material', kind: 'select', default: 'sbs', choices: BOARDS.filter((b) => b.value !== 'corrugated').map((b) => ({ value: b.value, label: b.label })) },
    { key: 'tray', label: 'Tray colour', group: 'Material', kind: 'color', default: '#efe9df' },
    FINISH_OPTION,
  ],
  dieline: sleeve,
  animations: ['fold', 'slide', 'turntable', 'hero'],
};

/* -------------------------------------------------------------------------- */
/* Paper carrier bag                                                           */
/* -------------------------------------------------------------------------- */

export const BAG_PAPERS = [
  { value: 'kraft', label: 'Brown kraft (100 g)' },
  { value: 'sbs', label: 'White kraft (120 g)' },
  { value: 'black', label: 'Black paper (150 g)' },
];

/**
 * Self-opening (SOS) paper carrier bag from width × gusset × height: glue flap | front | gusset |
 * back | gusset, a top turn-in that folds inside (it carries the handles), and the bottom flaps
 * that fold under to close the base. The gussets crease down their middle when the bag lies flat.
 */
export function paperBag(o: Opts): Dieline {
  const W = num(o, 'width', mm(240)), G = num(o, 'gusset', mm(110)), Hh = num(o, 'height', mm(310));
  const board = boardOf(o);
  const g = mm(18); // glue flap
  const T = Math.min(mm(45), Hh * 0.2); // top turn-in
  const B = G * 0.75; // bottom flaps
  const xFront = g, xGr = g + W, xBack = g + W + G, xGl = g + 2 * W + G;
  const y0 = T, y1 = T + Hh;
  const nodes: NetNode[] = [];
  const panels: DielinePanel[] = [];
  const folds: FoldLine[] = [];
  const zones: Zone[] = [];
  // Body: front (root), right gusset, back, left gusset; the glue flap tucks inside the left gusset.
  nodes.push(node('front', rectPoly(xFront, y0, W, Hh), null, null, 0, [0, 0]));
  nodes.push(node('gusset-r', rectPoly(xGr, y0, G, Hh), 'front', H(xGr, y0, xGr, y1), 90, [0, 0.3]));
  nodes.push(node('back', rectPoly(xBack, y0, W, Hh), 'gusset-r', H(xBack, y0, xBack, y1), 90, [0.08, 0.38]));
  nodes.push(node('gusset-l', rectPoly(xGl, y0, G, Hh), 'back', H(xGl, y0, xGl, y1), 90, [0.16, 0.46]));
  nodes.push(node('glue', glueFlap(0, y0, g, Hh, 'left'), 'front', H(xFront, y1, xFront, y0), 92, [0.2, 0.5]));
  // Top turn-ins fold right over to the inside.
  for (const [id, x, w, parent] of [['front', xFront, W, 'front'], ['gusset-r', xGr, G, 'gusset-r'], ['back', xBack, W, 'back'], ['gusset-l', xGl, G, 'gusset-l']] as const) {
    nodes.push(node(`tuck-${id}`, rectPoly(x + mm(0.5), 0, w - mm(1), T), parent, H(x + w, y0, x, y0), 178, [0.5, 0.66]));
    folds.push(fold(x, y0, x + w, y0, 'reverse'));
  }
  // Base: the front and back flaps meet under the bag; the gusset flaps fold in first.
  nodes.push(node('dust-gr', rectPoly(xGr + mm(0.5), y1, G - mm(1), G * 0.48), 'gusset-r', H(xGr, y1, xGr + G, y1), 90, [0.62, 0.74]));
  nodes.push(node('dust-gl', rectPoly(xGl + mm(0.5), y1, G - mm(1), G * 0.48), 'gusset-l', H(xGl, y1, xGl + G, y1), 90, [0.62, 0.74]));
  nodes.push(node('base-back', rectPoly(xBack, y1, W, G * 0.55), 'back', H(xBack, y1, xBack + W, y1), 90, [0.72, 0.86]));
  nodes.push(node('base-front', rectPoly(xFront, y1, W, B), 'front', H(xFront, y1, xFront + W, y1), 92, [0.82, 0.98]));
  for (const x of [xFront, xGr, xBack, xGl]) folds.push(fold(x, y0, x, y1));
  // The gussets' bellows crease (folds flat) and the base creases.
  for (const x of [xGr, xGl]) folds.push(fold(x + G / 2, y0, x + G / 2, y1, 'reverse'), fold(x + G / 2, y1, x, y1 + G / 2, 'crease'), fold(x + G / 2, y1, x + G, y1 + G / 2, 'crease'));
  folds.push(fold(0, y1, xGl + G, y1));
  panels.push(
    panel('front', 'Front', xFront, y0, W, Hh, 'face', mm(10)),
    panel('gusset-r', 'Right gusset', xGr, y0, G, Hh, 'side', mm(8)),
    panel('back', 'Back', xBack, y0, W, Hh, 'face', mm(10)),
    panel('gusset-l', 'Left gusset', xGl, y0, G, Hh, 'side', mm(8)),
    panel('glue', 'Glue flap', 0, y0, g, Hh, 'glue', 0),
    panel('turn-in', 'Top turn-in (inside)', 0, 0, xGl + G, T, 'tuck', 0),
    panel('base', 'Base flaps', 0, y1, xGl + G, B, 'tuck', 0),
  );
  zones.push(zone('glue', 'Glue', glueFlap(0, y0, g, Hh, 'left')));
  zones.push(zone('nonprint', 'Turn-in (inside the bag)', rectPoly(0, 0, xGl + G, T)));
  const n = normalise(nodes, panels, folds, zones);
  return {
    surfaces: [{
      id: 'outside', label: 'Paper bag', w: n.w, h: n.h, bleed: mm(3),
      cut: n.nodes.map((x) => x.poly), cutKind: 'die', folds: n.folds, panels: n.panels, zones: n.zones,
      dims: [
        dim(xFront + n.dx, y1 + B + n.dy, xFront + W + n.dx, y1 + B + n.dy, mm(9), `W ${fmtMm(W)}`),
        dim(xGr + n.dx, y1 + B + n.dy, xGr + G + n.dx, y1 + B + n.dy, mm(9), `G ${fmtMm(G)}`),
        dim(xGl + G + n.dx, y0 + n.dy, xGl + G + n.dx, y1 + n.dy, mm(9), `H ${fmtMm(Hh)}`),
      ],
      substrate: board.outside, defaultGround: board.value === 'kraft' ? null : board.value === 'black' ? null : '#ffffff', net: n.nodes,
      notes: ['The turn-in folds inside at the top and carries the handles; the base flaps fold under. Keep copy clear of the gussets’ centre crease.'],
    }],
    specs: [
      { label: 'Style', value: 'SOS carrier bag with turn-in top' },
      { label: 'W × G × H', value: `${fmtMm(W)} × ${fmtMm(G)} × ${fmtMm(Hh)}` },
      { label: 'Flat sheet', value: `${fmtMm(n.w)} × ${fmtMm(n.h)}` },
      { label: 'Paper', value: BAG_PAPERS.find((p) => p.value === board.value)?.label ?? board.label },
    ],
  };
}

export const PAPER_BAG_TEMPLATE: ProductTemplate = {
  id: 'paper-bag',
  name: 'Paper carrier bag',
  category: 'Bags',
  description: 'Retail paper bag (SOS) with gussets, a turn-in top, twisted or flat paper handles and a folded base.',
  options: [
    { key: 'width', label: 'Width (W)', group: 'Size', kind: 'length', default: mm(240), min: mm(120), max: mm(500) },
    { key: 'gusset', label: 'Gusset (G)', group: 'Size', kind: 'length', default: mm(110), min: mm(50), max: mm(250) },
    { key: 'height', label: 'Height (H)', group: 'Size', kind: 'length', default: mm(310), min: mm(150), max: mm(600) },
    { key: 'board', label: 'Paper', group: 'Material', kind: 'select', default: 'kraft', choices: BAG_PAPERS },
    { key: 'handles', label: 'Handles', group: 'Construction', kind: 'select', default: 'twisted', choices: [{ value: 'twisted', label: 'Twisted paper rope' }, { value: 'flat', label: 'Flat paper tape' }, { value: 'none', label: 'None' }] },
    { key: 'handleColor', label: 'Handle colour', group: 'Construction', kind: 'color', default: '#a47b4f', when: (o) => o.handles !== 'none' },
    FINISH_OPTION,
  ],
  dieline: paperBag,
  animations: ['fold', 'turntable', 'sway', 'hero', 'float'],
};
