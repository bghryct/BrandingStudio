/**
 * Print-ready PDF of a product's dielines (one page per surface), adapted from Book Design
 * Studio's writer.
 *
 *  • Vector artwork: paths, shapes, patterns, logos, barcodes, SVG imports and text (static fonts
 *    embedded and subset, variable instances as exact glyph outlines). Rasters only where the
 *    medium is raster (photos, brush drawings, mesh gradients), at the chosen resolution.
 *  • TrimBox and BleedBox; artwork clipped to the bleed outline of the die.
 *  • The dieline on named spot colours in its own PDF layers (optional content): the cut contour on
 *    “CutContour”, creases and folds on “Fold”, perforations dashed on “Fold”, glue areas on “Glue”.
 *  • Foils, emboss, deboss, spot UV and white underprint separated onto named spot plates.
 *  • Brand colours with a spot reference can print as real spot separations; others use the
 *    palette's exact CMYK build (or convert).
 *  • Crop / bleed / registration marks, colour bars and a slug line; dimensions and panel names on
 *    a non-printing “Info” layer.
 */
import {
  PDFDocument, PDFPage, PDFOperator, PDFOperatorNames as Op, PDFName, PDFNumber, PDFArray, PDFDict, PDFRef, PDFFont, PDFString, StandardFonts,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, moveTo, lineTo, appendBezierCurve, closePath, fill, stroke,
  fillAndStroke, endPath, setFillingRgbColor, setFillingCmykColor, setStrokingRgbColor, setStrokingCmykColor, setLineWidth,
  setDashPattern, setLineCap, setLineJoin, setGraphicsState, drawObject, setCharacterSpacing, LineCapStyle, LineJoinStyle, cmyk, rgb,
  type PDFImage,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { BlendMode, Element, Finish, Product, Project, Swatch } from '../model/types';
import type { Paint, Prim, TextRun, Matrix, PathPrim, GradientStop } from '../render/primitives';
import { multiply } from '../render/primitives';
import { compileElement, elementMatrix, anchorOffsetOf, type CompileContext } from '../render/compile';
import { renderToCanvas, preloadImages } from '../render/canvasBackend';
import { parsePath } from '../lib/pathData';
import { parseColor, rgbToCmyk } from '../lib/color';
import { shape, glyphPath, canOutline, faceBytes, getFace, glyphKerns } from '../engine/fonts';
import { dielineOf, bleedPath, piecePath, cutSegments, optionsOf, getTemplate } from '../products';
import type { DielineSurface } from '../products/types';
import { polyToPath } from '../products/geom';
import { fromPt } from '../model/units';

export interface PdfOptions {
  /** Surfaces to include (ids); empty = all. */
  surfaces: string[];
  bleed: boolean;
  cropMarks: boolean;
  bleedMarks: boolean;
  registration: boolean;
  colorBars: boolean;
  pageInfo: boolean;
  colorMode: 'cmyk' | 'rgb';
  textMode: 'auto' | 'outline';
  rasterDpi: number;
  /** The dieline (cut, folds, glue) on spot layers. */
  dieline: boolean;
  /** Dimensions, panel names and safe areas on a non-printing layer. */
  info: boolean;
  /** Foil / emboss / deboss / spot UV / white base on named spot plates. */
  finishSpots: boolean;
  /** Brand colours that have a spot reference print as spot separations. */
  brandSpots: boolean;
  /** Paint the substrate colour under the art (proofs on white stock). */
  substrate: boolean;
  onProgress?: (fraction: number, label: string) => void;
}

export const DEFAULT_PDF_OPTIONS: PdfOptions = {
  surfaces: [], bleed: true, cropMarks: true, bleedMarks: false, registration: true, colorBars: true, pageInfo: true,
  colorMode: 'cmyk', textMode: 'auto', rasterDpi: 300, dieline: true, info: true, finishSpots: true, brandSpots: false, substrate: false,
};

const BLEND_NAMES: Partial<Record<BlendMode, string>> = {
  multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', 'color-dodge': 'ColorDodge',
  'color-burn': 'ColorBurn', 'hard-light': 'HardLight', 'soft-light': 'SoftLight', difference: 'Difference', exclusion: 'Exclusion',
  hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity',
};

const SPOTS: Record<string, { name: string; cmyk: [number, number, number, number] }> = {
  dieline: { name: 'CutContour', cmyk: [0, 1, 0, 0] },
  fold: { name: 'Fold', cmyk: [1, 0, 0, 0] },
  glue: { name: 'Glue', cmyk: [0, 0, 1, 0] },
  'gold-foil': { name: 'Foil_Gold', cmyk: [0.15, 0.3, 0.9, 0.05] },
  'silver-foil': { name: 'Foil_Silver', cmyk: [0.2, 0.15, 0.15, 0.3] },
  'copper-foil': { name: 'Foil_Copper', cmyk: [0.1, 0.6, 0.85, 0.1] },
  'holo-foil': { name: 'Foil_Holographic', cmyk: [0.3, 0.1, 0, 0.1] },
  emboss: { name: 'Emboss', cmyk: [0.5, 0, 0.5, 0] },
  'blind-deboss': { name: 'Deboss', cmyk: [0.5, 0, 0.5, 0] },
  'spot-gloss': { name: 'SpotUV', cmyk: [0, 0.5, 1, 0] },
  'white-base': { name: 'White', cmyk: [0, 0, 0, 0.12] },
  registration: { name: 'All', cmyk: [1, 1, 1, 1] },
};

/* -------------------------------------------------------------------------- */
/* Writer                                                                       */
/* -------------------------------------------------------------------------- */

class PageWriter {
  private gsCache = new Map<string, PDFName>();
  private csCache = new Map<string, PDFName>();
  private shCount = 0;
  ops: PDFOperator[] = [];

  private glyphNames = new Map<PDFRef, PDFName>();

  constructor(public doc: PDFDocument, public page: PDFPage, public project: Project, public opts: PdfOptions, public images: Map<string, PDFImage>, public fonts: Map<string, PDFFont | null>, public glyphs: Map<string, PDFRef>) {}

  private ocNames = new Map<PDFRef, PDFName>();

  /** Begin a marked-content section for an optional-content group (PDF layer). */
  beginLayer(ref: PDFRef) {
    let name = this.ocNames.get(ref);
    if (!name) {
      name = PDFName.of(`OC${this.ocNames.size}`);
      const res = this.resources();
      let props = res.lookupMaybe(PDFName.of('Properties'), PDFDict);
      if (!props) { props = this.doc.context.obj({}); res.set(PDFName.of('Properties'), props); }
      props.set(name, ref);
      this.ocNames.set(ref, name);
    }
    this.push(PDFOperator.of(Op.BeginMarkedContentSequence, [PDFName.of('OC'), name]));
  }

  endLayer() { this.push(PDFOperator.of(Op.EndMarkedContent)); }

  /**
   * Each outlined glyph is written once per document as a Form XObject (in font units, y up)
   * and placed with `Do`; it inherits the current fill colour, so one definition serves every
   * colour and size. This keeps outlined text compact.
   */
  glyph(key: string, d: string): PDFName {
    let ref = this.glyphs.get(key);
    if (!ref) {
      const ops: PDFOperator[] = [];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of parsePath(d)) {
        if (s.c === 'M') ops.push(moveTo(s.x, s.y));
        else if (s.c === 'L') ops.push(lineTo(s.x, s.y));
        else if (s.c === 'C') ops.push(appendBezierCurve(s.x1, s.y1, s.x2, s.y2, s.x, s.y));
        else { ops.push(closePath()); continue; }
        const pts = s.c === 'C' ? [s.x1, s.y1, s.x2, s.y2, s.x, s.y] : [s.x, s.y];
        for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
      }
      ops.push(fill());
      const form = this.doc.context.formXObject(ops, { BBox: [Math.floor(x0) - 1, Math.floor(y0) - 1, Math.ceil(x1) + 1, Math.ceil(y1) + 1] });
      ref = this.doc.context.register(form);
      this.glyphs.set(key, ref);
    }
    let name = this.glyphNames.get(ref);
    if (!name) {
      name = this.page.node.newXObject('G', ref);
      this.glyphNames.set(ref, name);
    }
    return name;
  }

  flush() {
    // Chunked: a dense page has tens of thousands of operators, too many for one spread call.
    for (let i = 0; i < this.ops.length; i += 4000) this.page.pushOperators(...this.ops.slice(i, i + 4000));
    this.ops = [];
  }

  push(...o: PDFOperator[]) { this.ops.push(...o); }

  /* ---- colour */
  swatchOf(hex: string): Swatch | undefined {
    const h = hex.toLowerCase();
    return this.project.brand.palette.find((s) => s.hex.toLowerCase() === h);
  }

  cmykOf(hex: string): [number, number, number, number] {
    const c = this.swatchOf(hex)?.cmyk ?? rgbToCmyk(hex);
    return [c.c / 100, c.m / 100, c.y / 100, c.k / 100];
  }

  setColor(hex: string, strokeColor: boolean, spot: string | null) {
    if (!spot && this.opts.brandSpots) {
      const sw = this.swatchOf(hex);
      if (sw?.spot) {
        const c = sw.cmyk ?? rgbToCmyk(sw.hex);
        if (!SPOTS[`brand:${sw.spot}`]) SPOTS[`brand:${sw.spot}`] = { name: sw.spot.replace(/[^\w\- .]/g, '_'), cmyk: [c.c / 100, c.m / 100, c.y / 100, c.k / 100] };
        spot = `brand:${sw.spot}`;
      }
    }
    if (spot) {
      const name = this.separation(spot);
      this.push(PDFOperator.of(strokeColor ? Op.StrokingColorspace : Op.NonStrokingColorspace, [name]));
      this.push(PDFOperator.of(strokeColor ? Op.StrokingColorN : Op.NonStrokingColorN, [PDFNumber.of(1)]));
      return;
    }
    if (this.opts.colorMode === 'cmyk') {
      const [c, m, y, k] = this.cmykOf(hex);
      this.push(strokeColor ? setStrokingCmykColor(c, m, y, k) : setFillingCmykColor(c, m, y, k));
    } else {
      const { r, g, b } = parseColor(hex);
      this.push(strokeColor ? setStrokingRgbColor(r / 255, g / 255, b / 255) : setFillingRgbColor(r / 255, g / 255, b / 255));
    }
  }

  /** Register a Separation colour space and return its resource name. */
  separation(key: string): PDFName {
    const hit = this.csCache.get(key);
    if (hit) return hit;
    const spot = SPOTS[key] ?? { name: key, cmyk: [0, 0, 0, 1] };
    const ctx = this.doc.context;
    const fn = ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: spot.cmyk, N: 1 });
    const cs = ctx.obj([PDFName.of('Separation'), PDFName.of(spot.name), PDFName.of('DeviceCMYK'), fn]);
    const ref = ctx.register(cs);
    const name = PDFName.of(`CS${this.csCache.size}`);
    const res = this.resources();
    let dict = res.lookupMaybe(PDFName.of('ColorSpace'), PDFDict);
    if (!dict) { dict = ctx.obj({}); res.set(PDFName.of('ColorSpace'), dict); }
    dict.set(name, ref);
    this.csCache.set(key, name);
    return name;
  }

  resources(): PDFDict {
    const node = this.page.node;
    let res = node.Resources();
    if (!res) { res = this.doc.context.obj({}); node.set(PDFName.of('Resources'), res); }
    return res;
  }

  gs(opacity: number, blend: BlendMode | undefined, overprint: boolean, strokeOpacity = opacity): PDFName | null {
    const bm = blend && blend !== 'normal' ? BLEND_NAMES[blend] : undefined;
    if (opacity >= 0.999 && strokeOpacity >= 0.999 && !bm && !overprint) return null;
    const key = `${opacity.toFixed(3)}|${strokeOpacity.toFixed(3)}|${bm ?? ''}|${overprint}`;
    const hit = this.gsCache.get(key);
    if (hit) return hit;
    const dict: Record<string, unknown> = { Type: 'ExtGState', ca: opacity, CA: strokeOpacity };
    if (bm) dict.BM = PDFName.of(bm);
    if (overprint) { dict.OP = true; dict.op = true; dict.OPM = 1; }
    const name = this.page.node.newExtGState('GS', this.doc.context.obj(dict as Record<string, never>) as unknown as PDFDict);
    this.gsCache.set(key, name);
    return name;
  }

  /* ---- paths */
  pathOps(d: string) {
    for (const s of parsePath(d)) {
      if (s.c === 'M') this.push(moveTo(s.x, s.y));
      else if (s.c === 'L') this.push(lineTo(s.x, s.y));
      else if (s.c === 'C') this.push(appendBezierCurve(s.x1, s.y1, s.x2, s.y2, s.x, s.y));
      else this.push(closePath());
    }
  }

  shading(p: Exclude<Paint, string>): PDFName | null {
    if (p.stops.some((s) => s.opacity != null && s.opacity < 0.999)) return null;
    const ctx = this.doc.context;
    const cmykMode = this.opts.colorMode === 'cmyk';
    const col = (s: GradientStop) => (cmykMode ? this.cmykOf(s.color) : (() => { const c = parseColor(s.color); return [c.r / 255, c.g / 255, c.b / 255]; })());
    const stops = [...p.stops].sort((a, b) => a.offset - b.offset);
    const fns = [];
    for (let i = 0; i < stops.length - 1; i++) fns.push(ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: col(stops[i]), C1: col(stops[i + 1]), N: 1 }));
    const func = fns.length === 1
      ? fns[0]
      : ctx.obj({ FunctionType: 3, Domain: [0, 1], Functions: fns, Bounds: stops.slice(1, -1).map((s) => s.offset), Encode: fns.flatMap(() => [0, 1]) });
    const coords = p.kind === 'linear' ? [p.x1, p.y1, p.x2, p.y2] : [p.fx ?? p.cx, p.fy ?? p.cy, 0, p.cx, p.cy, p.r];
    const sh = ctx.obj({ ShadingType: p.kind === 'linear' ? 2 : 3, ColorSpace: PDFName.of(cmykMode ? 'DeviceCMYK' : 'DeviceRGB'), Coords: coords, Function: func, Extend: [true, true] });
    const name = PDFName.of(`Sh${this.shCount++}`);
    const res = this.resources();
    let dict = res.lookupMaybe(PDFName.of('Shading'), PDFDict);
    if (!dict) { dict = ctx.obj({}); res.set(PDFName.of('Shading'), dict); }
    dict.set(name, ctx.register(sh));
    return name;
  }
}

