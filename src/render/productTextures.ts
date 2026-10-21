/**
 * Rasterise a product's surfaces (and their finish masks) for the 3D mockup with the canvas
 * back-end, so text is drawn from the same glyph outlines as the PDF. Canvases cover each
 * surface's bleed box and stay transparent where nothing is printed (bare metal, clear film,
 * fabric).
 */
import type { Element, Finish, Product, Project } from '../model/types';
import type { FinishKey, SurfaceTextures } from '../three/types';
import { compileSurface } from './compile';
import { renderToCanvas, preloadImages } from './canvasBackend';
import { dielineOf } from '../products';

const FINISHES: FinishKey[] = ['gold-foil', 'silver-foil', 'copper-foil', 'holo-foil', 'blind-deboss', 'emboss', 'spot-gloss', 'white-base'];

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function toMask(c: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = c.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

export interface TextureBuildOptions {
  /** Base size: longest edge of a surface's art (px), at most 5 px per pt. */
  maxPx?: number;
  /** Sharpened: the density the view asks for (px per pt), within `maxEdge` and `maxPixels`. */
  ppp?: number;
  maxEdge?: number;
  maxPixels?: number;
  signal?: { cancelled: boolean };
}

/** Density a surface is rasterised at for these options (px per pt). */
export function surfaceDensity(box: { w: number; h: number }, o: TextureBuildOptions): number {
  const base = Math.min(5, (o.maxPx ?? 2048) / Math.max(box.w, box.h));
  if (!o.ppp || o.ppp <= base) return base;
  return Math.max(base, Math.min(o.ppp, (o.maxEdge ?? 8192) / Math.max(box.w, box.h), Math.sqrt((o.maxPixels ?? 16e6) / (box.w * box.h))));
}

export async function buildProductTextures(project: Project, product: Product, o: TextureBuildOptions = {}): Promise<SurfaceTextures | null> {
  const out: SurfaceTextures = {};
  for (const s of dielineOf(product).surfaces) {
    if (o.signal?.cancelled) return null;
    const box = { x: -s.bleed, y: -s.bleed, w: s.w + 2 * s.bleed, h: s.h + 2 * s.bleed };
    const ppp = surfaceDensity(box, o);
    const prims = compileSurface(project, product, s.id, { ground: true, substrate: false });
    await preloadImages(prims);
    if (o.signal?.cancelled) return null;
    const art = renderToCanvas(prims, box, ppp, { hideDieLines: true });
    const masks: SurfaceTextures[string]['masks'] = {};
    const els = product.surfaces[s.id]?.elements ?? [];
    const used = new Set(els.filter((e) => !e.hidden).map((e) => e.finish).filter((f): f is Finish => !!f && f !== 'none'));
    for (const f of FINISHES) {
      if (!used.has(f)) continue;
      const mp = compileSurface(project, product, s.id, { ground: false, substrate: false, filter: (el: Element) => el.finish === f });
      masks[f] = toMask(renderToCanvas(mp, box, ppp, { hideDieLines: true }));
    }
    out[s.id] = { art, masks, box, hasGround: !!product.surfaces[s.id]?.background };
    await tick();
  }
  return out;
}
