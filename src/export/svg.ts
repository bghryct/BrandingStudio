/**
 * SVG and PNG export of a product surface: the artwork (clipped to the bleed), with the dieline
 * as separate named groups (Illustrator and Figma read the ids as layer names).
 */
import type { Product, Project } from '../model/types';
import { compileSurface } from '../render/compile';
import { primsToSvg } from '../render/svgString';
import { renderToCanvas, preloadImages } from '../render/canvasBackend';
import { surfaceOf, cutPath } from '../products';
import { polyToPath } from '../products/geom';
import type { Prim } from '../render/primitives';

export interface SurfaceExportOptions {
  surfaceId: string;
  /** Include the bleed around the cut. */
  bleed: boolean;
  /** Add the dieline (cut, folds) as its own layer. */
  dieline: boolean;
  /** Text as outlines (identical everywhere) or live text. */
  outlineText: boolean;
  /** Paint the substrate colour under the art. */
  substrate: boolean;
  rasterScale: number;
}

function build(project: Project, product: Product, o: SurfaceExportOptions) {
  const s = surfaceOf(product, o.surfaceId);
  if (!s) throw new Error('Unknown surface');
  const b = o.bleed && s.cutKind !== 'none' ? s.bleed : 0;
  const prims = compileSurface(project, product, s.id, { substrate: o.substrate, clip: true });
  const die: Prim[] = [];
  if (o.dieline && s.cutKind !== 'none') die.push({ t: 'path', d: cutPath(s), stroke: '#ec008c', strokeWidth: 0.5, fill: null });
  const folds: Prim[] = o.dieline ? s.folds.map((f) => ({ t: 'path' as const, d: polyToPath(f.pts, false), stroke: '#00a0e9', strokeWidth: 0.5, dash: f.kind === 'perf' ? [3, 2] : [4, 2], fill: null })) : [];
  return { s, prims, die, folds, box: { x: -b, y: -b, w: s.w + 2 * b, h: s.h + 2 * b } };
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
export const fileStem = (project: Project, product: Product, surfaceId: string) =>
  `${project.brand.name}-${product.name}-${surfaceId}`.replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();

export async function exportSurfaceSvg(project: Project, product: Product, o: SurfaceExportOptions): Promise<{ blob: Blob; name: string }> {
  const { s, prims, die, folds, box } = build(project, product, o);
  await preloadImages(prims);
  const pt = (v: number) => +v.toFixed(3);
  const opts = { pxPerPt: o.rasterScale, outlineText: o.outlineText };
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${pt(box.w)}pt" height="${pt(box.h)}pt" viewBox="${pt(box.x)} ${pt(box.y)} ${pt(box.w)} ${pt(box.h)}">
<title>${esc(`${project.brand.name} — ${product.name} — ${s.label}`)}</title>
<desc>Exported from Branding Studio. 1 user unit = 1 pt. Dieline: CutContour (magenta) and Fold (cyan) layers.</desc>
<g id="Artwork">${primsToSvg(prims, { ...opts, idPrefix: 'art' })}</g>
${die.length ? `<g id="CutContour">${primsToSvg(die, { ...opts, idPrefix: 'cut' })}</g>` : ''}
${folds.length ? `<g id="Fold">${primsToSvg(folds, { ...opts, idPrefix: 'fold' })}</g>` : ''}
</svg>`;
  return { blob: new Blob([svg], { type: 'image/svg+xml' }), name: `${fileStem(project, product, s.id)}.svg` };
}

export async function exportSurfacePng(project: Project, product: Product, o: SurfaceExportOptions & { dpi: number; transparent: boolean }): Promise<{ blob: Blob; name: string }> {
  const { s, prims, die, folds, box } = build(project, product, o);
  const all = [...prims, ...die, ...folds];
  await preloadImages(all);
  const ppp = Math.min(o.dpi / 72, 12000 / Math.max(box.w, box.h));
  const canvas = renderToCanvas(all, box, ppp, o.transparent ? {} : { background: '#ffffff' });
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
  return { blob, name: `${fileStem(project, product, s.id)}.png` };
}