/* -------------------------------------------------------------------------- */
/* Primitive emission                                                           */
/* -------------------------------------------------------------------------- */

interface EmitState { alpha: number; blend?: BlendMode; spot: string | null; ctm: Matrix; overprint?: boolean }

async function emitPrims(w: PageWriter, prims: Prim[], st: EmitState) {
  for (const p of prims) await emitPrim(w, p, st);
}

async function emitPrim(w: PageWriter, p: Prim, st: EmitState) {
  const alpha = st.alpha * (p.opacity ?? 1);
  if (alpha <= 0.001) return;
  const blend = p.blend && p.blend !== 'normal' ? p.blend : st.blend;
  switch (p.t) {
    case 'group': {
      w.push(pushGraphicsState());
      if (p.matrix) w.push(concatTransformationMatrix(...p.matrix));
      if (p.clip) {
        w.pathOps(p.clip);
        w.push(PDFOperator.of(p.clipRule === 'evenodd' ? Op.ClipEvenOdd : Op.ClipNonZero), endPath());
      }
      await emitPrims(w, p.children, { ...st, alpha, blend, ctm: p.matrix ? multiply(st.ctm, p.matrix) : st.ctm });
      w.push(popGraphicsState());
      return;
    }
    case 'path':
      return emitPath(w, p, alpha, blend, st);
    case 'text': {
      // Runs the font engine can outline become vectors; the rest (system fonts, e.g. Japanese
      // Mincho) are rasterised together as one image rather than glyph by glyph.
      const raster: TextRun[] = [];
      for (const r of p.runs) {
        if (canOutline(r.text, r.font)) await emitRun(w, r, alpha, blend, st);
        else raster.push(r);
      }
      if (raster.length) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const r of raster) {
          const ext = r.rotate ? [r.x - r.size * 1.2, r.y - r.size * 0.2, r.x + r.size * 1.2, r.y + r.width + r.size * 0.2] : [r.x - r.size * 0.3, r.y - r.size * 1.15, r.x + r.width + r.size * 0.3, r.y + r.size * 0.45];
          x0 = Math.min(x0, ext[0]); y0 = Math.min(y0, ext[1]); x1 = Math.max(x1, ext[2]); y1 = Math.max(y1, ext[3]);
        }
        await emitRaster(w, [{ t: 'text', runs: raster }], { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, alpha, blend, st);
      }
      return;
    }
    case 'image':
      return emitImage(w, p.href, p.x, p.y, p.w, p.h, p.clip, alpha, blend, p.filter === 'grayscale', st, p.assetId);
    case 'raster':
      return emitRaster(w, [p], { x: p.x, y: p.y, w: p.w, h: p.h }, alpha, blend, st);
  }
}

