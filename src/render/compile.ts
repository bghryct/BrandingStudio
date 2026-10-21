/**
 * Element → display list compiler, and surface compositing (ground, anchored items, bleed clip).
 * Results are memoised on element identity (immer keeps unchanged elements identical) plus the
 * font-load version and, for brand-driven items, the brand kit.
 */
import type {
  Element, Project, Product, TextElement, ShapeElement, ImageElement, PathElement, DrawingElement, GradientFill, BrandKit,
} from '../model/types';
import type { GroupPrim, LinearGradientPaint, Matrix, Paint, Prim, RadialGradientPaint } from './primitives';
import { ellipsePath, multiply, rectPath, rotate, translate, polylinePath } from './primitives';
import { layoutStory, frameSpecOf, type FrameLayout, type TokenContext, type StoryStyles } from '../engine/textLayout';
import { ensureFamily, resolveFont, measure, fontMetrics, useFontStore } from '../engine/fonts';
import type { GenContext } from '../engine/generators/context';
import { generateGradient } from '../engine/generators/sato';
import { generateRule } from '../engine/generators/rules';
import { generatePatternFill } from '../engine/generators/patterns';
import { generateLogo, type LogoContext } from '../engine/generators/logo';
import { generateBarcode } from '../engine/generators/barcode';
import { renderStrokes } from '../engine/brushes';
import { parseSvgCached, svgPrims, svgMarkupFromDataUrl } from './svgImport';
import { transformPath } from '../lib/pathData';
import { getImage } from './images';
import { parseColor } from '../lib/color';
import type { DielineSurface } from '../products/types';
import { surfaceOf, panelOrigin, bleedPath } from '../products';

/* -------------------------------------------------------------------------- */
/* Generator context                                                           */
/* -------------------------------------------------------------------------- */

export const genContext: GenContext = {
  font: (family, weight = 400, italic = false) => {
    void ensureFamily(family);
    return resolveFont({ family, weight, italic });
  },
  measure: (text, font, size) => measure(text, font, size),
  metrics: (font) => {
    const m = fontMetrics(font);
    return { ascender: m.ascender, descender: m.descender, capHeight: m.capHeight, xHeight: m.xHeight };
  },
};

export interface CompileContext {
  project: Project;
  product: Product | null;
  surface: DielineSurface | null;
}

export function contextFor(project: Project, product: Product | null, surfaceId: string | null): CompileContext {
  return { project, product, surface: product && surfaceId ? surfaceOf(product, surfaceId) ?? null : null };
}

/* -------------------------------------------------------------------------- */
/* Text                                                                        */
/* -------------------------------------------------------------------------- */

const singleCache = new WeakMap<Element, Map<string, FrameLayout>>();
const stylesIds = new WeakMap<object, number>();
const NONE_PARA: NonNullable<Project['paragraphStyles']> = [];
const NONE_CHAR: NonNullable<Project['characterStyles']> = [];
let stylesCounter = 0;

function storyStyles(project: Project): { styles: StoryStyles | null; key: string } {
  // Shared empty lists: a fresh [] per call would give the cache a new identity every time, so
  // a project with paragraph styles but no character styles (or the reverse) re-set every story
  // on every render.
  const para = project.paragraphStyles ?? NONE_PARA, char = project.characterStyles ?? NONE_CHAR;
  if (!para.length && !char.length) return { styles: null, key: '-' };
  const id = (o: object) => { let v = stylesIds.get(o); if (v == null) { v = ++stylesCounter; stylesIds.set(o, v); } return v; };
  for (const d of [...para, ...char]) if (d.props.fontFamily) void ensureFamily(d.props.fontFamily);
  return { styles: { para, char }, key: `${id(para)}/${id(char)}` };
}

/** Brand tokens: {brand} {tagline} {product}; the engine's own {year} also works. */
function expandBrandTokens(text: string, ctx: CompileContext): string {
  if (!text.includes('{')) return text;
  return text
    .replace(/\{brand\}/g, ctx.project.brand.name)
    .replace(/\{tagline\}/g, ctx.project.brand.tagline)
    .replace(/\{product\}/g, ctx.product?.name ?? '');
}

