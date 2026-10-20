import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { BrushType, Element, ID, OptionValue, Project, SurfaceKey } from '../model/types';
import { createStarterProject } from '../model/defaults';
import { findElement, surfaceElementsDraft, surfaceKey } from '../model/surfaces';
import { cloneElement, makeProduct, blankArt } from '../model/factory';
import { idbGet, idbSet } from '../lib/idb';
import { dielineOf, getTemplate, optionsOf } from '../products';
import { uid } from '../lib/random';

export type View = 'design' | '3d' | 'board';

export type Tool =
  | 'select' | 'node' | 'hand' | 'zoom'
  | 'text' | 'rect' | 'ellipse' | 'polygon' | 'line' | 'pen' | 'image'
  | 'brush' | 'eraser'
  | 'pattern' | 'gradient' | 'logo' | 'barcode';

export interface BrushSettings {
  type: BrushType;
  size: number;
  opacity: number;
  color: string;
  flow: number;
  hardness: number;
  grain: number;
  wetness: number;
  angle: number;
  stabilizer: number;
  pressure: boolean;
}

export type RightTab = 'item' | 'type' | 'product' | 'fonts';
export type LeftTab = 'products' | 'layers' | 'brand' | 'assets';

/** Dieline overlay switches (per browser). */
export interface Overlays {
  cut: boolean; folds: boolean; bleed: boolean; safe: boolean; panels: boolean; dims: boolean; zones: boolean; context: boolean; snap: boolean;
}

const OVERLAY_DEFAULTS: Overlays = { cut: true, folds: true, bleed: true, safe: true, panels: true, dims: true, zones: true, context: true, snap: true };

function loadOverlays(): Overlays {
  try { return { ...OVERLAY_DEFAULTS, ...JSON.parse(localStorage.getItem('brs.overlays') || '{}') }; } catch { return OVERLAY_DEFAULTS; }
}

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  rev: number;

  view: View;
  product: ID;
  surface: string;
  selection: ID[];
  tool: Tool;
  zoom: number;
  fitRequest: number;
  brush: BrushSettings;
  leftTab: LeftTab;
  leftOpen: boolean;
  rightTab: RightTab;
  textEditing: ID | null;
  clipboard: Element[];
  toast: { text: string; kind: 'info' | 'error' } | null;
  exportOpen: boolean;
  galleryOpen: boolean;
  overlays: Overlays;
  ready: boolean;

  update: (recipe: (draft: Draft<Project>) => void, opts?: { history?: boolean }) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  replaceProject: (p: Project) => void;

  setView: (v: View) => void;
  setProduct: (id: ID, surface?: string) => void;
  setSurface: (id: string) => void;
  select: (ids: ID[]) => void;
  setTool: (t: Tool) => void;
  setZoom: (z: number) => void;
  requestFit: () => void;
  setBrush: (b: Partial<BrushSettings>) => void;
  setLeftTab: (t: LeftTab) => void;
  setLeftOpen: (open: boolean) => void;
  setRightTab: (t: RightTab) => void;
  setTextEditing: (id: ID | null) => void;
  setExportOpen: (open: boolean) => void;
  setGalleryOpen: (open: boolean) => void;
  setOverlay: (p: Partial<Overlays>) => void;
  notify: (text: string, kind?: 'info' | 'error') => void;

  updateElement: (id: ID, patch: Partial<Element> | ((el: Draft<Element>) => void), opts?: { history?: boolean }) => void;
  addElement: (key: SurfaceKey, el: Element, select?: boolean) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  copySelection: () => void;
  paste: (key: SurfaceKey) => void;
  arrange: (dir: 'front' | 'back' | 'forward' | 'backward') => void;
  addGuide: (key: SurfaceKey, axis: 'x' | 'y', pos: number) => void;
  moveGuide: (key: SurfaceKey, axis: 'x' | 'y', index: number, pos: number, opts?: { history?: boolean }) => void;
  removeGuide: (key: SurfaceKey, axis: 'x' | 'y', index: number) => void;
  clearGuides: (keys: SurfaceKey[]) => void;

  addProduct: (templateId: string, options?: Record<string, OptionValue>) => ID;
  duplicateProduct: (id: ID) => void;
  deleteProduct: (id: ID) => void;
  setOption: (productId: ID, key: string, value: OptionValue, opts?: { history?: boolean }) => void;
}

const HISTORY_LIMIT = 150;
let lastHistoryAt = 0;

const starter = createStarterProject();

/** Make sure every surface of a product has an art record (after option changes). */
function syncSurfaces(d: Draft<Project>, productId: ID) {
  const p = d.products.find((x) => x.id === productId);
  if (!p) return;
  for (const s of dielineOf(p as Project['products'][number]).surfaces) if (!p.surfaces[s.id]) p.surfaces[s.id] = blankArt(s.defaultGround);
}