function emitPath(w: PageWriter, p: PathPrim, alpha: number, blend: BlendMode | undefined, st: EmitState) {
  const isDie = p.role === 'dieline';
  if (isDie && !w.opts.dieline) return;
  const spot = isDie ? 'dieline' : st.spot;
  const fillPaint = p.fill ?? null;
  const strokePaint = p.stroke ?? null;
  const hasStroke = !!strokePaint && (p.strokeWidth ?? 1) > 0;
  if (!fillPaint && !hasStroke) return;

  // Gradient fills → PDF shadings (vector); translucent stops fall back to raster.
  if (fillPaint && typeof fillPaint !== 'string' && !spot) {
    const sh = w.shading(fillPaint);
    if (!sh) {
      const bounds = pathBoundsOf(p.d);
      return void emitRasterSync(w, [{ ...p, stroke: null }], bounds, alpha, blend, st);
    }
    w.push(pushGraphicsState());
    const g = w.gs(alpha, blend, false);
    if (g) w.push(setGraphicsState(g));
    w.pathOps(p.d);
    w.push(PDFOperator.of(p.fillRule === 'evenodd' ? Op.ClipEvenOdd : Op.ClipNonZero), endPath());
    w.push(PDFOperator.of(Op.ShadingFill, [sh]));
    w.push(popGraphicsState());
    if (hasStroke) emitPath(w, { ...p, fill: null }, alpha, blend, st);
    return;
  }

  w.push(pushGraphicsState());
  const g = w.gs(alpha, blend, !!p.overprint || isDie || !!st.overprint);
  if (g) w.push(setGraphicsState(g));
  if (fillPaint) w.setColor(typeof fillPaint === 'string' ? fillPaint : fillPaint.stops[0].color, false, spot);
  if (hasStroke) {
    w.setColor(typeof strokePaint === 'string' ? strokePaint : strokePaint!.stops[0].color, true, spot);
    w.push(setLineWidth(isDie ? 0.5 : p.strokeWidth ?? 1));
    const dash = (p.dash ?? []).filter((v) => v >= 0);
    w.push(setDashPattern(dash.length && dash.some((v) => v > 0) ? dash : [], 0));
    w.push(setLineCap(p.cap === 'round' ? LineCapStyle.Round : p.cap === 'square' ? LineCapStyle.Projecting : LineCapStyle.Butt));
    w.push(setLineJoin(p.join === 'round' ? LineJoinStyle.Round : p.join === 'bevel' ? LineJoinStyle.Bevel : LineJoinStyle.Miter));
  }
  w.pathOps(p.d);
  const evenOdd = p.fillRule === 'evenodd';
  if (fillPaint && hasStroke) w.push(evenOdd ? PDFOperator.of(Op.FillEvenOddAndStroke) : fillAndStroke());
  else if (fillPaint) w.push(evenOdd ? PDFOperator.of(Op.FillEvenOdd) : fill());
  else w.push(stroke());
  w.push(popGraphicsState());
}