const TOKENS: TokenContext = { page: 1, pages: 1, title: '', subtitle: '', author: '', publisher: '' };

export function layoutText(el: TextElement, ctx: CompileContext): FrameLayout {
  void ensureFamily(el.style.fontFamily);
  const version = useFontStore.getState().version;
  const ss = storyStyles(ctx.project);
  const text = expandBrandTokens(el.text, ctx);
  const key = `${version}|${ss.key}|${text === el.text ? '' : text}`;
  let m = singleCache.get(el);
  if (!m) { m = new Map(); singleCache.set(el, m); }
  const hit = m.get(key);
  if (hit) return hit;
  let layout: FrameLayout;
  if (el.autoFit) layout = fitLayout(el, text, ss.styles);
  else [layout] = layoutStory(text, el.style, [frameSpecOf(el, null)], TOKENS, ss.styles);
  if (m.size > 16) m.clear();
  m.set(key, layout);
  return layout;
}

/** Shrink the type until the story fits the frame (width of the longest word and height). */
function fitLayout(el: TextElement, text: string, styles: StoryStyles | null): FrameLayout {
  const frame = frameSpecOf(el, null);
  const font = resolveFont({ family: el.style.fontFamily, weight: el.style.weight, italic: el.style.italic });
  const words = text.replace(/\[[^\]]*\]|<[^>]*>|[*^#]/g, '').split(/\s+/).filter(Boolean);
  const inner = el.w - el.inset * 2;
  const tr = (el.style.tracking / 1000);
  const upper = el.style.textTransform === 'uppercase';
  let hi = 1;
  for (const w of words) {
    const t = upper ? w.toUpperCase() : w;
    const width = measure(t, font, el.style.fontSize) + tr * el.style.fontSize * t.length;
    if (width > inner) hi = Math.min(hi, (inner / width) * 0.995);
  }
  const at = (k: number) => layoutStory(text, { ...el.style, fontSize: el.style.fontSize * k, leading: el.style.leading * k }, [frame], TOKENS, styles)[0];
  let best = at(hi);
  if (!best.overflow) return best;
  let lo = 0.05;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    const l = at(mid);
    if (l.overflow) hi = mid; else { lo = mid; best = l; }
  }
  return best.overflow ? at(lo) : best;
}

/* -------------------------------------------------------------------------- */
/* Element compilers                                                           */
/* -------------------------------------------------------------------------- */

export function gradientPaint(g: GradientFill, w: number, h: number): LinearGradientPaint | RadialGradientPaint {
  const stops = [...g.stops].sort((a, b) => a.offset - b.offset).map((s) => ({ offset: s.offset, color: s.color }));
  if (g.kind === 'radial') return { kind: 'radial', cx: w / 2, cy: h / 2, r: Math.hypot(w, h) / 2, stops };
  const a = (g.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
  const L = Math.abs(w * dx) + Math.abs(h * dy);
  return { kind: 'linear', x1: w / 2 - (dx * L) / 2, y1: h / 2 - (dy * L) / 2, x2: w / 2 + (dx * L) / 2, y2: h / 2 + (dy * L) / 2, stops };
}

export function shapePath(el: ShapeElement): string {
  const { w, h } = el;
  switch (el.shape) {
    case 'rect': return rectPath(0, 0, w, h, el.radius);
    case 'pill': return rectPath(0, 0, w, h, Math.min(w, h) / 2);
    case 'ellipse': return ellipsePath(w / 2, h / 2, w / 2, h / 2);
    case 'triangle': return polylinePath([[w / 2, 0], [w, h], [0, h]], true);
    case 'arch': {
      const r = Math.min(w / 2, h);
      return `M0 ${h}V${r}A${w / 2} ${r} 0 0 1 ${w} ${r}V${h}Z`;
    }
    case 'polygon':
    case 'star':
    case 'burst': {
      const n = Math.max(3, Math.round(el.sides));
      const pts: [number, number][] = [];
      const count = el.shape === 'polygon' ? n : n * 2;
      const inner = el.shape === 'burst' ? Math.max(0.7, el.innerRatio) : el.innerRatio;
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
        const r = el.shape !== 'polygon' && i % 2 ? inner : 1;
        pts.push([w / 2 + (Math.cos(a) * w * r) / 2, h / 2 + (Math.sin(a) * h * r) / 2]);
      }
      return polylinePath(pts, true);
    }
    case 'arc': {
      const sweep = Math.max(0.01, Math.min(0.999, el.innerRatio)) * Math.PI * 2;
      const pts: [number, number][] = [];
      for (let i = 0; i <= 64; i++) {
        const a = -Math.PI / 2 + (sweep * i) / 64;
        pts.push([w / 2 + (Math.cos(a) * w) / 2, h / 2 + (Math.sin(a) * h) / 2]);
      }
      return polylinePath(pts, false);
    }
  }
}

