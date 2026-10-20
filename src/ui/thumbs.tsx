import React, { useMemo } from 'react';
import type { Product, Project } from '../model/types';
import { compileSurface } from '../render/compile';
import { primsToSvg } from '../render/svgString';
import { dielineOf, surfaceOf, cutPath } from '../products';
import { useFontStore } from '../engine/fonts';

const cache = new WeakMap<Product, Map<string, string>>();

/** SVG markup of a surface's artwork (cut shape, ground, items), memoised on product identity. */
export function surfaceMarkup(project: Project, product: Product, surfaceId: string, withCut: boolean, version: number): { html: string; box: { x: number; y: number; w: number; h: number } } | null {
  const s = surfaceOf(product, surfaceId);
  if (!s) return null;
  const pad = Math.max(s.bleed, 2);
  const box = { x: -pad, y: -pad, w: s.w + 2 * pad, h: s.h + 2 * pad };
  const key = `${surfaceId}|${version}|${withCut}|${project.brand === lastBrand ? brandId : (lastBrand = project.brand, ++brandId)}`;
  let m = cache.get(product);
  if (!m) { m = new Map(); cache.set(product, m); }
  let html = m.get(key);
  if (!html) {
    const prims = compileSurface(project, product, surfaceId, { substrate: true });
    html = primsToSvg(prims, { pxPerPt: 0.6, idPrefix: `t${product.id}${surfaceId}`.replace(/[^a-z0-9]/gi, '') });
    if (withCut && s.cutKind !== 'none') html += `<path d="${cutPath(s)}" fill="none" stroke="rgba(255,45,111,0.7)" stroke-width="${Math.max(0.6, s.w / 200)}"/>`;
    if (m.size > 12) m.clear();
    m.set(key, html);
  }
  return { html, box };
}
let lastBrand: object | null = null;
let brandId = 0;

export function SurfaceThumb({ project, product, surfaceId, width, height, withCut = false, className }: { project: Project; product: Product; surfaceId?: string; width: number; height: number; withCut?: boolean; className?: string }) {
  const version = useFontStore((s) => s.version);
  const sid = surfaceId ?? dielineOf(product).surfaces[0]?.id ?? '';
  const m = useMemo(() => surfaceMarkup(project, product, sid, withCut, version), [project, product, sid, withCut, version]);
  if (!m) return <div style={{ width, height }} />;
  return (
    <svg width={width} height={height} viewBox={`${m.box.x} ${m.box.y} ${m.box.w} ${m.box.h}`} preserveAspectRatio="xMidYMid meet" className={className}>
      <g dangerouslySetInnerHTML={{ __html: m.html }} />
    </svg>
  );
}