function pathBoundsOf(d: string) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of parsePath(d)) {
    if (s.c === 'Z') continue;
    const pts = s.c === 'C' ? [[s.x1, s.y1], [s.x2, s.y2], [s.x, s.y]] : [[s.x, s.y]];
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

async function fontFor(w: PageWriter, r: TextRun): Promise<PDFFont | null> {
  if (w.opts.textMode === 'outline') return null;
  const face = getFace(r.font.face);
  // Variable instances and synthetic obliques are outlined; static faces are embedded & subset.
  if (!face || face.axes.length > 0 || r.font.oblique) return null;
  const bytes = faceBytes(r.font.face);
  if (!bytes) return null;
  const key = `${r.font.face}|${JSON.stringify(r.font.features)}`;
  if (w.fonts.has(key)) return w.fonts.get(key)!;
  try {
    const f = await w.doc.embedFont(bytes, { subset: true, features: { ...r.font.features } as Record<string, boolean> });
    w.fonts.set(key, f);
    return f;
  } catch {
    w.fonts.set(key, null);
    return null;
  }
}

async function emitRun(w: PageWriter, r: TextRun, alpha: number, blend: BlendMode | undefined, st: EmitState) {
  w.push(pushGraphicsState());
  // Run-level transforms (sideways Latin in tategaki, tate-chū-yoko compression).
  if (r.rotate) {
    const a = (r.rotate * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    w.push(concatTransformationMatrix(c, s, -s, c, r.x - c * r.x + s * r.y, r.y - s * r.x - c * r.y));
  }
  if (r.scaleX && r.scaleX !== 1) w.push(concatTransformationMatrix(r.scaleX, 0, 0, 1, r.x - r.scaleX * r.x, 0));
  const g = w.gs(alpha, blend, false);
  if (g) w.push(setGraphicsState(g));
  const ls = r.letterSpacing ?? 0;

  const pdfFont = !st.spot && canOutline(r.text, r.font) ? await fontFor(w, r) : null;
  if (pdfFont) {
    w.push(concatTransformationMatrix(1, 0, 0, -1, r.x, r.y));
    if (ls) w.push(setCharacterSpacing(ls));
    await w.pendingImages();
    w.flush();
    const color = st.spot ? cmyk(...SPOTS[st.spot]?.cmyk ?? [0, 0, 0, 1]) : w.opts.colorMode === 'cmyk' ? cmyk(...w.cmykOf(r.color)) : (() => { const c = parseColor(r.color); return rgb(c.r / 255, c.g / 255, c.b / 255); })();
    const shaped = shape(r.text, r.font)!;
    const gk = glyphKerns(shaped, r.kern);
    if (!gk) w.page.drawText(r.text, { x: 0, y: 0, size: r.size, font: pdfFont, color });
    else {
      // Kerned pairs: split the run where a kern falls, placing each piece from the whole run's
      // advances so the text stays live (searchable) and lands exactly where the layout put it.
      let x = 0, u = 0, from = 0, x0 = 0;
      shaped.glyphs.forEach((g, i) => {
        u += Math.max(1, g.units);
        x += g.xAdvance * r.size + ls;
        if (gk[i] || i === shaped.glyphs.length - 1) {
          w.page.drawText(r.text.slice(from, u), { x: x0, y: 0, size: r.size, font: pdfFont, color });
          x += gk[i];
          from = u;
          x0 = x;
        }
      });
    }
    if (ls) w.push(setCharacterSpacing(0));
  } else if (canOutline(r.text, r.font)) {
    w.setColor(r.color, false, st.spot);
    const shaped = shape(r.text, r.font)!;
    const gk = glyphKerns(shaped, r.kern);
    let x = 0;
    for (let gi = 0; gi < shaped.glyphs.length; gi++) {
      const gl = shaped.glyphs[gi];
      const gp = glyphPath(r.font, gl.id);
      if (gp && gp.d) {
        const k = r.size / gp.upm;
        const name = w.glyph(`${r.font.face}|${JSON.stringify(r.font.axes)}|${gl.id}`, gp.d);
        w.push(pushGraphicsState());
        w.push(concatTransformationMatrix(k, 0, 0, -k, r.x + x + gl.xOffset * r.size, r.y - gl.yOffset * r.size));
        if (r.font.oblique) w.push(concatTransformationMatrix(1, 0, Math.tan((12 * Math.PI) / 180), 1, 0, 0));
        w.push(drawObject(name));
        w.push(popGraphicsState());
      }
      x += gl.xAdvance * r.size + ls + (gk ? gk[gi] : 0);
    }
  } else {
    // System font / uncovered script: rasterise the run at print resolution.
    const pad = r.size * 0.4;
    const box = { x: r.x - pad, y: r.y - r.size * 1.1, w: r.width + pad * 2, h: r.size * 1.6 };
    w.push(popGraphicsState());
    await emitRaster(w, [{ t: 'text', runs: [{ ...r, rotate: undefined, scaleX: undefined }] }], box, alpha, blend, st, r.rotate || r.scaleX ? r : undefined);
    return;
  }
  w.push(popGraphicsState());
}

async function dataUrlBytes(src: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetch(src);
  const blob = await res.blob();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}

/** Fully opaque rasters (glows, textures, full-bleed paint) go in as JPEG; anything with alpha as PNG. */
function isOpaque(c: HTMLCanvasElement): boolean {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const stride = Math.max(1, Math.floor((c.width * c.height) / 400000));
  for (let p = 0; p < c.width * c.height; p += stride) if (data[p * 4 + 3] < 254) return false;
  return true;
}

async function embedCanvas(w: PageWriter, c: HTMLCanvasElement): Promise<PDFImage> {
  if (isOpaque(c)) {
    const jpg = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.93));
    return w.doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
  }
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
  return w.doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
}

