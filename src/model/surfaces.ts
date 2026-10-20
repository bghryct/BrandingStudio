import type { Element, ID, Product, Project, SurfaceKey } from './types';
import { parseSurfaceKey, surfaceKey, dielineOf, surfaceOf } from '../products';
import { blankArt } from './factory';

export { surfaceKey, parseSurfaceKey };

export function productOf(project: Project, id: ID | null | undefined): Product | null {
  return project.products.find((p) => p.id === id) ?? null;
}

export function surfaceElements(project: Project, key: SurfaceKey): Element[] {
  const { productId, surfaceId } = parseSurfaceKey(key);
  return productOf(project, productId)?.surfaces[surfaceId]?.elements ?? [];
}

/** Element array of a surface inside an immer draft (created on demand). */
export function surfaceElementsDraft(project: Project, key: SurfaceKey): Element[] | null {
  const { productId, surfaceId } = parseSurfaceKey(key);
  const p = project.products.find((x) => x.id === productId);
  if (!p) return null;
  if (!p.surfaces[surfaceId]) {
    const s = surfaceOf(p, surfaceId);
    p.surfaces[surfaceId] = blankArt(s?.defaultGround ?? null);
  }
  return p.surfaces[surfaceId].elements;
}

export interface Located { key: SurfaceKey; el: Element; index: number; productId: ID; surfaceId: string }

export function findElement(project: Project, id: ID): Located | null {
  for (const p of project.products) {
    for (const [sid, art] of Object.entries(p.surfaces)) {
      const i = art.elements.findIndex((e) => e.id === id);
      if (i >= 0) return { key: surfaceKey(p.id, sid), el: art.elements[i], index: i, productId: p.id, surfaceId: sid };
    }
  }
  return null;
}

/** Surface ids of a product in dieline order. */
export const surfaceIds = (p: Product) => dielineOf(p).surfaces.map((s) => s.id);

export const guidesOf = (project: Project, key: SurfaceKey) => project.guides?.[key] ?? { x: [], y: [] };