export const useStore = create<State>((set, get) => ({
  project: starter,
  past: [],
  future: [],
  rev: 0,

  view: 'design',
  product: starter.products[0]?.id ?? '',
  surface: starter.products[0] ? dielineOf(starter.products[0]).surfaces[0]?.id ?? '' : '',
  selection: [],
  tool: 'select',
  zoom: 1,
  fitRequest: 0,
  brush: { type: 'ink', size: 6, opacity: 1, color: '#16151a', flow: 0.8, hardness: 0.7, grain: 0.3, wetness: 0.5, angle: 30, stabilizer: 0.35, pressure: true },
  leftTab: 'products',
  leftOpen: typeof window === 'undefined' ? true : window.innerWidth > 900,
  rightTab: 'item',
  textEditing: null,
  clipboard: [],
  toast: null,
  exportOpen: false,
  galleryOpen: false,
  overlays: loadOverlays(),
  ready: false,

  update: (recipe, opts) => {
    const { project, past } = get();
    const next = produce(project, recipe);
    if (next === project) return;
    const now = performance.now();
    const burst = now - lastHistoryAt < 300;
    lastHistoryAt = now;
    if (opts?.history === false || (burst && past.length)) set({ project: next, future: [], rev: get().rev + 1 });
    else set({ project: next, past: [...past.slice(-HISTORY_LIMIT), project], future: [], rev: get().rev + 1 });
  },
  checkpoint: () => {
    const { project, past } = get();
    if (past[past.length - 1] === project) return;
    set({ past: [...past.slice(-HISTORY_LIMIT), project], future: [] });
  },
  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    let prev = past[past.length - 1];
    let rest = past.slice(0, -1);
    if (prev === project && rest.length) { prev = rest[rest.length - 1]; rest = rest.slice(0, -1); }
    set({ project: prev, past: rest, future: [project, ...future], rev: get().rev + 1 });
    get().setProduct(get().product, get().surface);
  },
  redo: () => {
    const { past, project, future } = get();
    if (!future.length) return;
    set({ project: future[0], past: [...past, project], future: future.slice(1), rev: get().rev + 1 });
    get().setProduct(get().product, get().surface);
  },
  replaceProject: (p) => {
    const first = p.products[0];
    set({ project: p, past: [], future: [], selection: [], textEditing: null, rev: get().rev + 1, product: first?.id ?? '', surface: first ? dielineOf(first).surfaces[0]?.id ?? '' : '' });
    get().requestFit();
  },

  setView: (view) => set({ view, selection: [], textEditing: null, tool: 'select' }),
  setProduct: (id, surface) => {
    const p = get().project.products.find((x) => x.id === id) ?? get().project.products[0];
    if (!p) { set({ product: '', surface: '' }); return; }
    const ids = dielineOf(p).surfaces.map((s) => s.id);
    const sid = surface && ids.includes(surface) ? surface : ids.includes(get().surface) && p.id === get().product ? get().surface : ids[0] ?? '';
    const changed = p.id !== get().product || sid !== get().surface;
    set({ product: p.id, surface: sid, ...(changed ? { selection: [], textEditing: null } : {}) });
  },
  setSurface: (surface) => set({ surface, selection: [], textEditing: null }),
  select: (selection) => set({ selection, textEditing: get().textEditing && selection.includes(get().textEditing!) ? get().textEditing : null }),
  setTool: (tool) => set({ tool }),
  setZoom: (zoom) => set({ zoom: Math.max(0.05, Math.min(32, zoom)) }),
  requestFit: () => set({ fitRequest: get().fitRequest + 1 }),
  setBrush: (b) => set({ brush: { ...get().brush, ...b } }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setLeftOpen: (leftOpen) => set({ leftOpen }),
  setRightTab: (rightTab) => set({ rightTab }),
  setTextEditing: (textEditing) => set({ textEditing }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setGalleryOpen: (galleryOpen) => set({ galleryOpen }),
  setOverlay: (p) => {
    const overlays = { ...get().overlays, ...p };
    set({ overlays });
    try { localStorage.setItem('brs.overlays', JSON.stringify(overlays)); } catch { /* storage unavailable */ }
  },
  notify: (text, kind = 'info') => {
    set({ toast: { text, kind } });
    setTimeout(() => { if (get().toast?.text === text) set({ toast: null }); }, 3800);
  },

  updateElement: (id, patch, opts) => {
    get().update((d) => {
      const loc = findElement(d as Project, id);
      if (!loc) return;
      const els = surfaceElementsDraft(d as Project, loc.key)!;
      const el = els[loc.index] as Draft<Element>;
      if (typeof patch === 'function') patch(el);
      else Object.assign(el, patch);
    }, opts);
  },
  addElement: (key, el, select = true) => {
    get().update((d) => { surfaceElementsDraft(d as Project, key)?.push(el as Draft<Element>); });
    if (select) set({ selection: [el.id] });
  },
  deleteSelection: () => {
    const ids = new Set(get().selection);
    if (!ids.size) return;
    get().update((d) => {
      for (const p of d.products) for (const art of Object.values(p.surfaces)) {
        for (let i = art.elements.length - 1; i >= 0; i--) if (ids.has(art.elements[i].id) && !art.elements[i].locked) art.elements.splice(i, 1);
      }
    });
    set({ selection: [], textEditing: null });
  },
  duplicateSelection: () => {
    const { project, selection } = get();
    const created: ID[] = [];
    get().update((d) => {
      for (const id of selection) {
        const loc = findElement(project, id);
        if (!loc) continue;
        const copy = cloneElement(loc.el, 8, 8);
        created.push(copy.id);
        surfaceElementsDraft(d as Project, loc.key)?.push(copy as Draft<Element>);
      }
    });
    set({ selection: created });
  },
  copySelection: () => {
    const { project, selection } = get();
    const els = selection.map((id) => findElement(project, id)?.el).filter(Boolean) as Element[];
    set({ clipboard: els.map((e) => JSON.parse(JSON.stringify(e))) });
  },
  paste: (key) => {
    const clip = get().clipboard;
    if (!clip.length) return;
    const copies = clip.map((e) => cloneElement(e, 8, 8));
    get().update((d) => { const els = surfaceElementsDraft(d as Project, key); if (els) els.push(...(copies as Draft<Element>[])); });
    set({ selection: copies.map((c) => c.id), clipboard: copies });
  },
  arrange: (dir) => {
    const { selection } = get();
    get().update((d) => {
      for (const id of selection) {
        const loc = findElement(d as Project, id);
        if (!loc) continue;
        const els = surfaceElementsDraft(d as Project, loc.key)!;
        const [el] = els.splice(loc.index, 1);
        const to = dir === 'front' ? els.length : dir === 'back' ? 0 : dir === 'forward' ? Math.min(els.length, loc.index + 1) : Math.max(0, loc.index - 1);
        els.splice(to, 0, el);
      }
    });
  },
  addGuide: (key, axis, pos) => {
    get().update((d) => {
      if (!d.guides) d.guides = {};
      if (!d.guides[key]) d.guides[key] = { x: [], y: [] };
      d.guides[key][axis].push(+pos.toFixed(3));
    });
  },
  moveGuide: (key, axis, index, pos, opts) => {
    get().update((d) => {
      const g = d.guides?.[key];
      if (g && index < g[axis].length) g[axis][index] = +pos.toFixed(3);
    }, opts);
  },
  removeGuide: (key, axis, index) => {
    get().update((d) => { const g = d.guides?.[key]; if (g) g[axis].splice(index, 1); });
  },
  clearGuides: (keys) => {
    get().update((d) => { for (const k of keys) if (d.guides?.[k]) delete d.guides[k]; });
  },

  addProduct: (templateId, options = {}) => {
    const p = makeProduct(templateId, undefined, options);
    const count = get().project.products.filter((x) => x.template === templateId).length;
    if (count) p.name = `${p.name} ${count + 1}`;
    get().update((d) => { d.products.push(p); });
    get().setProduct(p.id);
    get().requestFit();
    return p.id;
  },
  duplicateProduct: (id) => {
    const src = get().project.products.find((p) => p.id === id);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src)) as typeof src;
    copy.id = uid('pr');
    copy.name = `${src.name} copy`;
    for (const art of Object.values(copy.surfaces)) art.elements = art.elements.map((e) => cloneElement(e));
    get().update((d) => { d.products.splice(d.products.findIndex((p) => p.id === id) + 1, 0, copy); });
    get().setProduct(copy.id);
  },
  deleteProduct: (id) => {
    const list = get().project.products;
    const i = list.findIndex((p) => p.id === id);
    if (i < 0) return;
    get().update((d) => { d.products.splice(i, 1); });
    const next = get().project.products[Math.max(0, i - 1)];
    if (next) get().setProduct(next.id); else set({ product: '', surface: '' });
  },
  setOption: (productId, key, value, opts) => {
    get().update((d) => {
      const p = d.products.find((x) => x.id === productId);
      if (!p) return;
      const t = getTemplate(p.template);
      // Replace the options object so the dieline cache sees the change.
      const next = { ...p.options, [key]: value };
      const adj = t.adjust ? t.adjust(key, { ...optionsOf({ ...(p as Project['products'][number]), options: next }) }) : {};
      p.options = { ...next, ...adj };
      syncSurfaces(d, productId);
    }, opts);
    get().setProduct(productId, get().surface);
  },
}));

/* -------------------------------------------------------------------------- */
/* Persistence (IndexedDB autosave)                                            */
/* -------------------------------------------------------------------------- */

const AUTOSAVE_KEY = 'autosave';
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function loadAutosave(): Promise<Project | null> {
  try {
    const p = await idbGet<Project>('projects', AUTOSAVE_KEY);
    return p && p.app === 'branding-studio' && Array.isArray(p.products) ? p : null;
  } catch {
    return null;
  }
}

export function startAutosave() {
  let last = useStore.getState().project;
  useStore.subscribe((s) => {
    if (s.project === last) return;
    last = s.project;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void idbSet('projects', AUTOSAVE_KEY, last).catch(() => undefined); }, 700);
  });
}

export const getState = () => useStore.getState();
export const activeSurfaceKey = () => surfaceKey(useStore.getState().product, useStore.getState().surface);