function drawImageXObject(w: PageWriter, img: PDFImage, x: number, y: number, width: number, height: number) {
  const name = w.page.node.newXObject('Im', img.ref);
  // Our space is y-down; an image paints the unit square y-up, so flip it.
  w.push(pushGraphicsState(), concatTransformationMatrix(width, 0, 0, -height, x, y + height), drawObject(name), popGraphicsState());
}

async function emitImage(w: PageWriter, href: string, x: number, y: number, width: number, height: number, clipRect: { x: number; y: number; w: number; h: number } | undefined, alpha: number, blend: BlendMode | undefined, grayscale: boolean, st: EmitState, assetId?: string) {
  if (grayscale) {
    return emitRaster(w, [{ t: 'image', href, x, y, w: width, h: height, clip: clipRect, filter: 'grayscale' }], clipRect ?? { x, y, w: width, h: height }, alpha, blend, st);
  }
  const key = assetId ?? href.slice(0, 120) + href.length;
  let img = w.images.get(key);
  if (!img) {
    const { bytes, mime } = await dataUrlBytes(href);
    try {
      img = mime.includes('jpeg') || mime.includes('jpg') ? await w.doc.embedJpg(bytes) : mime.includes('png') ? await w.doc.embedPng(bytes) : await embedCanvas(w, rasterizeHref(href, width, height, w.opts.rasterDpi));
    } catch {
      img = await embedCanvas(w, rasterizeHref(href, width, height, w.opts.rasterDpi));
    }
    w.images.set(key, img);
  }
  w.push(pushGraphicsState());
  const g = w.gs(alpha, blend, false);
  if (g) w.push(setGraphicsState(g));
  if (clipRect) {
    w.push(moveTo(clipRect.x, clipRect.y), lineTo(clipRect.x + clipRect.w, clipRect.y), lineTo(clipRect.x + clipRect.w, clipRect.y + clipRect.h), lineTo(clipRect.x, clipRect.y + clipRect.h), closePath());
    w.push(PDFOperator.of(Op.ClipNonZero), endPath());
  }
  drawImageXObject(w, img, x, y, width, height);
  w.push(popGraphicsState());
}

function rasterizeHref(href: string, width: number, height: number, dpi: number): HTMLCanvasElement {
  return renderToCanvas([{ t: 'image', href, x: 0, y: 0, w: width, h: height }], { x: 0, y: 0, w: width, h: height }, Math.min(dpi / 72, 8192 / Math.max(width, height)));
}

async function emitRaster(w: PageWriter, prims: Prim[], box: { x: number; y: number; w: number; h: number }, alpha: number, blend: BlendMode | undefined, st: EmitState, runTransform?: TextRun) {
  await preloadImages(prims);
  emitRasterSync(w, prims, box, alpha, blend, st, runTransform);
  await w.pendingImages();
}