function compileImage(el: ImageElement, project: Project): Prim[] {
  const asset = el.assetId ? project.assets[el.assetId] : null;
  if (!asset) {
    return [
      { t: 'path', d: rectPath(0, 0, el.w, el.h), fill: '#e6e3dd', stroke: '#b9b4ab', strokeWidth: 0.5 },
      { t: 'path', d: `M0 0L${el.w} ${el.h}M${el.w} 0L0 ${el.h}`, stroke: '#b9b4ab', strokeWidth: 0.5 },
    ];
  }
  const iw = asset.width || 1, ih = asset.height || 1;
  let dw = el.w, dh = el.h;
  if (el.fit !== 'fill') {
    const s = (el.fit === 'cover' ? Math.max(el.w / iw, el.h / ih) : Math.min(el.w / iw, el.h / ih)) * Math.max(0.05, el.zoom);
    dw = iw * s;
    dh = ih * s;
  }
  const x = (el.w - dw) / 2 + (el.offsetX * Math.abs(dw - el.w)) / 2;
  const y = (el.h - dh) / 2 + (el.offsetY * Math.abs(dh - el.h)) / 2;
  if (el.duotone) {
    const [dark, light] = el.duotone;
    const D = parseColor(dark), Lc = parseColor(light);
    return [{
      t: 'raster', key: `duo:${asset.id}:${dark}:${light}:${x.toFixed(1)}:${y.toFixed(1)}:${dw.toFixed(1)}:${dh.toFixed(1)}`, x: 0, y: 0, w: el.w, h: el.h,
      draw: (ctx, pxPerPt) => {
        const img = getImage(asset.src);
        if (!img) return;
        const W = Math.max(1, Math.round(el.w * pxPerPt)), H = Math.max(1, Math.round(el.h * pxPerPt));
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d')!;
        g.drawImage(img, x * pxPerPt, y * pxPerPt, dw * pxPerPt, dh * pxPerPt);
        const data = g.getImageData(0, 0, W, H);
        const p = data.data;
        for (let i = 0; i < p.length; i += 4) {
          const l = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
          p[i] = D.r + (Lc.r - D.r) * l; p[i + 1] = D.g + (Lc.g - D.g) * l; p[i + 2] = D.b + (Lc.b - D.b) * l;
        }
        g.putImageData(data, 0, 0);
        ctx.drawImage(c, 0, 0, el.w, el.h);
      },
    }];
  }
  return [{ t: 'image', href: asset.src, assetId: asset.id, x, y, w: dw, h: dh, clip: { x: 0, y: 0, w: el.w, h: el.h }, filter: el.grayscale ? 'grayscale' : null }];
}

function compilePath(el: PathElement): Prim[] {
  const sx = el.vw ? el.w / el.vw : 1, sy = el.vh ? el.h / el.vh : 1;
  const d = sx === 1 && sy === 1 ? el.d : transformPath(el.d, [sx, 0, 0, sy, 0, 0]);
  const fill: Paint | null = el.gradient ? gradientPaint(el.gradient, el.w, el.h) : el.fill;
  return [{ t: 'path', d, fill, stroke: el.stroke, strokeWidth: el.strokeWidth, dash: el.dash, cap: el.cap, join: el.join, fillRule: el.fillRule }];
}

