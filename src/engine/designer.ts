/**
 * Generative starter designs. From a brand kit, its copy and a "look", lay out every surface of a
 * product panel by panel: hero fronts, back panels with copy and a barcode, rotated wordmarks on
 * narrow sides, logos on lids, neck bands, garment prints, business cards and letterheads. All
 * items are anchored to their panels so they follow the dieline when its dimensions change.
 */
import type { BrandKit, Element, Product, SurfaceArt, TextStyle } from '../model/types';
import type { BrandCopy, BrandLook } from '../model/brands';
import type { DielinePanel, DielineSurface } from '../products/types';
import { dielineOf, optionsOf } from '../products';
import { makeBarcode, makeLogo, makePattern, makeRule, makeShape, makeText, textStyle } from '../model/factory';
import { luminance, mix } from '../lib/color';
import { mm } from '../model/units';
import { canGeometry } from '../products/cans';
import { bottleDef } from '../products/bottles';
import { cupGeometry } from '../products/drinkware';

export interface DesignInput { kit: BrandKit; copy: BrandCopy; look: BrandLook; variant: number }

const contrast = (a: string, b: string) => {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

class Palette {
  constructor(private kit: BrandKit) {}
  role(r: string, fallback: string) { return this.kit.palette.find((s) => s.role === r)?.hex ?? fallback; }
  get primary() { return this.role('primary', '#16151a'); }
  get secondary() { return this.role('secondary', '#e8c9a0'); }
  get accent() { return this.role('accent', '#e8483b'); }
  get neutral() { return this.role('neutral', '#16151a'); }
  get background() { return this.role('background', '#ffffff'); }
  /** The palette colour that reads best on a ground (prefers the brand primary). */
  ink(bg: string): string {
    const order = [this.primary, this.neutral, this.background, '#ffffff', this.secondary, '#16151a'];
    for (const c of order) if (contrast(c, bg) >= 4.2) return c;
    return luminance(bg) > 0.4 ? '#16151a' : '#ffffff';
  }
  /** A second colour for accents on a ground (falls back to the ink). */
  pop(bg: string): string {
    for (const c of [this.accent, this.secondary, this.primary]) if (contrast(c, bg) >= 2.4 && c.toLowerCase() !== bg.toLowerCase()) return c;
    for (const c of [this.secondary, this.accent, this.background]) if (contrast(c, bg) >= 1.6 && c.toLowerCase() !== bg.toLowerCase()) return c;
    return this.ink(bg);
  }
}

interface Ctx {
  product: Product;
  surface: DielineSurface;
  input: DesignInput;
  pal: Palette;
  /** Printed ground of this surface (or the substrate when nothing is printed under the art). */
  bg: string;
  ink: string;
  pop: string;
  name: string;
  size: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function txt(text: string, x: number, y: number, w: number, h: number, style: Partial<TextStyle>, extra: Partial<Element> = {}): Element {
  return makeText({ text, x, y, w, h, style: textStyle(style), ...(extra as object) });
}

function sizeLabel(product: Product): string {
  const o = optionsOf(product);
  switch (product.template) {
    case 'can': { const g = canGeometry(o); return `${g.size.ml} ml · ${g.size.oz}`; }
    case 'bottle': return `${bottleDef(o).ml} ml`;
    case 'cup': return cupGeometry(o).size.label;
    case 'perfume': return '50 ml e · 1.7 fl oz';
    case 'jar': return '60 ml · 2 fl oz';
    case 'pouch': return 'Net wt 250 g · 8.8 oz';
    default: return '';
  }
}

/* -------------------------------------------------------------------------- */
/* Panel compositions                                                          */
/* -------------------------------------------------------------------------- */

function margin(p: DielinePanel) {
  return Math.max(p.safe, clamp(Math.min(p.w, p.h) * 0.08, mm(2), mm(14)));
}

function hero(p: DielinePanel, c: Ctx): Element[] {
  const { kit, look } = c.input;
  const out: Element[] = [];
  const m = margin(p);
  const w = p.w - 2 * m, h = p.h - 2 * m;
  if (w < mm(10) || h < mm(10)) return out;
  const wide = p.w > p.h * 1.25;
  const left = look.layout === 'stack';
  const align = left ? 'left' as const : 'center' as const;
  const cx = p.w / 2;
  const descSize = clamp(Math.min(p.w, p.h) * 0.042, 5.5, 13);
  const descStyle: Partial<TextStyle> = { fontFamily: kit.fonts.body, fontSize: descSize, leading: descSize * 1.25, weight: 600, tracking: 140, textTransform: 'uppercase', align, color: c.ink };
  // Vertical stack: logo at the top, size line at the bottom, the "stage" (name + descriptor) between.
  const stacked = !wide && !left;
  const logoH = clamp(h * (wide ? 0.17 : 0.15), mm(4), mm(36));
  const logoBoxH = stacked ? logoH * 1.55 : logoH;
  const logoW = Math.min(w * (left ? 0.62 : 0.78), logoH * (stacked ? 2.2 : 4.4));
  const sizeH = c.size ? descSize * 1.6 : 0;
  const y0 = m + logoBoxH + h * 0.06;
  const y1 = p.h - m - sizeH - h * 0.04;
  const stageH = Math.max(h * 0.3, y1 - y0);
  const stageC = y0 + stageH / 2;
  let nameW = w, nameH = stageH * 0.5, nameX = m;
  let nameInk = c.ink, descInk = c.ink;
  if (look.layout === 'circle') {
    const d = Math.min(stageH * 1.04, w * 0.98);
    out.push(makeShape({ name: 'Disc', shape: 'ellipse', x: cx - d / 2, y: stageC - d / 2, w: d, h: d, fill: c.pop, anchor: p.id }));
    nameInk = descInk = c.pal.ink(c.pop);
    nameW = d * 0.8; nameX = cx - nameW / 2; nameH = d * 0.36;
  } else if (look.layout === 'band') {
    const bandFill = c.pal.primary.toLowerCase() === c.bg.toLowerCase() ? c.pal.neutral : c.pal.primary;
    const bh = stageH * 0.82;
    out.push(makeShape({ name: 'Band', shape: 'rect', x: -mm(3), y: stageC - bh / 2, w: p.w + mm(6), h: bh, fill: bandFill, anchor: p.id }));
    nameInk = descInk = c.pal.ink(bandFill);
    nameH = bh * 0.52;
  } else if (look.layout === 'frame') {
    const fm = m * 0.55;
    out.push(makeShape({ name: 'Frame', shape: 'rect', x: fm, y: fm, w: p.w - 2 * fm, h: p.h - 2 * fm, fill: null, stroke: c.pop, strokeWidth: clamp(Math.min(p.w, p.h) * 0.006, 0.5, 1.5), anchor: p.id, finish: look.foil ?? 'none' }));
    out.push(makeRule({ name: 'Rule', x: cx - w * 0.12, y: stageC - stageH * 0.34, w: w * 0.24, h: 4, stroke: c.pop, strokeWidth: 0.75, anchor: p.id, finish: look.foil ?? 'none' }));
  } else if (look.layout === 'split') {
    const top = stageC + stageH * 0.08;
    out.push(makeShape({ name: 'Split', shape: 'rect', x: -mm(3), y: top, w: p.w + mm(6), h: p.h - top + mm(3), fill: c.pal.secondary, anchor: p.id }));
    descInk = c.pal.ink(c.pal.secondary);
  } else if (look.layout === 'stack') {
    const s = Math.min(p.w, p.h) * 0.7;
    out.push(makeLogo({ name: 'Watermark', variant: 'mark', x: p.w - s * 0.72, y: p.h - s * 0.8, w: s, h: s, color: c.pop, color2: c.bg, opacity: 0.22, anchor: p.id }));
  }
  // Logo.
  out.push(makeLogo({ name: 'Logo', variant: stacked ? 'stacked' : 'lockup', x: left ? m : cx - logoW / 2, y: m, w: logoW, h: logoBoxH, color: c.ink, anchor: p.id, finish: look.foil ?? 'none' }));
  // Product name and descriptor in the stage.
  const nameSize = clamp(Math.min(nameH * 0.62, nameW * 0.22), 7, 110);
  const nameY = stageC - nameH * 0.62;
  out.push(txt(c.name, nameX, nameY, nameW, nameH, {
    fontFamily: kit.fonts.headline, weight: Math.max(500, kit.logo.weight), align, color: nameInk,
    tracking: look.caps ? 30 : -10, textTransform: look.caps ? 'uppercase' : 'none', fontSize: nameSize, leading: nameSize * 0.98,
  }, { name: 'Product name', anchor: p.id, autoFit: true, verticalAlign: 'bottom' }));
  out.push(txt(c.input.copy.descriptor, nameX, nameY + nameH + descSize * 0.5, nameW, descSize * 2.7, { ...descStyle, color: descInk }, { name: 'Descriptor', anchor: p.id, autoFit: true }));
  if (c.size) out.push(txt(c.size, m, p.h - m - sizeH, w, sizeH, { ...descStyle, fontSize: descSize * 0.85, weight: 500, tracking: 80, color: look.layout === 'split' ? c.pal.ink(c.pal.secondary) : c.ink }, { name: 'Size', anchor: p.id }));
  return out;
}

function back(p: DielinePanel, c: Ctx, withBarcode = true): Element[] {
  const { kit } = c.input;
  const out: Element[] = [];
  const m = margin(p);
  const w = p.w - 2 * m;
  if (w < mm(12) || p.h < mm(18)) return out;
  const fs = clamp(Math.min(p.w * 0.032, p.h * 0.04), 5, 9);
  const logoH = clamp(p.h * 0.1, mm(4), mm(16));
  out.push(makeLogo({ name: 'Logo', variant: 'lockup', x: m, y: m, w: Math.min(w, logoH * 4), h: logoH, color: c.ink, anchor: p.id }));
  let y = m + logoH + fs * 1.4;
  const blurbH = fs * 1.3 * 6;
  out.push(txt(c.input.copy.blurb, m, y, w, blurbH, { fontFamily: kit.fonts.body, fontSize: fs, leading: fs * 1.32, color: c.ink, hyphenate: true }, { name: 'Story', anchor: p.id }));
  y += blurbH + fs * 0.6;
  const bc = withBarcode && p.w > mm(34) && p.h > mm(40);
  const bcW = clamp(p.w * 0.36, mm(22), mm(34)), bcH = bcW * 0.7;
  const ingH = Math.max(fs * 2, p.h - y - m - (bc ? 0 : fs * 2));
  out.push(txt(c.input.copy.ingredients, m, y, bc ? w - bcW - fs : w, Math.min(ingH, fs * 1.25 * 7), { fontFamily: kit.fonts.body, fontSize: fs * 0.82, leading: fs * 1.05, color: c.ink }, { name: 'Ingredients', anchor: p.id }));
  if (bc) out.push(makeBarcode({ x: p.w - m - bcW, y: p.h - m - bcH, w: bcW, h: bcH, background: '#ffffff', anchor: p.id }));
  // One line where it fits beside the barcode, otherwise the recycling note drops to a second line.
  const webW = bc ? w - bcW - fs : w;
  const oneLine = `${c.input.copy.web}  ·  Please recycle`;
  const webText = oneLine.length * fs * 0.8 * 0.6 < webW ? oneLine : `${c.input.copy.web}\nPlease recycle`;
  out.push(txt(webText, m, p.h - m - fs * 2.3, webW, fs * 2.6, { fontFamily: kit.fonts.body, fontSize: fs * 0.8, leading: fs, weight: 600, color: c.ink, tracking: 40 }, { name: 'Web', anchor: p.id, verticalAlign: 'bottom' }));
  return out;
}

function side(p: DielinePanel, c: Ctx): Element[] {
  if (Math.min(p.w, p.h) < mm(10)) return [];
  const tall = p.h > p.w * 1.3;
  if (tall) {
    const lw = p.h * 0.66, lh = p.w * 0.42;
    return [
      makeLogo({ name: 'Side wordmark', variant: 'wordmark', x: p.w / 2 - lw / 2, y: p.h / 2 - lh / 2, w: lw, h: lh, rotation: -90, color: c.ink, anchor: p.id }),
    ];
  }
  // A wall that reads sideways in the flat (mailer walls), laid out in its reading frame: the
  // wordmark runs along it.
  if ((p.read === 90 || p.read === 270) && p.w > p.h * 1.6 && p.h >= mm(14)) {
    const lw = p.w * 0.66, lh = Math.min(p.h * 0.42, lw * 0.3);
    return [makeLogo({ name: 'Side wordmark', variant: 'wordmark', x: p.w / 2 - lw / 2, y: p.h / 2 - lh / 2, w: lw, h: lh, color: c.ink, anchor: p.id })];
  }
  const m = margin(p);
  const fs = clamp(p.h * 0.12, 6, 16);
  return [txt(c.input.kit.tagline, m, p.h / 2 - fs, p.w - 2 * m, fs * 2.2, { fontFamily: c.input.kit.fonts.headline, fontSize: fs, leading: fs * 1.1, align: 'center', color: c.ink, weight: 600 }, { name: 'Tagline', anchor: p.id, autoFit: true, verticalAlign: 'middle' })];
}

function lid(p: DielinePanel, c: Ctx): Element[] {
  if (Math.min(p.w, p.h) < mm(12)) return [];
  const s = Math.min(p.w, p.h) * 0.62;
  const wide = p.w > p.h * 1.6;
  const w = wide ? Math.min(p.w * 0.7, s * 3.2) : s * 1.2, h = wide ? s * 0.6 : s;
  return [makeLogo({ name: 'Lid logo', variant: wide ? 'lockup' : 'stacked', x: p.w / 2 - w / 2, y: p.h / 2 - h / 2, w, h, color: c.ink, anchor: p.id, finish: c.input.look.foil ?? 'none' })];
}

function band(p: DielinePanel, c: Ctx): Element[] {
  const fs = clamp(p.h * 0.3, 4, 14);
  const t = `${c.input.kit.name}  ·  ${c.name}`;
  return [txt(t, mm(2), p.h / 2 - fs * 0.75, p.w - mm(4), fs * 1.5, { fontFamily: c.input.kit.fonts.body, fontSize: fs, leading: fs * 1.2, weight: 700, tracking: 160, textTransform: 'uppercase', align: 'center', color: c.ink }, { name: 'Neck band', anchor: p.id, autoFit: true, verticalAlign: 'middle' })];
}

function mark(p: DielinePanel, c: Ctx): Element[] {
  const s = Math.min(p.w, p.h) * 0.56;
  return [makeLogo({ name: 'Mark', variant: 'mark', x: p.w / 2 - s / 2, y: p.h / 2 - s / 2, w: s, h: s, color: c.ink, color2: c.pop, anchor: p.id, finish: c.input.look.foil ?? 'none' })];
}

function tagline(p: DielinePanel, c: Ctx, text?: string): Element[] {
  const m = margin(p);
  const fs = clamp(Math.min(p.h * 0.18, p.w * 0.08), 7, 48);
  return [txt(text ?? c.input.kit.tagline, m, m, p.w - 2 * m, p.h - 2 * m, { fontFamily: c.input.kit.fonts.headline, fontSize: fs, leading: fs * 1.05, align: 'center', color: c.ink, weight: Math.max(500, c.input.kit.logo.weight), textTransform: c.input.look.caps ? 'uppercase' : 'none' }, { name: 'Tagline', anchor: p.id, autoFit: true, verticalAlign: 'middle' })];
}

/* -------------------------------------------------------------------------- */
/* Whole surfaces                                                              */
/* -------------------------------------------------------------------------- */

function garment(surface: DielineSurface, c: Ctx): Element[] {
  const W = surface.w, H = surface.h;
  const id = surface.id;
  const kit = c.input.kit;
  const ink = c.ink;
  if (id === 'sleeve' || id === 'side') {
    const s = Math.min(W, H) * 0.8;
    return [makeLogo({ name: 'Mark', variant: 'mark', x: W / 2 - s / 2, y: H / 2 - s / 2, w: s, h: s, color: ink, color2: c.pop })];
  }
  if (id === 'back' && c.product.template !== 'cap') {
    const s = Math.min(W, H) * 0.42;
    const fs = clamp(W * 0.06, 9, 36);
    return [
      makeLogo({ name: 'Mark', variant: 'mark', x: W / 2 - s / 2, y: H * 0.08, w: s, h: s, color: c.pop, color2: ink }),
      txt(kit.name, 0, H * 0.08 + s + fs * 0.6, W, fs * 2.6, { fontFamily: kit.fonts.headline, fontSize: fs * 1.6, leading: fs * 1.7, weight: Math.max(600, kit.logo.weight), align: 'center', color: ink, textTransform: c.input.look.caps ? 'uppercase' : 'none' }, { name: 'Name', autoFit: true, verticalAlign: 'middle' }),
      txt(kit.tagline, 0, H * 0.08 + s + fs * 3.6, W, fs * 1.6, { fontFamily: kit.fonts.body, fontSize: fs * 0.55, leading: fs * 0.7, weight: 600, tracking: 200, align: 'center', color: ink, textTransform: 'uppercase' }, { name: 'Tagline' }),
    ];
  }
  if (c.product.template === 'cap') {
    if (id === 'back') return [txt(c.input.copy.web, 0, 0, W, H, { fontFamily: kit.fonts.body, fontSize: H * 0.4, leading: H * 0.5, weight: 600, align: 'center', color: ink }, { name: 'Web', autoFit: true, verticalAlign: 'middle' })];
    return [makeLogo({ name: 'Logo', variant: 'lockup', x: W * 0.06, y: H * 0.18, w: W * 0.88, h: H * 0.64, color: ink })];
  }
  // Front of tees, hoodies, totes: a stacked logo with the tagline.
  const lw = W * (c.product.template === 'tote' ? 0.74 : 0.6);
  const lh = Math.min(H * 0.5, lw * 0.75);
  const top = c.product.template === 'tote' ? H * 0.16 : H * 0.04;
  const fs = clamp(W * 0.045, 7, 22);
  return [
    makeLogo({ name: 'Logo', variant: 'stacked', x: W / 2 - lw / 2, y: top, w: lw, h: lh, color: ink, color2: c.pop }),
    txt(kit.tagline, 0, top + lh + fs, W, fs * 1.8, { fontFamily: kit.fonts.body, fontSize: fs, leading: fs * 1.2, weight: 600, tracking: 180, align: 'center', color: ink, textTransform: 'uppercase' }, { name: 'Tagline' }),
  ];
}

function businessCard(surface: DielineSurface, c: Ctx): Element[] {
  const { w: W, h: H } = surface;
  const kit = c.input.kit, ct = c.input.copy.contact;
  if (surface.id === 'front') {
    const lw = W * 0.62, lh = H * 0.5;
    return [makeLogo({ name: 'Logo', variant: 'stacked', x: W / 2 - lw / 2, y: H / 2 - lh / 2, w: lw, h: lh, color: c.ink, color2: c.pop, finish: c.input.look.foil ?? 'none' })];
  }
  const m = mm(6);
  const s = mm(7);
  return [
    makeLogo({ name: 'Mark', variant: 'mark', x: W - m - s, y: m, w: s, h: s, color: c.pop, color2: c.ink, finish: c.input.look.foil ?? 'none' }),
    txt(ct.name, m, m + mm(1), W * 0.7, 14, { fontFamily: kit.fonts.headline, fontSize: 10.5, leading: 12, weight: Math.max(500, kit.logo.weight - 100), color: c.ink }, { name: 'Name' }),
    txt(ct.title, m, m + mm(6), W * 0.7, 10, { fontFamily: kit.fonts.body, fontSize: 6.5, leading: 8, weight: 500, tracking: 80, textTransform: 'uppercase', color: c.pop }, { name: 'Title' }),
    txt(`${ct.phone}\n${ct.email}\n${c.input.copy.web}\n${ct.address}`, m, H - m - 36, W - 2 * m, 38, { fontFamily: kit.fonts.body, fontSize: 6.5, leading: 8.6, color: c.ink }, { name: 'Contact', verticalAlign: 'bottom' }),
  ];
}

function letterhead(surface: DielineSurface, c: Ctx): Element[] {
  const { w: W, h: H } = surface;
  const kit = c.input.kit, ct = c.input.copy.contact;
  const m = mm(20);
  return [
    makeLogo({ name: 'Logo', variant: 'lockup', x: m, y: mm(14), w: mm(52), h: mm(12), color: c.ink, finish: c.input.look.foil ?? 'none' }),
    makeRule({ name: 'Rule', x: m, y: mm(32), w: W - 2 * m, h: 4, stroke: c.pop, strokeWidth: 0.75 }),
    txt(`${kit.name}  ·  ${ct.address}  ·  ${ct.phone}  ·  ${c.input.copy.web}`, m, H - mm(16), W - 2 * m, 12, { fontFamily: kit.fonts.body, fontSize: 7, leading: 9, align: 'center', color: c.ink, tracking: 40 }, { name: 'Footer' }),
  ];
}

type Role = 'hero' | 'back' | 'side' | 'lid' | 'band' | 'mark' | 'tagline' | 'message' | 'skip';

function roleOf(templateId: string, surface: DielineSurface, p: DielinePanel): Role {
  if (p.role === 'tuck' || p.role === 'dust' || p.role === 'glue' || p.role === 'gusset') return 'skip';
  if (surface.id === 'neck') return 'band';
  if (templateId === 'tube' && surface.id === 'lid') return p.id === 'front' ? 'tagline' : 'skip';
  if (surface.id === 'top' || (templateId === 'jar' && surface.id === 'lid')) return 'mark';
  if (surface.id === 'back' && (templateId === 'bottle' || templateId === 'pouch' || templateId === 'perfume')) return 'back';
  if (templateId === 'mailer') {
    if (p.id === 'lid') return 'lid';
    if (p.id === 'front') return 'tagline';
    if (p.id === 'front-in') return 'message';
    if (p.id === 'base' || p.id === 'back' || p.id === 'lid-tuck') return 'skip';
    return p.role === 'side' ? 'side' : 'skip';
  }
  if (templateId === 'mug') return p.id === 'right' ? 'hero' : 'tagline';
  if (templateId === 'pillow') return p.id === 'front' ? 'hero' : p.id === 'back' ? 'tagline' : 'skip';
  if (p.id === 'back-l') return 'side';
  if (p.id === 'back-r' || p.id === 'back' || p.id === 'bottom') return 'back';
  if (p.role === 'side') return 'side';
  if (p.role === 'lid') return p.id === 'lid-bottom' ? 'skip' : 'lid';
  if (p.role === 'face' || p.role === 'band') return 'hero';
  return 'skip';
}

const KRAFTY = /^#(b[0-9a-f]|a[0-9a-f]|c[0-9a-f])[0-9a-f]{4}$/i;

export function designSurface(product: Product, surface: DielineSurface, input: DesignInput): SurfaceArt {
  const pal = new Palette(input.kit);
  const groundRole = input.look.ground;
  const lookGround = pal.role(groundRole, pal.background);
  const substrate = /^#0{6}00$/i.test(surface.substrate) ? '#cfd8dc' : surface.substrate;
  const tpl = product.template;
  const opts = optionsOf(product);
  // Grounds: substrates that are part of the look (kraft, fabric, glass, black board) stay unprinted.
  let ground: string | null = lookGround;
  if (surface.cutKind === 'none' || KRAFTY.test(substrate) || tpl === 'perfume' && opts.deco !== 'label') ground = null;
  if (tpl === 'card') ground = surface.id === 'front' ? (KRAFTY.test(substrate) || substrate === '#19181a' ? null : pal.primary) : (KRAFTY.test(substrate) || substrate === '#19181a' ? null : pal.background);
  if (tpl === 'letterhead') ground = null;
  if (tpl === 'bottle' && opts.stock === 'clear') ground = null;
  if ((tpl === 'tuck-straight' || tpl === 'tuck-reverse') && opts.board === 'black') ground = null;
  if (tpl === 'can' && opts.base === 'bare') ground = null;
  const bg = ground ?? (tpl === 'perfume' && opts.deco !== 'label' ? (opts.glass === 'smoke' ? '#3a3a3d' : '#d6dde0') : substrate);
  const variant = input.copy.variants[input.variant % input.copy.variants.length] ?? input.kit.name;
  const ink = tpl === 'perfume' && opts.deco === 'screen' ? (luminance(bg) > 0.5 ? pal.primary : '#ffffff') : pal.ink(bg);
  const c: Ctx = { product, surface, input, pal, bg, ink, pop: pal.pop(bg), name: variant, size: sizeLabel(product) };
  const els: Element[] = [];
  // Repeat pattern over printed grounds.
  if (ground && input.look.pattern && surface.cutKind !== 'none' && tpl !== 'card' && tpl !== 'letterhead') {
    const b = surface.bleed;
    const pcol = input.look.pattern === 'confetti' ? pal.accent : mix(ink, ground, 0.1);
    els.push(makePattern({ name: 'Ground pattern', kind: input.look.pattern, x: -b, y: -b, w: surface.w + 2 * b, h: surface.h + 2 * b, color: pcol, color2: pal.secondary === ground ? pal.accent : pal.secondary, scale: input.look.patternScale, density: 0.4, opacity: input.look.patternOpacity, seed: 11 + input.variant, locked: true }));
  }
  if (tpl === 'card') els.push(...businessCard(surface, c));
  else if (tpl === 'letterhead') els.push(...letterhead(surface, c));
  else if (surface.cutKind === 'none' && tpl !== 'mug' && tpl !== 'perfume') els.push(...garment(surface, c));
  else if (tpl === 'perfume') {
    const p = surface.panels[0];
    if (surface.id === 'back') els.push(...back(p, c, false));
    else if (opts.deco === 'label') els.push(...hero(p, c));
    else {
      const fs = clamp(p.h * 0.1, 5, 12);
      els.push(makeLogo({ name: 'Wordmark', variant: 'wordmark', x: p.w * 0.06, y: p.h * 0.28, w: p.w * 0.88, h: p.h * 0.26, color: ink, finish: opts.deco === 'screen' ? input.look.foil ?? 'none' : 'none' }));
      els.push(txt(input.copy.descriptor, 0, p.h * 0.62, p.w, fs * 2, { fontFamily: input.kit.fonts.body, fontSize: fs, leading: fs * 1.2, tracking: 220, align: 'center', textTransform: 'uppercase', color: ink, weight: 500 }, { name: 'Descriptor' }));
    }
  } else {
    for (const p0 of surface.panels) {
      const first = els.length;
      // Panels that read sideways on the product (mailer walls: 90° on one side, 270° on the
      // other) are laid out in their reading frame and turned into place afterwards.
      const turn = p0.read === 90 || p0.read === 270 ? p0.read : 0;
      const p: DielinePanel = turn ? { ...p0, w: p0.h, h: p0.w } : p0;
      switch (roleOf(tpl, surface, p)) {
        case 'hero': els.push(...hero(p, c)); break;
        case 'back': els.push(...back(p, c)); break;
        case 'side': els.push(...side(p, c)); break;
        case 'lid': els.push(...lid(p, c)); break;
        case 'band': els.push(...band(p, c)); break;
        case 'mark': els.push(...mark(p, c)); break;
        case 'tagline': els.push(...tagline(p, c)); break;
        case 'message': els.push(...tagline(p, c, 'Hello, you. Thanks for wearing loud.')); break;
        default: break;
      }
      if (turn) {
        // Clockwise turn about the panel centre (y down); items rotate about their own centres.
        const sin = turn === 90 ? 1 : -1;
        for (let i = first; i < els.length; i++) {
          const e = els[i];
          const dx = e.x + e.w / 2 - p.w / 2, dy = e.y + e.h / 2 - p.h / 2;
          e.x = p0.w / 2 - dy * sin - e.w / 2;
          e.y = p0.h / 2 + dx * sin - e.h / 2;
          e.rotation = ((((e.rotation + turn) % 360) + 540) % 360) - 180;
        }
      }
      // Panels that fold over (lids, mailer fronts) carry their artwork upside down in the flat.
      if (p0.read === 180) for (let i = first; i < els.length; i++) {
        const e = els[i];
        e.x = p.w - e.x - e.w;
        e.y = p.h - e.y - e.h;
        e.rotation = ((e.rotation + 180 + 180) % 360) - 180;
      }
    }
    // Jar labels wider than the front panel carry the small print on the right.
    if (tpl === 'jar' && surface.id === 'label') {
      const f = surface.panels[0];
      const rest = surface.w - (f.x + f.w);
      if (rest > mm(22)) {
        const fs = clamp(surface.h * 0.06, 5, 7);
        els.push(txt(input.copy.ingredients, f.x + f.w + mm(4), mm(4), rest - mm(8), surface.h - mm(8), { fontFamily: input.kit.fonts.body, fontSize: fs, leading: fs * 1.25, color: ink }, { name: 'Ingredients', verticalAlign: 'middle' }));
      }
    }
  }
  return { elements: els, background: ground };
}

/** Design every surface of a product (replaces its artwork). */
export function designProduct(product: Product, input: DesignInput): Record<string, SurfaceArt> {
  const out: Record<string, SurfaceArt> = {};
  for (const s of dielineOf(product).surfaces) out[s.id] = designSurface(product, s, input);
  return out;
}