function emitRasterSync(w: PageWriter, prims: Prim[], box: { x: number; y: number; w: number; h: number }, alpha: number, blend: BlendMode | undefined, _st: EmitState, runTransform?: TextRun) {
  // Resolution: requested dpi, bounded so huge areas stay under ~8k pixels.
  const ppp = Math.max(0.5, Math.min(w.opts.rasterDpi / 72, 8000 / Math.max(box.w, box.h)));
  const canvas = renderToCanvas(prims, box, ppp, { hideDieLines: true });
  w.queueImage(canvas, (img) => {
    w.push(pushGraphicsState());
    if (runTransform?.rotate) {
      const a = (runTransform.rotate * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      w.push(concatTransformationMatrix(c, s, -s, c, runTransform.x - c * runTransform.x + s * runTransform.y, runTransform.y - s * runTransform.x - c * runTransform.y));
    }
    const g = w.gs(alpha, blend, false);
    if (g) w.push(setGraphicsState(g));
    drawImageXObject(w, img, box.x, box.y, box.w, box.h);
    w.push(popGraphicsState());
  });
}

/* Queued raster images: embedding is async, but operator order must be preserved. */
declare module 'pdf-lib' { interface PDFPage { __bdsQueue?: unknown } }
interface QueueItem { canvas: HTMLCanvasElement; then: (img: PDFImage) => void; index: number }
interface PageWriter { queue: QueueItem[]; queueImage: (c: HTMLCanvasElement, then: (img: PDFImage) => void) => void; pendingImages: () => Promise<void> }
PageWriter.prototype.queueImage = function queueImage(this: PageWriter, canvas: HTMLCanvasElement, then: (img: PDFImage) => void) {
  // Reserve the position in the operator stream with a placeholder.
  if (!this.queue) this.queue = [];
  const index = this.ops.length;
  this.ops.push(PDFOperator.of(Op.EndPath)); // harmless placeholder, replaced below
  this.queue.push({ canvas, then, index });
};
PageWriter.prototype.pendingImages = async function pendingImages(this: PageWriter) {
  if (!this.queue?.length) return;
  const items = this.queue.splice(0);
  for (const it of items.reverse()) {
    const img = await embedCanvas(this, it.canvas);
    const before = this.ops.slice(0, it.index);
    const after = this.ops.slice(it.index + 1);
    this.ops = before;
    it.then(img);
    this.ops.push(...after);
  }
};

/* -------------------------------------------------------------------------- */
/* Elements & surfaces                                                          */
/* -------------------------------------------------------------------------- */

const FOILS = new Set<Finish>(['gold-foil', 'silver-foil', 'copper-foil', 'holo-foil']);
const PLATES = new Set<Finish>(['emboss', 'blind-deboss', 'spot-gloss', 'white-base']);

async function emitElement(w: PageWriter, el: Element, ctx: CompileContext, plate: Finish | null) {
  if (el.hidden) return;
  const prims = compileElement(el, ctx);
  const o = anchorOffsetOf(el, ctx.surface);
  const m = elementMatrix(el, o.x, o.y);
  const foil = w.opts.finishSpots && el.finish && FOILS.has(el.finish) ? el.finish : null;
  const spot = plate ?? foil;
  w.push(pushGraphicsState(), concatTransformationMatrix(...m));
  // Raster-native media (mesh gradients, brush drawings) are flattened into one image.
  const flatten = el.type === 'gradient' || el.type === 'drawing';
  if (flatten && !spot) {
    const g = w.gs(el.opacity, el.blend, false);
    if (g) w.push(setGraphicsState(g));
    await emitRaster(w, prims, { x: 0, y: 0, w: el.w, h: el.h }, 1, undefined, { alpha: 1, spot: null, ctm: m });
    w.push(popGraphicsState());
    return;
  }
  await emitPrims(w, prims, { alpha: plate ? 1 : el.opacity, blend: plate ? undefined : el.blend, spot, ctm: m, overprint: !!plate });
  await w.pendingImages();
  w.push(popGraphicsState());
}

function pathOpsOf(w: PageWriter, d: string) { w.pathOps(d); }

function rectOps(w: PageWriter, x: number, y: number, ww: number, h: number) {
  w.push(moveTo(x, y), lineTo(x + ww, y), lineTo(x + ww, y + h), lineTo(x, y + h), closePath());
}

function drawMarks(w: PageWriter, tw: number, th: number, bleed: number) {
  const o = w.opts;
  const reg = () => w.setColor('#000000', true, 'registration');
  const line = (x1: number, y1: number, x2: number, y2: number) => w.push(moveTo(x1, y1), lineTo(x2, y2));
  const off = bleed + 3, len = 14;
  if (o.cropMarks) {
    w.push(pushGraphicsState());
    reg();
    w.push(setLineWidth(0.25));
    for (const [cx, cy, sx, sy] of [[0, 0, -1, -1], [tw, 0, 1, -1], [0, th, -1, 1], [tw, th, 1, 1]] as const) {
      line(cx + sx * off, cy, cx + sx * (off + len), cy);
      line(cx, cy + sy * off, cx, cy + sy * (off + len));
    }
    w.push(stroke(), popGraphicsState());
  }
  if (o.bleedMarks && bleed > 0) {
    w.push(pushGraphicsState());
    reg();
    w.push(setLineWidth(0.25), setDashPattern([2, 1.5], 0));
    for (const [cx, cy, sx, sy] of [[-bleed, -bleed, -1, -1], [tw + bleed, -bleed, 1, -1], [-bleed, th + bleed, -1, 1], [tw + bleed, th + bleed, 1, 1]] as const) {
      line(cx + sx * 3, cy, cx + sx * 9, cy);
      line(cx, cy + sy * 3, cx, cy + sy * 9);
    }
    w.push(stroke(), popGraphicsState());
  }
  if (o.registration) {
    const targets = [[tw / 2, -off - 9], [tw / 2, th + off + 9], [-off - 9, th / 2], [tw + off + 9, th / 2]];
    w.push(pushGraphicsState());
    reg();
    w.push(setLineWidth(0.25));
    for (const [cx, cy] of targets) {
      const r = 4.5, k = r * 0.5523;
      w.push(moveTo(cx - r, cy), appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r), appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
        appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r), appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy), closePath());
      line(cx - 8, cy, cx + 8, cy);
      line(cx, cy - 8, cx, cy + 8);
    }
    w.push(stroke(), popGraphicsState());
  }
  if (o.colorBars) {
    const sw = 9, y = th + off + 2;
    const patches: [number, number, number, number][] = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [1, 1, 0, 0], [0, 1, 1, 0], [1, 0, 1, 0], [0.5, 0, 0, 0], [0, 0.5, 0, 0], [0, 0, 0.5, 0], [0, 0, 0, 0.5], [0, 0, 0, 0.25]];
    patches.forEach((c, i) => {
      w.push(pushGraphicsState(), setFillingCmykColor(...c), moveTo(8 + i * sw, y), lineTo(8 + (i + 1) * sw, y), lineTo(8 + (i + 1) * sw, y + sw), lineTo(8 + i * sw, y + sw), closePath(), fill(), popGraphicsState());
    });
  }
}