function compileDrawing(el: DrawingElement): Prim[] {
  if (!el.strokes.length) return [];
  return [{
    t: 'raster', key: `draw:${el.id}:${el.strokes.length}:${el.strokes[el.strokes.length - 1].id}:${el.w.toFixed(1)}x${el.h.toFixed(1)}:${el.paperGrain}`,
    x: 0, y: 0, w: el.w, h: el.h,
    draw: (ctx, pxPerPt) => renderStrokes(ctx, el.strokes, { pxPerPt, paperGrain: el.paperGrain }),
  }];
}

function svgAssetPrims(project: Project, assetId: string | null, w: number, h: number, fill: string | null, stroke: string | null, contain = false): Prim[] | null {
  const asset = assetId ? project.assets[assetId] : null;
  if (!asset) return null;
  if (asset.kind === 'svg') {
    const parsed = parseSvgCached(asset.id, svgMarkupFromDataUrl(asset.src));
    if (parsed && parsed.paths.length) {
      if (!contain) return svgPrims(parsed, w, h, fill, stroke);
      const k = Math.min(w / parsed.viewBox.w, h / parsed.viewBox.h);
      const pw = parsed.viewBox.w * k, ph = parsed.viewBox.h * k;
      return [{ t: 'group', matrix: translate((w - pw) / 2, (h - ph) / 2), children: svgPrims(parsed, pw, ph, fill, stroke) }];
    }
  }
  const k = contain ? Math.min(w / (asset.width || 1), h / (asset.height || 1)) : 1;
  const pw = contain ? asset.width * k : w, ph = contain ? asset.height * k : h;
  return [{ t: 'image', href: asset.src, assetId: asset.id, x: (w - pw) / 2, y: (h - ph) / 2, w: pw, h: ph }];
}

export function compileElementLocal(el: Element, ctx: CompileContext): Prim[] {
  switch (el.type) {
    case 'text': {
      const layout = layoutText(el, ctx);
      const out: Prim[] = [];
      if (el.fill) out.push({ t: 'path', d: rectPath(0, 0, el.w, el.h), fill: el.fill });
      out.push(...layout.prims);
      return out;
    }
    case 'image': return compileImage(el, ctx.project);
    case 'shape': {
      const fill: Paint | null = el.shape === 'arc' ? null : el.gradient ? gradientPaint(el.gradient, el.w, el.h) : el.fill;
      return [{ t: 'path', d: shapePath(el), fill, stroke: el.stroke, strokeWidth: el.strokeWidth, dash: el.dash, cap: el.cap, join: el.join }];
    }
    case 'rule': return generateRule(el as never, genContext);
    case 'path': return compilePath(el);
    case 'svg': {
      const p = svgAssetPrims(ctx.project, el.assetId, el.w, el.h, el.fillOverride, el.strokeOverride);
      return p ?? [{ t: 'path', d: rectPath(0, 0, el.w, el.h), stroke: '#b9b4ab', strokeWidth: 0.5, dash: [3, 3] }];
    }
    case 'gradient': return generateGradient(el as never, genContext);
    case 'pattern': if (el.kind === 'type-repeat') void ensureFamily(el.fontFamily); return generatePatternFill(el, genContext);
    case 'drawing': return compileDrawing(el);
    case 'logo': {
      const brand = ctx.project.brand;
      void ensureFamily(brand.fonts.headline);
      void ensureFamily(brand.fonts.body);
      const lctx: LogoContext = {
        ...genContext,
        brand,
        uploaded: (w, h, color) => svgAssetPrims(ctx.project, brand.logo.assetId, w, h, color, null, true),
      };
      return generateLogo(el, lctx);
    }
    case 'barcode': void ensureFamily('ibm-plex-mono'); return generateBarcode(el, genContext);
  }
}

/* -------------------------------------------------------------------------- */
/* Placement & memoisation                                                     */
/* -------------------------------------------------------------------------- */

export function elementMatrix(el: Element, offsetX = 0, offsetY = 0): Matrix {
  let m: Matrix = translate(el.x + offsetX, el.y + offsetY);
  if (el.rotation) m = multiply(m, rotate(el.rotation, el.w / 2, el.h / 2));
  if (el.flipX || el.flipY) m = multiply(m, [el.flipX ? -1 : 1, 0, 0, el.flipY ? -1 : 1, el.flipX ? el.w : 0, el.flipY ? el.h : 0]);
  return m;
}

