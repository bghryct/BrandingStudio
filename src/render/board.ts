/**
 * The brand board: one composition with the logo, palette (HEX / CMYK / spot), typefaces and
 * every product's flat artwork. Built as display-list primitives, so the same board shows on
 * screen and exports as SVG or PNG.
 */
import type { Project, Element } from '../model/types';
import type { Prim } from './primitives';
import { rectPath, translate, multiply, scale } from './primitives';
import { compileElementLocal, compileSurface, elementMatrix, type CompileContext } from './compile';
import { makeLogo, makeText, textStyle } from '../model/factory';
import { dielineOf, getTemplate, surfaceOf } from '../products';
import { luminance, rgbToCmyk } from '../lib/color';
import { getFamily } from '../engine/fonts';

export const BOARD = { w: 1600, h: 1000 };

const ink = (bg: string) => (luminance(bg) > 0.45 ? '#16151a' : '#ffffff');

export function boardPrims(project: Project): Prim[] {
  const k = project.brand;
  const ctx: CompileContext = { project, product: null, surface: null };
  const out: Prim[] = [];
  const role = (r: string, d: string) => k.palette.find((s) => s.role === r)?.hex ?? d;
  const primary = role('primary', '#16151a'), bgc = role('background', '#ffffff');
  const place = (el: Element) => { out.push({ t: 'group', matrix: elementMatrix(el), opacity: el.opacity, children: compileElementLocal(el, ctx) }); };
  const text = (t: string, x: number, y: number, w: number, h: number, st: Parameters<typeof textStyle>[0], fit = false) => place(makeText({ text: t, x, y, w, h, autoFit: fit, style: textStyle({ hyphenate: false, ...st }) }));

  out.push({ t: 'path', d: rectPath(0, 0, BOARD.w, BOARD.h), fill: '#f4f2ee' });
  // Brand panel.
  out.push({ t: 'path', d: rectPath(0, 0, 520, BOARD.h), fill: primary });
  const on = ink(primary);
  place(makeLogo({ variant: 'stacked', x: 90, y: 230, w: 340, h: 300, color: on, color2: role('accent', '#e8483b') }));
  text(k.tagline, 60, 580, 400, 40, { fontFamily: k.fonts.body, fontSize: 15, leading: 18, weight: 600, tracking: 200, textTransform: 'uppercase', align: 'center', color: on });
  text('Brand board', 60, 930, 400, 20, { fontFamily: k.fonts.body, fontSize: 10, leading: 12, tracking: 120, textTransform: 'uppercase', align: 'center', color: on });

  // Palette.
  const x0 = 580, pw = (BOARD.w - x0 - 60) / Math.max(1, k.palette.length);
  text('Colour', x0, 50, 300, 20, { fontFamily: k.fonts.body, fontSize: 11, leading: 13, weight: 700, tracking: 160, textTransform: 'uppercase', color: '#16151a' });
  k.palette.forEach((s, i) => {
    const x = x0 + i * pw;
    out.push({ t: 'path', d: rectPath(x, 80, pw - 12, 150, 6), fill: s.hex, stroke: luminance(s.hex) > 0.85 ? '#d8d4cc' : null, strokeWidth: 1 });
    const c = s.cmyk ?? rgbToCmyk(s.hex);
    const lab = ink(s.hex);
    text(s.name, x + 12, 92, pw - 36, 20, { fontFamily: k.fonts.body, fontSize: 12, leading: 14, weight: 700, color: lab });
    text(`${s.hex.toUpperCase()}\nC${Math.round(c.c)} M${Math.round(c.m)} Y${Math.round(c.y)} K${Math.round(c.k)}${s.spot ? `\n${s.spot}` : ''}`, x + 12, 170, pw - 36, 54, { fontFamily: 'ibm-plex-mono', fontSize: 8.5, leading: 11, color: lab });
  });

  // Type.
  text('Typography', x0, 270, 300, 20, { fontFamily: k.fonts.body, fontSize: 11, leading: 13, weight: 700, tracking: 160, textTransform: 'uppercase', color: '#16151a' });
  const hf = getFamily(k.fonts.headline), bf = getFamily(k.fonts.body);
  text('Aa', x0, 300, 190, 120, { fontFamily: k.fonts.headline, fontSize: 110, leading: 112, weight: Math.max(600, k.logo.weight), color: primary }, true);
  text(`${hf.name}\nHeadlines & logo`, x0 + 200, 330, 260, 60, { fontFamily: k.fonts.body, fontSize: 12, leading: 16, color: '#16151a' });
  text('Aa', x0 + 500, 300, 190, 120, { fontFamily: k.fonts.body, fontSize: 110, leading: 112, weight: 400, color: '#16151a' }, true);
  text(`${bf.name}\nBody, legal & small print`, x0 + 700, 330, 260, 60, { fontFamily: k.fonts.body, fontSize: 12, leading: 16, color: '#16151a' });
  text('ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 &!?', x0 + 200, 400, 760, 40, { fontFamily: k.fonts.headline, fontSize: 13, leading: 18, color: '#3a3940' });

  // Products.
  text('Range', x0, 470, 300, 20, { fontFamily: k.fonts.body, fontSize: 11, leading: 13, weight: 700, tracking: 160, textTransform: 'uppercase', color: '#16151a' });
  const products = project.products.slice(0, 8);
  const cols = 4, gap = 16;
  const cw = (BOARD.w - x0 - 60 - gap * (cols - 1)) / cols, ch = 220;
  products.forEach((p, i) => {
    const cx = x0 + (i % cols) * (cw + gap), cy = 500 + Math.floor(i / cols) * (ch + gap);
    out.push({ t: 'path', d: rectPath(cx, cy, cw, ch, 6), fill: '#e7e4de' });
    const s = dielineOf(p).surfaces[0];
    if (s) {
      const sf = surfaceOf(p, s.id)!;
      const b = sf.bleed;
      const bw = sf.w + 2 * b, bh = sf.h + 2 * b;
      const sc = Math.min((cw - 28) / bw, (ch - 58) / bh);
      const ox = cx + (cw - bw * sc) / 2 + b * sc, oy = cy + 12 + ((ch - 58) - bh * sc) / 2 + b * sc;
      out.push({ t: 'group', matrix: multiply(translate(ox, oy), scale(sc)), children: compileSurface(project, p, s.id, { substrate: true }) });
    }
    text(p.name, cx + 12, cy + ch - 40, cw - 24, 16, { fontFamily: k.fonts.body, fontSize: 11, leading: 13, weight: 700, color: '#16151a' });
    text(getTemplate(p.template).name, cx + 12, cy + ch - 23, cw - 24, 14, { fontFamily: k.fonts.body, fontSize: 9, leading: 11, color: '#6b6870' });
  });
  void bgc;
  return out;
}