/** Text in the page's y-down space with a standard font (slug line, info layer). */
async function label(w: PageWriter, font: PDFFont, text: string, x: number, y: number, size: number, color: [number, number, number, number], rotate = 0) {
  await w.pendingImages();
  w.flush();
  const a = (rotate * Math.PI) / 180;
  w.push(pushGraphicsState(), concatTransformationMatrix(Math.cos(a), Math.sin(a), Math.sin(a), -Math.cos(a), x, y));
  w.flush();
  w.page.drawText(text.replace(/[^\x20-\x7e]/g, (c) => ({ '×': 'x', '·': '-', '—': '-', '–': '-', '°': ' deg', 'Ø': 'D ' } as Record<string, string>)[c] ?? '?'), { x: 0, y: 0, size, font, color: cmyk(...color) });
  w.push(popGraphicsState());
  w.flush();
}

interface Layers { artwork: PDFRef; cut: PDFRef; fold: PDFRef; glue: PDFRef; info: PDFRef; marks: PDFRef }

function makeLayers(doc: PDFDocument): Layers {
  const ctx = doc.context;
  const ocg = (name: string, print = true) => ctx.register(ctx.obj({
    Type: 'OCG', Name: PDFString.of(name),
    ...(print ? {} : { Usage: { Print: { PrintState: 'OFF' }, View: { ViewState: 'ON' } } }),
  } as never));
  const layers: Layers = {
    artwork: ocg('Artwork'), cut: ocg('Dieline - CutContour'), fold: ocg('Dieline - Fold'), glue: ocg('Dieline - Glue'),
    info: ocg('Info (non-printing)', false), marks: ocg('Printer marks'),
  };
  const all = Object.values(layers);
  doc.catalog.set(PDFName.of('OCProperties'), ctx.obj({
    OCGs: all,
    D: { Name: PDFString.of('Default'), Order: all, ON: all, OFF: [], AS: [{ Event: 'Print', OCGs: [layers.info], Category: ['Print'] }] },
  } as never));
  return layers;
}

const transparentColor = (c: string) => !c || c === 'transparent' || /^#[0-9a-f]{6}00$/i.test(c);
const mmStr = (pt: number) => `${(+fromPt(pt, 'mm').toFixed(1))}`;