const compiledCache = new WeakMap<Element, { key: string; prims: Prim[] }>();
const brandIds = new WeakMap<object, number>();
let brandCounter = 0;
const brandKey = (b: BrandKit) => { let id = brandIds.get(b); if (id == null) { id = ++brandCounter; brandIds.set(b, id); } return id; };

function contextKey(el: Element, ctx: CompileContext): string {
  const v = useFontStore.getState().version;
  if (el.type === 'logo') return `${v}|${brandKey(ctx.project.brand)}|${ctx.project.brand.logo.assetId ? (ctx.project.assets[ctx.project.brand.logo.assetId] ? 1 : 0) : 0}`;
  if (el.type === 'image' || el.type === 'svg') return `${v}|${el.assetId ? (ctx.project.assets[el.assetId] ? 1 : 0) : 0}`;
  return String(v);
}

/** Local primitives for an element (memoised; text is cached by the layout service). */
export function compileElement(el: Element, ctx: CompileContext): Prim[] {
  if (el.type === 'text') return compileElementLocal(el, ctx);
  const key = contextKey(el, ctx);
  const hit = compiledCache.get(el);
  if (hit && hit.key === key) return hit.prims;
  let prims: Prim[];
  try {
    prims = compileElementLocal(el, ctx);
  } catch (e) {
    console.warn('compile failed', el.type, e);
    prims = [{ t: 'path', d: rectPath(0, 0, el.w, el.h), stroke: '#e5483a', strokeWidth: 0.5, dash: [3, 3] }];
  }
  compiledCache.set(el, { key, prims });
  return prims;
}

/** Offset of an anchored element (its panel's origin). */
export function anchorOffsetOf(el: Element, surface: DielineSurface | null): { x: number; y: number } {
  return el.anchor ? panelOrigin(surface ?? undefined, el.anchor) : { x: 0, y: 0 };
}

/** Element wrapped in its placement group (anchor offset included). */
export function placedElement(el: Element, ctx: CompileContext): GroupPrim {
  const o = anchorOffsetOf(el, ctx.surface);
  return { t: 'group', matrix: elementMatrix(el, o.x, o.y), opacity: el.opacity, blend: el.blend, children: compileElement(el, ctx) };
}

export interface SurfaceRenderOptions {
  /** Paint the printed ground (default true). */
  ground?: boolean;
  /** Paint the substrate (board / metal / fabric colour) under everything (editor, thumbnails). */
  substrate?: boolean;
  /** Clip to the bleed outline (default true). */
  clip?: boolean;
  /** Restrict to elements passing this filter (finish masks). */
  filter?: (el: Element) => boolean;
}

/** All primitives of a product surface in surface coordinates (trim-box origin). */
export function compileSurface(project: Project, product: Product, surfaceId: string, opts: SurfaceRenderOptions = {}): Prim[] {
  const surface = surfaceOf(product, surfaceId);
  if (!surface) return [];
  const art = product.surfaces[surfaceId];
  const ctx: CompileContext = { project, product, surface };
  const b = surface.bleed;
  const children: Prim[] = [];
  const box = rectPath(-b, -b, surface.w + 2 * b, surface.h + 2 * b);
  if (opts.substrate && surface.substrate && !/^#0{6}00$/i.test(surface.substrate) && surface.substrate !== 'transparent') children.push({ t: 'path', d: box, fill: surface.substrate });
  if (opts.ground !== false && art?.background) children.push({ t: 'path', d: box, fill: art.background });
  for (const el of art?.elements ?? []) {
    if (el.hidden || (opts.filter && !opts.filter(el))) continue;
    children.push(placedElement(el, ctx));
  }
  if (opts.clip === false || surface.cutKind === 'none') return surface.cutKind === 'none' && opts.clip !== false ? [{ t: 'group', clip: rectPath(0, 0, surface.w, surface.h), children }] : children;
  return [{ t: 'group', clip: bleedPath(surface), children }];
}