async function surfacePage(doc: PDFDocument, project: Project, product: Product, s: DielineSurface, opts: PdfOptions, shared: { images: Map<string, PDFImage>; fonts: Map<string, PDFFont | null>; glyphs: Map<string, PDFRef>; layers: Layers; helv: PDFFont }) {
  const bl = opts.bleed && s.cutKind !== 'none' ? s.bleed : 0;
  const marks = opts.cropMarks || opts.registration || opts.colorBars || opts.pageInfo || opts.bleedMarks;
  const slug = marks || opts.info ? 64 : 0;
  const W = s.w, H = s.h;
  const page = doc.addPage([W + 2 * (bl + slug), H + 2 * (bl + slug)]);
  const ox = bl + slug, oy = bl + slug;
  page.setTrimBox(ox, oy, W, H);
  page.setBleedBox(ox - bl, oy - bl, W + 2 * bl, H + 2 * bl);
  const w = new PageWriter(doc, page, project, opts, shared.images, shared.fonts, shared.glyphs);
  w.push(concatTransformationMatrix(1, 0, 0, -1, 0, page.getHeight()));
  w.push(concatTransformationMatrix(1, 0, 0, 1, ox, oy));
  const art = product.surfaces[s.id];
  const ctx: CompileContext = { project, product, surface: s };
  const els = (art?.elements ?? []).filter((e) => !e.hidden);

  // Artwork, clipped to the bleed outline of the die (or the cut / print area).
  w.beginLayer(shared.layers.artwork);
  w.push(pushGraphicsState());
  if (s.cutKind === 'none') rectOps(w, 0, 0, W, H);
  else if (bl > 0) pathOpsOf(w, bleedPath(s));
  else pathOpsOf(w, piecePath(s));
  w.push(PDFOperator.of(Op.ClipNonZero), endPath());
  if (opts.substrate && !transparentColor(s.substrate)) { w.setColor(s.substrate, false, null); rectOps(w, -bl, -bl, W + 2 * bl, H + 2 * bl); w.push(fill()); }
  if (art?.background) { w.setColor(art.background, false, null); rectOps(w, -bl, -bl, W + 2 * bl, H + 2 * bl); w.push(fill()); }
  for (const [i, el] of els.entries()) {
    opts.onProgress?.(i / Math.max(1, els.length), `${product.name} · ${s.label}`);
    await emitElement(w, el, ctx, null);
  }
  // Finishing plates (emboss, deboss, spot UV, white base) overprint on their own separations.
  if (opts.finishSpots) for (const el of els) if (el.finish && PLATES.has(el.finish)) await emitElement(w, el, ctx, el.finish);
  w.push(popGraphicsState());
  w.endLayer();

  // Dieline on spot layers.
  if (opts.dieline && s.cutKind !== 'none') {
    w.beginLayer(shared.layers.cut);
    w.push(pushGraphicsState());
    const g = w.gs(1, undefined, true);
    if (g) w.push(setGraphicsState(g));
    w.setColor('#ff00ff', true, 'dieline');
    w.push(setLineWidth(0.25));
    for (const [a, b] of cutSegments(s)) w.push(moveTo(a.x, a.y), lineTo(b.x, b.y));
    for (const h of s.holes ?? []) pathOpsOf(w, polyToPath(h));
    w.push(stroke(), popGraphicsState());
    w.endLayer();
  }
  if (opts.dieline && s.folds.length) {
    w.beginLayer(shared.layers.fold);
    w.push(pushGraphicsState());
    const g = w.gs(1, undefined, true);
    if (g) w.push(setGraphicsState(g));
    w.setColor('#00aaff', true, 'fold');
    w.push(setLineWidth(0.25));
    for (const f of s.folds) {
      w.push(setDashPattern(f.kind === 'perf' ? [3, 2] : f.kind === 'reverse' ? [6, 2, 1, 2] : [], 0));
      f.pts.forEach((p, i) => w.push(i ? lineTo(p.x, p.y) : moveTo(p.x, p.y)));
      w.push(stroke());
    }
    w.push(popGraphicsState());
    w.endLayer();
  }
  const glue = s.zones.filter((z) => z.kind === 'glue');
  if (opts.dieline && glue.length) {
    w.beginLayer(shared.layers.glue);
    w.push(pushGraphicsState());
    const g = w.gs(1, undefined, true);
    if (g) w.push(setGraphicsState(g));
    w.setColor('#ffff00', false, 'glue');
    for (const z of glue) pathOpsOf(w, polyToPath(z.poly));
    w.push(fill(), popGraphicsState());
    w.endLayer();
  }

  // Non-printing info: panel names, safe areas and dimensions.
  if (opts.info) {
    w.beginLayer(shared.layers.info);
    w.push(pushGraphicsState(), setStrokingCmykColor(0.6, 0, 0.6, 0), setLineWidth(0.3), setDashPattern([2, 2], 0));
    for (const p of s.panels) if (p.safe > 0 && p.role !== 'glue') rectOps(w, p.x + p.safe, p.y + p.safe, p.w - 2 * p.safe, p.h - 2 * p.safe);
    w.push(stroke(), popGraphicsState());
    for (const p of s.panels) if (s.panels.length > 1 && p.w > 40) await label(w, shared.helv, `${p.label}${p.read ? ` (art ${p.read} deg)` : ''}`, p.x + 3, p.y + 9, 6, [0.8, 0.2, 0, 0]);
    for (const d of s.dims) {
      const dx = d.b.x - d.a.x, dy = d.b.y - d.a.y, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const a = { x: d.a.x + nx * d.offset, y: d.a.y + ny * d.offset }, b = { x: d.b.x + nx * d.offset, y: d.b.y + ny * d.offset };
      w.push(pushGraphicsState(), setStrokingCmykColor(0, 0, 0, 0.7), setLineWidth(0.3), moveTo(a.x, a.y), lineTo(b.x, b.y), moveTo(d.a.x, d.a.y), lineTo(a.x, a.y), moveTo(d.b.x, d.b.y), lineTo(b.x, b.y), stroke(), popGraphicsState());
      const text = d.label ?? `${mmStr(len)} mm`;
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      await label(w, shared.helv, text.replace(/\s+mm/g, ' mm'), (a.x + b.x) / 2 - (Math.abs(ang) < 45 ? text.length * 1.6 : -3), (a.y + b.y) / 2 - 2, 6.5, [0, 0, 0, 0.8], Math.abs(ang) < 45 || Math.abs(ang) > 135 ? 0 : 90);
    }
    w.endLayer();
  }

  // Printer marks and the slug line.
  w.beginLayer(shared.layers.marks);
  drawMarks(w, W, H, bl);
  w.flush();
  if (opts.pageInfo) {
    const t = getTemplate(product.template);
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    await label(w, shared.helv, `${project.brand.name} - ${product.name} (${t.name}) - ${s.label} - ${mmStr(W)} x ${mmStr(H)} mm - bleed ${mmStr(bl)} mm - ${stamp}`, opts.colorBars ? 8 + 12 * 9 + 10 : 0, H + bl + slug * 0.42, 6, [0, 0, 0, 1]);
  }
  w.endLayer();
  w.flush();
}

/** One PDF with a page per surface of each product. */
export async function exportPdf(project: Project, products: Product[], opts: PdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${project.brand.name} — ${products.map((p) => p.name).join(', ')}`);
  doc.setAuthor(project.brand.name);
  doc.setCreator('Branding Studio');
  doc.setProducer('Branding Studio (pdf-lib)');
  doc.setCreationDate(new Date());
  const shared = { images: new Map<string, PDFImage>(), fonts: new Map<string, PDFFont | null>(), glyphs: new Map<string, PDFRef>(), layers: makeLayers(doc), helv: await doc.embedFont(StandardFonts.Helvetica) };
  for (const product of products) {
    const d = dielineOf(product);
    void optionsOf(product);
    for (const s of d.surfaces) {
      if (opts.surfaces.length && !opts.surfaces.includes(s.id)) continue;
      await surfacePage(doc, project, product, s, opts, shared);
    }
  }
  opts.onProgress?.(1, 'Writing file');
  return doc.save();
}

export { PDFArray, PDFRef };
