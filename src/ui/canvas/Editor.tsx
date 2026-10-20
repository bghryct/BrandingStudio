import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import clsx from 'clsx';
import type { Draft } from 'immer';
import { Scissors, Eye, Ruler, Shapes, Maximize2, Layers3, SquareDashed, Grid2x2 } from 'lucide-react';
import type { BrushStroke, DrawingElement, Element, PathElement, Project } from '../../model/types';
import { useStore, type Tool, type Overlays } from '../../store/store';
import { surfaceElementsDraft, findElement, guidesOf, productOf } from '../../model/surfaces';
import { makeElement, makeText, makeDrawing, makePath, makeRule, makeLogo, makeBarcode, makePattern, makeGradient } from '../../model/factory';
import { uid } from '../../lib/random';
import { applyMatrix, multiply, translate, scale as scaleM } from '../../render/primitives';
import { layoutText, anchorOffsetOf } from '../../render/compile';
import { renderStroke, simulatePressure, stabilize } from '../../engine/brushes';
import { parsePath, serialize, type Seg } from '../../lib/pathData';
import { panelAt, panelOrigin } from '../../products';
import { SurfaceView, DielineOverlay, EditorDefs } from './SurfaceView';
import { Rulers, RULER } from './Rulers';
import { TextStoryEditor } from './TextStoryEditor';
import {
  type SurfaceDesc, type Pt, layoutSurfaces, sceneMatrix, toLocal, corners, sceneBounds, hitElement, surfaceAt, snapTargets, snapAxis,
} from './geometry';
import { importFiles } from '../importFiles';

/** Cursor position readout (kept out of the main store to avoid re-rendering the app). */
export const useCursor = create<{ x: number; y: number; surface: string }>(() => ({ x: 0, y: 0, surface: '' }));
/** Show all surfaces of the product, or only the active one. */
export const useFocus = create<{ only: boolean }>(() => ({ only: false }));

type Handle = [number, number];
const HANDLES: Handle[] = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
const HANDLE_CURSORS = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];

interface MoveItem { id: string; x0: number; y0: number; surface: SurfaceDesc }
type Interaction =
  | { k: 'none' }
  | { k: 'pan'; sx: number; sy: number; px: number; py: number }
  | { k: 'move'; start: Pt; items: MoveItem[]; moved: boolean; surface: SurfaceDesc }
  | { k: 'resize'; id: string; handle: Handle; el0: Element; surface: SurfaceDesc }
  | { k: 'rotate'; id: string; center: Pt; a0: number; rot0: number }
  | { k: 'marquee'; start: Pt; cur: Pt; additive: boolean }
  | { k: 'create'; tool: Tool; surface: SurfaceDesc; start: Pt; cur: Pt }
  | { k: 'draw'; surface: SurfaceDesc; elId: string; points: number[]; mouse: boolean; stroke: BrushStroke }
  | { k: 'node'; id: string; seg: number; which: 'p' | 'c1' | 'c2'; segs: Seg[]; surface: SurfaceDesc }
  | { k: 'pen-drag'; idx: number }
  | { k: 'guide'; axis: 'x' | 'y'; from: { key: string; index: number } | null; pos: Pt };

interface PenPoint { x: number; y: number; hx: number; hy: number }

const CREATE_TOOLS: Tool[] = ['text', 'rect', 'ellipse', 'polygon', 'line', 'image', 'pattern', 'gradient', 'logo', 'barcode'];

export function Editor() {
  const project = useStore((s) => s.project);
  const productId = useStore((s) => s.product);
  const activeSurface = useStore((s) => s.surface);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => s.zoom);
  const fitRequest = useStore((s) => s.fitRequest);
  const brush = useStore((s) => s.brush);
  const textEditing = useStore((s) => s.textEditing);
  const ov = useStore((s) => s.overlays);
  const only = useFocus((s) => s.only);

  const rootRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [marquee, setMarquee] = useState<{ a: Pt; b: Pt } | null>(null);
  const [creating, setCreating] = useState<{ a: Pt; b: Pt } | null>(null);
  const [pen, setPen] = useState<{ surface: SurfaceDesc; pts: PenPoint[] } | null>(null);
  const [penHover, setPenHover] = useState<Pt | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [rasterScale, setRasterScale] = useState(2);
  const [hoverCursor, setHoverCursor] = useState<string>('default');
  const [guidePreview, setGuidePreview] = useState<{ axis: 'x' | 'y'; pos: number } | null>(null);
  const inter = useRef<Interaction>({ k: 'none' });

  const product = productOf(project, productId);
  const surfaces: SurfaceDesc[] = useMemo(() => layoutSurfaces(product, only ? activeSurface : null), [product, only, activeSurface]);

  const sceneBox = useMemo(() => {
    if (!surfaces.length) return { x: 0, y: 0, w: 400, h: 300 };
    const x0 = Math.min(...surfaces.map((s) => s.bounds.x)), y0 = Math.min(...surfaces.map((s) => s.bounds.y));
    const x1 = Math.max(...surfaces.map((s) => s.bounds.x + s.bounds.w)), y1 = Math.max(...surfaces.map((s) => s.bounds.y + s.bounds.h));
    const pad = Math.max(24, (x1 - x0) * 0.03);
    return { x: x0 - pad, y: y0 - pad - 20, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad + 20 };
  }, [surfaces]);

  const allEls = useMemo(() => {
    const out: { el: Element; surface: SurfaceDesc }[] = [];
    if (!product) return out;
    for (const s of surfaces) for (const el of product.surfaces[s.id]?.elements ?? []) out.push({ el, surface: s });
    return out;
  }, [surfaces, product]);

  /* ---------------------------------------------------------------- sizing / zoom */
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const userZoomed = useRef(false);
  const fitBox = useCallback((box: { x: number; y: number; w: number; h: number }) => {
    const z = Math.min((size.w - 70) / box.w, (size.h - 90) / box.h);
    const zz = Math.max(0.05, Math.min(16, z));
    useStore.getState().setZoom(zz);
    setPan({ x: (size.w - box.w * zz) / 2 - box.x * zz, y: (size.h - box.h * zz) / 2 - box.y * zz + 14 });
  }, [size]);
  const fit = useCallback(() => { userZoomed.current = false; fitBox(sceneBox); }, [fitBox, sceneBox]);

  useEffect(() => { fit(); }, [fitRequest, productId, only, sceneBox.w, sceneBox.h]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!userZoomed.current) fit(); }, [size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const target = Math.max(0.5, Math.min(4, 2 ** Math.ceil(Math.log2(zoom * dpr))));
    const t = setTimeout(() => setRasterScale(target), 180);
    return () => clearTimeout(t);
  }, [zoom]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    userZoomed.current = true;
    const z0 = useStore.getState().zoom;
    const z1 = Math.max(0.05, Math.min(32, z0 * factor));
    setPan((p) => ({ x: cx - ((cx - p.x) * z1) / z0, y: cy - ((cy - p.y) * z1) / z0 }));
    useStore.getState().setZoom(z1);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest?.('[data-noscroll]')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
      else { userZoomed.current = true; setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY })); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  /* ---------------------------------------------------------------- helpers */
  const toScene = (e: { clientX: number; clientY: number }): Pt => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - pan.x) / zoom, y: (e.clientY - r.top - pan.y) / zoom };
  };
  const toScreen = (p: Pt): Pt => ({ x: p.x * zoom + pan.x, y: p.y * zoom + pan.y });

  const pick = (p: Pt, cycleFrom?: string): { el: Element; surface: SurfaceDesc } | null => {
    const hits: { el: Element; surface: SurfaceDesc }[] = [];
    for (let i = allEls.length - 1; i >= 0; i--) {
      const { el, surface } = allEls[i];
      if (el.hidden || el.locked) continue;
      if (hitElement(el, surface, p, 4 / zoom)) hits.push({ el, surface });
    }
    if (!hits.length) return null;
    if (cycleFrom) {
      const i = hits.findIndex((h) => h.el.id === cycleFrom);
      if (i >= 0) return hits[(i + 1) % hits.length];
    }
    return hits[0];
  };

  const selected = allEls.filter((x) => selection.includes(x.el.id));
  const single = selected.length === 1 ? selected[0] : null;

  const handleAt = (p: Pt): { kind: 'resize'; h: Handle } | { kind: 'rotate' } | null => {
    if (!single || single.el.locked || tool !== 'select') return null;
    const m = sceneMatrix(single.el, single.surface);
    const tol = 6 / zoom;
    const [rx, ry] = applyMatrix(multiply(m, translate(single.el.w / 2, 0)), 0, -22 / zoom);
    if (Math.hypot(p.x - rx, p.y - ry) < tol * 1.4) return { kind: 'rotate' };
    for (const h of HANDLES) {
      const [hx, hy] = applyMatrix(m, h[0] * single.el.w, h[1] * single.el.h);
      if (Math.abs(p.x - hx) < tol && Math.abs(p.y - hy) < tol) return { kind: 'resize', h };
    }
    return null;
  };

  const st = useStore.getState;
  const focusSurface = (sd: SurfaceDesc) => { if (sd.id !== st().surface) st().setSurface(sd.id); };

  /* ---------------------------------------------------------------- pointer down */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    if ((e.target as HTMLElement).closest?.('[data-ui]')) return;
    rootRef.current?.setPointerCapture(e.pointerId);
    const p = toScene(e);
    const s = st();

    if (e.button === 1 || spaceDown || tool === 'hand') {
      inter.current = { k: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
      return;
    }
    if (tool === 'zoom') {
      const r = rootRef.current!.getBoundingClientRect();
      zoomAt(e.altKey ? 0.5 : 2, e.clientX - r.left, e.clientY - r.top);
      return;
    }
    const rulerEl = (e.target as HTMLElement).closest?.('[data-ruler]') as HTMLElement | null;
    if (rulerEl) {
      const axis = rulerEl.dataset.ruler === 'top' ? 'y' : 'x';
      inter.current = { k: 'guide', axis, from: null, pos: p };
      setGuidePreview({ axis, pos: axis === 'x' ? p.x : p.y });
      return;
    }
    if ((tool === 'select' || tool === 'node') && !s.project.guidesHidden && !s.project.guidesLocked) {
      const hitG = guideAt(p);
      if (hitG) {
        s.checkpoint();
        inter.current = { k: 'guide', axis: hitG.axis, from: { key: hitG.key, index: hitG.index }, pos: p };
        setGuidePreview({ axis: hitG.axis, pos: hitG.axis === 'x' ? p.x : p.y });
        return;
      }
    }

    if (tool === 'select' || tool === 'node') {
      if (tool === 'node' && single && single.el.type === 'path') {
        const nh = nodeAt(single.el as PathElement, single.surface, p);
        if (nh) {
          s.checkpoint();
          inter.current = { k: 'node', id: single.el.id, seg: nh.seg, which: nh.which, segs: parsePath((single.el as PathElement).d), surface: single.surface };
          return;
        }
      }
      const h = handleAt(p);
      if (h && single) {
        s.checkpoint();
        if (h.kind === 'rotate') {
          const c = centerOf(single.el, single.surface);
          inter.current = { k: 'rotate', id: single.el.id, center: c, a0: Math.atan2(p.y - c.y, p.x - c.x), rot0: single.el.rotation };
        } else {
          inter.current = { k: 'resize', id: single.el.id, handle: h.h, el0: single.el, surface: single.surface };
        }
        return;
      }
      const hit = pick(p, e.altKey && single ? single.el.id : undefined);
      if (hit) {
        let sel = selection;
        if (e.shiftKey) sel = selection.includes(hit.el.id) ? selection.filter((i) => i !== hit.el.id) : [...selection, hit.el.id];
        else if (!selection.includes(hit.el.id) || e.altKey) sel = [hit.el.id];
        if (hit.surface.id !== s.surface) s.setSurface(hit.surface.id);
        s.select(sel);
        s.checkpoint();
        const items = allEls.filter((x) => sel.includes(x.el.id) && !x.el.locked).map((x) => ({ id: x.el.id, x0: x.el.x, y0: x.el.y, surface: x.surface }));
        inter.current = { k: 'move', start: p, items, moved: false, surface: hit.surface };
        return;
      }
      const under = surfaceAt(surfaces, p);
      if (under) focusSurface(under);
      if (!e.shiftKey) s.select([]);
      s.setTextEditing(null);
      inter.current = { k: 'marquee', start: p, cur: p, additive: e.shiftKey };
      return;
    }

    const surface = surfaceAt(surfaces, p, 30 / zoom);
    if (!surface) return;
    focusSurface(surface);

    if (tool === 'brush' || tool === 'eraser') {
      const br = s.brush;
      s.checkpoint();
      let target: DrawingElement | null = null;
      let layer = surface;
      if (single && single.el.type === 'drawing') {
        const bx = sceneBounds(single.el, single.surface);
        if (p.x >= bx.x && p.x <= bx.x + bx.w && p.y >= bx.y && p.y <= bx.y + bx.h) { target = single.el as DrawingElement; layer = single.surface; }
      }
      if (!target) {
        const b = layer.s.bleed;
        target = makeDrawing({ name: 'Drawing', x: -b, y: -b, w: layer.s.w + 2 * b, h: layer.s.h + 2 * b });
        const key = layer.key;
        const el = target;
        s.update((d) => { surfaceElementsDraft(d as Project, key)?.push(el as Draft<Element>); }, { history: false });
        s.select([target.id]);
      }
      const local = toLocal(target, layer, p);
      const mouse = e.pointerType === 'mouse';
      const pr = mouse ? 0.5 : e.pressure || 0.5;
      const stroke: BrushStroke = {
        id: uid('stk'), brush: tool === 'eraser' ? 'eraser' : br.type, color: br.color, size: br.size, opacity: br.opacity,
        flow: br.flow, hardness: br.hardness, grain: br.grain, wetness: br.wetness, angle: br.angle,
        seed: Math.floor(Math.random() * 1e9), points: [local.x, local.y, br.pressure ? pr : 0.6],
      };
      inter.current = { k: 'draw', surface: layer, elId: target.id, points: stroke.points, mouse, stroke };
      drawLive();
      return;
    }

    if (tool === 'pen') {
      if (pen && pen.pts.length >= 2) {
        const first = pen.pts[0];
        if (Math.hypot(p.x - first.x, p.y - first.y) < 8 / zoom) { finishPen(true); return; }
      }
      const pts = pen && pen.surface.key === surface.key ? [...pen.pts] : [];
      pts.push({ x: p.x, y: p.y, hx: 0, hy: 0 });
      setPen({ surface, pts });
      inter.current = { k: 'pen-drag', idx: pts.length - 1 };
      return;
    }

    if (CREATE_TOOLS.includes(tool)) {
      inter.current = { k: 'create', tool, surface, start: p, cur: p };
      setCreating({ a: p, b: p });
    }
  };

  /* ---------------------------------------------------------------- pointer move */
  const onPointerMove = (e: React.PointerEvent) => {
    const p = toScene(e);
    const sAt = surfaceAt(surfaces, p);
    useCursor.setState({ x: sAt ? p.x - sAt.x : p.x, y: sAt ? p.y - sAt.y : p.y, surface: sAt?.label ?? '' });
    const it = inter.current;
    const s = st();
    switch (it.k) {
      case 'none': {
        if (tool === 'select') {
          const h = handleAt(p);
          const g = !h && !s.project.guidesHidden && !s.project.guidesLocked ? guideAt(p) : null;
          setHoverCursor(h ? (h.kind === 'rotate' ? 'grab' : HANDLE_CURSORS[HANDLES.indexOf(h.h)]) : g ? (g.axis === 'x' ? 'col-resize' : 'row-resize') : 'default');
        }
        if (tool === 'pen' && pen) setPenHover(p);
        return;
      }
      case 'pan':
        userZoomed.current = true;
        setPan({ x: it.px + e.clientX - it.sx, y: it.py + e.clientY - it.sy });
        return;
      case 'move': {
        let dx = p.x - it.start.x, dy = p.y - it.start.y;
        if (!it.moved && Math.hypot(dx * zoom, dy * zoom) < 3) return;
        it.moved = true;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        const ids = new Set(it.items.map((i) => i.id));
        const movingEls = it.items.map((i) => allEls.find((x) => x.el.id === i.id)!).filter(Boolean);
        let gx: number | null = null, gy: number | null = null;
        if (!e.altKey && s.overlays.snap && movingEls.length) {
          const bs = movingEls.map((x) => {
            const item = it.items.find((i) => i.id === x.el.id)!;
            return sceneBounds({ ...x.el, x: item.x0 + dx, y: item.y0 + dy } as Element, x.surface);
          });
          const minX = Math.min(...bs.map((b) => b.x)), maxX = Math.max(...bs.map((b) => b.x + b.w));
          const minY = Math.min(...bs.map((b) => b.y)), maxY = Math.max(...bs.map((b) => b.y + b.h));
          const target = surfaceAt(surfaces, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }) ?? it.surface;
          const lines = snapTargets(s.project, target, allEls.filter((x) => x.surface.key === target.key), ids);
          const thr = 6 / zoom;
          const sx = snapAxis([minX, (minX + maxX) / 2, maxX], lines.x, thr);
          const sy = snapAxis([minY, (minY + maxY) / 2, maxY], lines.y, thr);
          dx += sx.delta; dy += sy.delta;
          gx = sx.line; gy = sy.line;
        }
        setGuides({ x: gx, y: gy });
        s.update((d) => {
          for (const item of it.items) {
            const loc = findElement(d as Project, item.id);
            if (!loc) continue;
            const el = surfaceElementsDraft(d as Project, loc.key)![loc.index];
            el.x = item.x0 + dx;
            el.y = item.y0 + dy;
          }
        }, { history: false });
        return;
      }
      case 'resize': {
        const el0 = it.el0;
        const c0 = centerOf(el0, it.surface);
        const r = (el0.rotation * Math.PI) / 180;
        const cos = Math.cos(-r), sin = Math.sin(-r);
        const vx = p.x - c0.x, vy = p.y - c0.y;
        let lx = vx * cos - vy * sin + el0.w / 2, ly = vx * sin + vy * cos + el0.h / 2;
        const [hx, hy] = it.handle;
        const off = anchorOffsetOf(el0, it.surface.s);
        if (!el0.rotation && !e.altKey && s.overlays.snap) {
          const lines = snapTargets(s.project, it.surface, allEls.filter((x) => x.surface.key === it.surface.key), new Set([el0.id]));
          const ox = it.surface.x + off.x + el0.x, oy = it.surface.y + off.y + el0.y;
          const thr = 6 / zoom;
          if (hx !== 0.5) { const sx = snapAxis([ox + lx], lines.x, thr); lx += sx.delta; setGuides((g) => ({ ...g, x: sx.line })); }
          if (hy !== 0.5) { const sy = snapAxis([oy + ly], lines.y, thr); ly += sy.delta; setGuides((g) => ({ ...g, y: sy.line })); }
        }
        let left = 0, top = 0, right = el0.w, bottom = el0.h;
        if (hx === 0) left = Math.min(lx, el0.w - 1); else if (hx === 1) right = Math.max(lx, 1);
        if (hy === 0) top = Math.min(ly, el0.h - 1); else if (hy === 1) bottom = Math.max(ly, 1);
        let w = right - left, h = bottom - top;
        const keepRatio = e.shiftKey || ((el0.type === 'logo' || el0.type === 'image' || el0.type === 'svg') && !e.altKey && hx !== 0.5 && hy !== 0.5);
        if (keepRatio && hx !== 0.5 && hy !== 0.5) {
          const ratio = el0.w / el0.h;
          if (w / h > ratio) { const nw = h * ratio; if (hx === 0) left = right - nw; else right = left + nw; w = nw; }
          else { const nh = w / ratio; if (hy === 0) top = bottom - nh; else bottom = top + nh; h = nh; }
        }
        const lcx = (left + right) / 2 - el0.w / 2, lcy = (top + bottom) / 2 - el0.h / 2;
        const cr = Math.cos(r), sr = Math.sin(r);
        const ncx = c0.x + lcx * cr - lcy * sr, ncy = c0.y + lcx * sr + lcy * cr;
        s.updateElement(el0.id, (d) => {
          d.w = w; d.h = h;
          d.x = ncx - w / 2 - it.surface.x - off.x;
          d.y = ncy - h / 2 - it.surface.y - off.y;
        }, { history: false });
        return;
      }
      case 'rotate': {
        let a = ((Math.atan2(p.y - it.center.y, p.x - it.center.x) - it.a0) * 180) / Math.PI + it.rot0;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        a = ((a % 360) + 540) % 360 - 180;
        s.updateElement(it.id, { rotation: +a.toFixed(2) }, { history: false });
        return;
      }
      case 'marquee':
        it.cur = p;
        setMarquee({ a: it.start, b: p });
        return;
      case 'create': {
        let b = p;
        if (e.shiftKey) {
          const d = Math.max(Math.abs(p.x - it.start.x), Math.abs(p.y - it.start.y));
          b = { x: it.start.x + Math.sign(p.x - it.start.x || 1) * d, y: it.start.y + Math.sign(p.y - it.start.y || 1) * d };
        }
        it.cur = b;
        setCreating({ a: it.start, b });
        return;
      }
      case 'draw': {
        const el = allEls.find((x) => x.el.id === it.elId)?.el ?? findElement(s.project, it.elId)?.el;
        if (!el) return;
        const coalesced = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [];
        const events = coalesced.length ? coalesced : [e.nativeEvent];
        for (const ev of events) {
          const local = toLocal(el, it.surface, toScene(ev));
          const pr = it.mouse ? 0.5 : (ev as PointerEvent).pressure || 0.5;
          it.points.push(local.x, local.y, brush.pressure ? pr : 0.6);
        }
        drawLive();
        return;
      }
      case 'node': {
        const el = allEls.find((x) => x.el.id === it.id)?.el as PathElement | undefined;
        if (!el) return;
        const local = toLocal(el, it.surface, p);
        const kx = el.vw / el.w, ky = el.vh / el.h;
        const px = local.x * kx, py = local.y * ky;
        const segs = it.segs.map((sg) => ({ ...sg })) as Seg[];
        const sg = segs[it.seg];
        if (sg.c === 'Z') return;
        if (it.which === 'p') {
          const ddx = px - sg.x, ddy = py - sg.y;
          sg.x = px; sg.y = py;
          if (sg.c === 'C') { sg.x2 += ddx; sg.y2 += ddy; }
          const nx = segs[it.seg + 1];
          if (nx && nx.c === 'C') { nx.x1 += ddx; nx.y1 += ddy; }
        } else if (sg.c === 'C') {
          if (it.which === 'c1') { sg.x1 = px; sg.y1 = py; } else { sg.x2 = px; sg.y2 = py; }
        }
        it.segs = segs;
        s.updateElement(it.id, { d: serialize(segs) } as Partial<PathElement>, { history: false });
        return;
      }
      case 'guide': {
        it.pos = p;
        const at = surfaceAt(surfaces, p, 40 / zoom);
        let pos = it.axis === 'x' ? p.x : p.y;
        if (at && !e.altKey) {
          const lines = snapTargets(s.project, at, [], new Set());
          const sn = snapAxis([pos], it.axis === 'x' ? lines.x : lines.y, 5 / zoom);
          pos += sn.delta;
        }
        setGuidePreview({ axis: it.axis, pos });
        return;
      }
      case 'pen-drag': {
        if (!pen) return;
        const pts = [...pen.pts];
        const pt = pts[it.idx];
        if (!pt) return;
        pts[it.idx] = { ...pt, hx: p.x - pt.x, hy: p.y - pt.y };
        setPen({ ...pen, pts });
        return;
      }
    }
  };

  /* ---------------------------------------------------------------- pointer up */
  const onPointerUp = (e: React.PointerEvent) => {
    const it = inter.current;
    inter.current = { k: 'none' };
    const s = st();
    setGuides({ x: null, y: null });
    switch (it.k) {
      case 'move':
        if (it.moved) settle(it.items.map((i) => i.id));
        break;
      case 'resize':
        settle([it.id]);
        break;
      case 'marquee': {
        setMarquee(null);
        const x0 = Math.min(it.start.x, it.cur.x), x1 = Math.max(it.start.x, it.cur.x);
        const y0 = Math.min(it.start.y, it.cur.y), y1 = Math.max(it.start.y, it.cur.y);
        if (x1 - x0 < 2 / zoom && y1 - y0 < 2 / zoom) break;
        const ids = allEls.filter(({ el, surface }) => {
          if (el.hidden || el.locked) return false;
          const b = sceneBounds(el, surface);
          return b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0;
        }).map((x) => x.el.id);
        s.select(it.additive ? [...new Set([...selection, ...ids])] : ids);
        break;
      }
      case 'create':
        setCreating(null);
        createFromDrag(it.tool, it.surface, it.start, it.cur);
        break;
      case 'draw': {
        const pts0 = it.points;
        let pts = it.mouse && brush.pressure ? simulatePressure(pts0) : pts0;
        if (brush.stabilizer > 0) pts = stabilize(pts, brush.stabilizer);
        if (pts.length >= 3) {
          const stroke: BrushStroke = { ...it.stroke, points: pts.map((v) => +v.toFixed(2)) };
          s.updateElement(it.elId, (d) => { (d as Draft<DrawingElement>).strokes.push(stroke); }, { history: false });
        }
        requestAnimationFrame(() => requestAnimationFrame(clearLive));
        break;
      }
      case 'guide': {
        const pos = guidePreview ? guidePreview.pos : it.axis === 'x' ? it.pos.x : it.pos.y;
        setGuidePreview(null);
        const r = rootRef.current!.getBoundingClientRect();
        const overRuler = e.clientX - r.left < RULER || e.clientY - r.top < RULER;
        const target = overRuler ? null : surfaceAt(surfaces, it.pos, 0);
        if (it.from) {
          if (!target || target.key !== it.from.key) s.removeGuide(it.from.key, it.axis, it.from.index);
          else s.moveGuide(it.from.key, it.axis, it.from.index, it.axis === 'x' ? pos - target.x : pos - target.y, { history: false });
          if (target && target.key !== it.from.key) s.addGuide(target.key, it.axis, it.axis === 'x' ? pos - target.x : pos - target.y);
        } else if (target) {
          s.addGuide(target.key, it.axis, it.axis === 'x' ? pos - target.x : pos - target.y);
          if (s.project.guidesHidden) s.update((d) => { d.guidesHidden = false; }, { history: false });
        }
        break;
      }
      default:
        break;
    }
    try { rootRef.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  /* ---------------------------------------------------------------- actions */
  function guideAt(p: Pt): { key: string; axis: 'x' | 'y'; index: number } | null {
    const tol = 4 / zoom;
    for (const sf of surfaces) {
      const g = guidesOf(project, sf.key);
      const b = sf.bounds;
      const inY = p.y >= b.y && p.y <= b.y + b.h;
      const inX = p.x >= b.x && p.x <= b.x + b.w;
      if (inY) for (let i = 0; i < g.x.length; i++) if (Math.abs(sf.x + g.x[i] - p.x) < tol) return { key: sf.key, axis: 'x', index: i };
      if (inX) for (let i = 0; i < g.y.length; i++) if (Math.abs(sf.y + g.y[i] - p.y) < tol) return { key: sf.key, axis: 'y', index: i };
    }
    return null;
  }

  function centerOf(el: Element, sd: SurfaceDesc): Pt {
    const [x, y] = applyMatrix(sceneMatrix(el, sd), el.w / 2, el.h / 2);
    return { x, y };
  }

  function nodeAt(el: PathElement, sd: SurfaceDesc, p: Pt): { seg: number; which: 'p' | 'c1' | 'c2' } | null {
    const segs = parsePath(el.d);
    const m = multiply(sceneMatrix(el, sd), scaleM(el.w / el.vw, el.h / el.vh));
    const tol = 6 / zoom;
    for (let i = segs.length - 1; i >= 0; i--) {
      const sg = segs[i];
      if (sg.c === 'Z') continue;
      if (sg.c === 'C') {
        const [a, b] = applyMatrix(m, sg.x2, sg.y2);
        if (Math.hypot(p.x - a, p.y - b) < tol) return { seg: i, which: 'c2' };
        const [c, d] = applyMatrix(m, sg.x1, sg.y1);
        if (Math.hypot(p.x - c, p.y - d) < tol) return { seg: i, which: 'c1' };
      }
      const [x, y] = applyMatrix(m, sg.x, sg.y);
      if (Math.hypot(p.x - x, p.y - y) < tol) return { seg: i, which: 'p' };
    }
    return null;
  }

  /**
   * After a move or resize: an item dragged onto another surface moves there; on its surface it
   * is re-anchored to the panel under its centre (so it follows that panel when sizes change).
   */
  function settle(ids: string[]) {
    st().update((d) => {
      for (const id of ids) {
        const cur = allEls.find((x) => x.el.id === id);
        const loc = findElement(d as Project, id);
        if (!cur || !loc) continue;
        const els = surfaceElementsDraft(d as Project, loc.key)!;
        const el = els[loc.index];
        const off = anchorOffsetOf(el as Element, cur.surface.s);
        const scx = cur.surface.x + off.x + el.x + el.w / 2, scy = cur.surface.y + off.y + el.y + el.h / 2;
        const target = surfaceAt(surfaces, { x: scx, y: scy }) ?? cur.surface;
        // Surface coordinates of the item's top-left without anchor.
        let x = scx - target.x - el.w / 2, y = scy - target.y - el.h / 2;
        const panel = target.s.panels.length > 1 ? panelAt(target.s, x + el.w / 2, y + el.h / 2) : null;
        const po = panelOrigin(target.s, panel);
        x -= po.x; y -= po.y;
        if (target.key !== cur.surface.key) {
          const [moved] = els.splice(loc.index, 1);
          moved.x = x; moved.y = y; moved.anchor = panel;
          surfaceElementsDraft(d as Project, target.key)!.push(moved);
        } else if ((el.anchor ?? null) !== panel) {
          el.x = x; el.y = y; el.anchor = panel;
        }
      }
    }, { history: false });
  }

  function createFromDrag(t: Tool, sd: SurfaceDesc, a: Pt, b: Pt) {
    const s = st();
    let x = Math.min(a.x, b.x) - sd.x, y = Math.min(a.y, b.y) - sd.y;
    let w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    const click = w * zoom < 4 && h * zoom < 4;
    let el: Element;
    if (t === 'text') {
      if (click) { w = Math.min(sd.s.w * 0.6, 180); h = 40; x -= 4; y -= 12; }
      const kit = s.project.brand;
      el = makeText({ x, y, w, h, text: 'Type here', style: { fontFamily: kit.fonts.body, fontSize: 14, leading: 17 } as never });
    } else if (t === 'line') {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      const L = click ? 100 : len;
      const cx = (click ? a.x + 50 : (a.x + b.x) / 2) - sd.x, cy = (click ? a.y : (a.y + b.y) / 2) - sd.y;
      el = makeRule({ x: cx - L / 2, y: cy - 4, w: L, h: 8, rotation: click ? 0 : +ang.toFixed(2) });
    } else if (t === 'logo') {
      const m = makeLogo();
      if (click) { w = m.w * 1.2; h = m.h * 1.2; x -= w / 2; y -= h / 2; }
      el = { ...m, x, y, w: Math.max(8, w), h: Math.max(8, h) };
    } else if (t === 'barcode') {
      const m = makeBarcode();
      if (click) { w = m.w; h = m.h; x -= w / 2; y -= h / 2; }
      el = { ...m, x, y, w: Math.max(30, w), h: Math.max(20, h) };
    } else if (t === 'pattern' && click) {
      const bl = sd.s.bleed;
      el = makePattern({ x: -bl, y: -bl, w: sd.s.w + 2 * bl, h: sd.s.h + 2 * bl, color: s.project.brand.palette.find((p) => p.role === 'accent')?.hex ?? '#e8483b', opacity: 0.3 });
    } else if (t === 'gradient' && click) {
      const bl = sd.s.bleed;
      el = makeGradient({ x: -bl, y: -bl, w: sd.s.w + 2 * bl, h: sd.s.h + 2 * bl });
    } else {
      const type: Element['type'] = t === 'image' ? 'image' : t === 'pattern' ? 'pattern' : t === 'gradient' ? 'gradient' : 'shape';
      const defaults = makeElement(type);
      if (click) { w = defaults.w; h = defaults.h; x -= w / 2; y -= h / 2; }
      el = makeElement(type, { x, y, w: Math.max(4, w), h: Math.max(4, h) } as Partial<Element>);
      if (t === 'rect') el = { ...el, shape: 'rect' } as Element;
      if (t === 'ellipse') el = { ...el, shape: 'ellipse' } as Element;
      if (t === 'polygon') el = { ...el, shape: 'star', sides: 5 } as Element;
      if (el.type === 'shape') el = { ...el, fill: s.project.brand.palette.find((p) => p.role === 'accent')?.hex ?? '#e8483b' } as Element;
    }
    // Anchor to the panel under the item's centre.
    if (sd.s.panels.length > 1) {
      const panel = panelAt(sd.s, el.x + el.w / 2, el.y + el.h / 2);
      if (panel) {
        const po = panelOrigin(sd.s, panel);
        el = { ...el, x: el.x - po.x, y: el.y - po.y, anchor: panel };
      }
    }
    s.addElement(sd.key, el);
    s.setTool('select');
    if (el.type === 'image') requestAnimationFrame(() => pickImageFor(el.id));
    if (el.type === 'text') s.setTextEditing(el.id);
  }

  function pickImageFor(id: string) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.svg';
    input.onchange = async () => {
      const files = input.files ? [...input.files] : [];
      const res = await importFiles(files, { replaceImageId: id });
      if (res.errors.length) st().notify(res.errors[0], 'error');
    };
    input.click();
  }

  function finishPen(close: boolean) {
    if (!pen || pen.pts.length < 2) { setPen(null); return; }
    const sf = pen.surface;
    const pts = pen.pts.map((q) => ({ ...q, x: q.x - sf.x, y: q.y - sf.y }));
    const xs: number[] = [], ys: number[] = [];
    for (const q of pts) { xs.push(q.x, q.x + q.hx, q.x - q.hx); ys.push(q.y, q.y + q.hy, q.y - q.hy); }
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const w = Math.max(1, Math.max(...xs) - x0), h = Math.max(1, Math.max(...ys) - y0);
    const segs: Seg[] = [{ c: 'M', x: pts[0].x - x0, y: pts[0].y - y0 }];
    const n = pts.length;
    const count = close ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const p0 = pts[i], p1 = pts[(i + 1) % n];
      segs.push({ c: 'C', x1: p0.x + p0.hx - x0, y1: p0.y + p0.hy - y0, x2: p1.x - p1.hx - x0, y2: p1.y - p1.hy - y0, x: p1.x - x0, y: p1.y - y0 });
    }
    if (close) segs.push({ c: 'Z' });
    const accent = st().project.brand.palette.find((p) => p.role === 'accent')?.hex ?? '#e8483b';
    const el = makePath({ x: x0, y: y0, w, h, vw: w, vh: h, d: serialize(segs), fill: close ? accent : null, stroke: close ? null : '#16151a', strokeWidth: 1.5 });
    st().addElement(sf.key, el);
    setPen(null);
    setPenHover(null);
  }

  /* ---------------------------------------------------------------- live brush */
  function drawLive() {
    const it = inter.current;
    const canvas = liveRef.current;
    if (it.k !== 'draw' || !canvas) return;
    const el = allEls.find((x) => x.el.id === it.elId)?.el ?? findElement(st().project, it.elId)?.el;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const m = multiply(scaleM(dpr), multiply(translate(pan.x, pan.y), multiply(scaleM(zoom), sceneMatrix(el, it.surface))));
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    let pts = it.points;
    if (brush.stabilizer > 0 && pts.length > 9) pts = stabilize(pts, brush.stabilizer);
    if (it.mouse && brush.pressure && pts.length > 6) pts = simulatePressure(pts);
    try {
      renderStroke(ctx, { ...it.stroke, points: pts }, { pxPerPt: zoom * dpr, paperGrain: (el as DrawingElement).paperGrain ?? 0.5 });
    } catch { /* keep painting */ }
  }
  function clearLive() {
    const c = liveRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
  }

  /* ---------------------------------------------------------------- keyboard */
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (isField(e.target)) return;
      const s = st();
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === 'Space' && !e.repeat) { setSpaceDown(true); e.preventDefault(); return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); s.duplicateSelection(); return; }
      if (mod && e.key.toLowerCase() === 'c') { s.copySelection(); return; }
      if (mod && e.key.toLowerCase() === 'v') {
        const target = single?.surface.key ?? surfaces.find((x) => x.id === s.surface)?.key ?? surfaces[0]?.key;
        if (target) { e.preventDefault(); s.paste(target); }
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); s.select(allEls.filter((x) => !x.el.locked && !x.el.hidden && (x.surface.id === s.surface)).map((x) => x.el.id)); return; }
      if (mod && e.key === '0') { e.preventDefault(); fit(); return; }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomAt(1.25, size.w / 2, size.h / 2); return; }
      if (mod && e.key === '-') { e.preventDefault(); zoomAt(0.8, size.w / 2, size.h / 2); return; }
      if (mod && e.key === ';') { e.preventDefault(); s.update((d) => { if (e.altKey) d.guidesLocked = !d.guidesLocked; else d.guidesHidden = !d.guidesHidden; }, { history: false }); return; }
      if (mod && e.key === ']') { e.preventDefault(); s.arrange(e.shiftKey ? 'front' : 'forward'); return; }
      if (mod && e.key === '[') { e.preventDefault(); s.arrange(e.shiftKey ? 'back' : 'backward'); return; }
      if (e.key === 'Escape') {
        if (pen) { finishPen(false); return; }
        s.setTextEditing(null); s.select([]); s.setTool('select');
        return;
      }
      if (e.key === 'Enter' && pen) { finishPen(false); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); s.deleteSelection(); return; }
      if (e.key.startsWith('Arrow') && s.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        s.update((d) => {
          for (const id of s.selection) {
            const loc = findElement(d as Project, id);
            if (!loc) continue;
            const el = surfaceElementsDraft(d as Project, loc.key)![loc.index];
            if (el.locked) continue;
            el.x += dx; el.y += dy;
          }
        });
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === '[') { s.setBrush({ size: Math.max(0.5, s.brush.size / 1.2) }); return; }
      if (e.key === ']') { s.setBrush({ size: Math.min(400, s.brush.size * 1.2) }); return; }
      const map: Record<string, Tool> = { v: 'select', a: 'node', t: 'text', r: 'rect', e: 'ellipse', l: 'line', p: 'pen', b: 'brush', x: 'eraser', h: 'hand', z: 'zoom', i: 'image', k: 'pattern', g: 'gradient', o: 'logo' };
      const tl = map[e.key.toLowerCase()];
      if (tl) s.setTool(tl);
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  /* ---------------------------------------------------------------- drop files */
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    const p = toScene(e);
    const surface = surfaceAt(surfaces, p, 40) ?? surfaces.find((x) => x.id === st().surface) ?? surfaces[0];
    const res = await importFiles(files, { place: surface ? { surfaceKey: surface.key, x: p.x - surface.x, y: p.y - surface.y } : undefined });
    if (res.errors.length) st().notify(res.errors[0], 'error');
    else if (res.messages.length) st().notify(res.messages.join(' '));
  };

  /* ---------------------------------------------------------------- render */
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const cursor = spaceDown || tool === 'hand' ? 'grab' : tool === 'zoom' ? 'zoom-in' : tool === 'select' ? hoverCursor : tool === 'node' ? 'default' : 'crosshair';
  const textOverflow = (el: Element, sd: SurfaceDesc) => {
    if (el.type !== 'text' || el.autoFit) return false;
    try { return layoutText(el, { project, product, surface: sd.s }).overflow; } catch { return false; }
  };

  if (!product) {
    return (
      <div className="pasteboard flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-sm rounded-lg border border-ink-600 bg-ink-850 p-5 shadow-2xl">
          <h2 className="text-[16px] font-semibold text-ink-100">No products yet</h2>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-300">Add a can, a bottle, a carton, a tote or a garment from the template gallery to start designing on its dieline.</p>
          <button type="button" className="mt-4 h-8 rounded-md bg-rubric px-3 text-[12px] font-medium text-white hover:brightness-110" onClick={() => st().setGalleryOpen(true)}>Open template gallery</button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="pasteboard relative h-full w-full overflow-hidden"
      style={{ cursor, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest?.('[data-ui]')) return;
        if (pen) { finishPen(false); return; }
        if (tool !== 'select' && tool !== 'node') return;
        const hit = pick(toScene(e));
        if (!hit) return;
        if (hit.el.type === 'text') st().setTextEditing(hit.el.id);
        else if (hit.el.type === 'path') st().setTool('node');
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg width={size.w} height={size.h} className="absolute inset-0 select-none" style={{ pointerEvents: 'none' }}>
        <EditorDefs />
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {surfaces.map((sd) => <SurfaceView key={sd.key} project={project} product={product} sd={sd} rasterScale={rasterScale} />)}
          {surfaces.map((sd) => <DielineOverlay key={`d${sd.key}`} sd={sd} ov={ov} zoom={zoom} unit={project.unit} active={sd.id === activeSurface || surfaces.length === 1} />)}
          {!project.guidesHidden && surfaces.map((sf) => {
            const g = guidesOf(project, sf.key);
            const b = sf.bounds;
            return (
              <g key={`rg${sf.key}`} pointerEvents="none">
                {g.x.map((gx, i) => <line key={`gx${i}`} x1={sf.x + gx} x2={sf.x + gx} y1={b.y - 6} y2={b.y + b.h + 6} stroke={project.guidesLocked ? '#6aa8b8' : '#21b8d6'} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
                {g.y.map((gy, i) => <line key={`gy${i}`} y1={sf.y + gy} y2={sf.y + gy} x1={b.x - 6} x2={b.x + b.w + 6} stroke={project.guidesLocked ? '#6aa8b8' : '#21b8d6'} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
              </g>
            );
          })}
          {surfaces.map((sd) => (
            <text key={`l${sd.key}`} x={sd.bounds.x} y={sd.bounds.y - 8 / zoom} fontSize={11 / zoom} fill={sd.id === activeSurface ? 'rgba(255,255,255,0.85)' : 'rgba(240,235,225,0.45)'} style={{ fontFamily: 'ui-sans-serif, system-ui', fontWeight: 600 }}>
              {sd.label}
            </text>
          ))}
        </g>
        <g>
          {guidePreview && (guidePreview.axis === 'x'
            ? <line x1={guidePreview.pos * zoom + pan.x} x2={guidePreview.pos * zoom + pan.x} y1={0} y2={size.h} stroke="#21b8d6" strokeDasharray="4 3" />
            : <line y1={guidePreview.pos * zoom + pan.y} y2={guidePreview.pos * zoom + pan.y} x1={0} x2={size.w} stroke="#21b8d6" strokeDasharray="4 3" />)}
          {selected.map(({ el, surface }) => {
            const cs = corners(el, surface).map(toScreen);
            const overflow = textOverflow(el, surface);
            return (
              <g key={`sel${el.id}`}>
                <polygon points={cs.map((c) => `${c.x},${c.y}`).join(' ')} fill="none" stroke={el.locked ? '#888' : '#4aa3ff'} strokeWidth={1} />
                {overflow && <><rect x={cs[2].x - 5} y={cs[2].y - 5} width={10} height={10} fill="#e5483a" stroke="#4aa3ff" /><text x={cs[2].x} y={cs[2].y + 3.5} textAnchor="middle" fontSize={10} fill="#fff">+</text></>}
              </g>
            );
          })}
          {single && !single.el.locked && tool === 'select' && (() => {
            const m = sceneMatrix(single.el, single.surface);
            const hs = HANDLES.map((h) => toScreen((([x, y]) => ({ x, y }))(applyMatrix(m, h[0] * single.el.w, h[1] * single.el.h))));
            const top = toScreen((([x, y]) => ({ x, y }))(applyMatrix(m, single.el.w / 2, 0)));
            const [rx, ry] = applyMatrix(multiply(m, translate(single.el.w / 2, 0)), 0, -22 / zoom);
            const rot = toScreen({ x: rx, y: ry });
            return (
              <g>
                <line x1={top.x} y1={top.y} x2={rot.x} y2={rot.y} stroke="#4aa3ff" />
                <circle cx={rot.x} cy={rot.y} r={4.5} fill="#fff" stroke="#4aa3ff" />
                {hs.map((h, i) => <rect key={i} x={h.x - 3.5} y={h.y - 3.5} width={7} height={7} fill="#fff" stroke="#4aa3ff" />)}
              </g>
            );
          })()}
          {tool === 'node' && single && single.el.type === 'path' && (() => {
            const el = single.el as PathElement;
            const m = multiply(sceneMatrix(el, single.surface), scaleM(el.w / el.vw, el.h / el.vh));
            const segs = parsePath(el.d);
            const sp = (x: number, y: number) => { const [a, b] = applyMatrix(m, x, y); return toScreen({ x: a, y: b }); };
            let prev: Pt | null = null;
            return (
              <g>
                {segs.map((sg, i) => {
                  if (sg.c === 'Z') return null;
                  const p = sp(sg.x, sg.y);
                  const out = (
                    <g key={i}>
                      {sg.c === 'C' && prev && (() => {
                        const c1 = sp(sg.x1, sg.y1), c2 = sp(sg.x2, sg.y2);
                        return (
                          <>
                            <line x1={prev!.x} y1={prev!.y} x2={c1.x} y2={c1.y} stroke="#4aa3ff" strokeWidth={0.8} />
                            <line x1={p.x} y1={p.y} x2={c2.x} y2={c2.y} stroke="#4aa3ff" strokeWidth={0.8} />
                            <circle cx={c1.x} cy={c1.y} r={3} fill="#4aa3ff" />
                            <circle cx={c2.x} cy={c2.y} r={3} fill="#4aa3ff" />
                          </>
                        );
                      })()}
                      <rect x={p.x - 3.5} y={p.y - 3.5} width={7} height={7} fill="#fff" stroke="#4aa3ff" />
                    </g>
                  );
                  prev = p;
                  return out;
                })}
              </g>
            );
          })()}
          {guides.x != null && <line x1={toScreen({ x: guides.x, y: 0 }).x} x2={toScreen({ x: guides.x, y: 0 }).x} y1={0} y2={size.h} stroke="#ff3d8b" strokeWidth={1} />}
          {guides.y != null && <line y1={toScreen({ x: 0, y: guides.y }).y} y2={toScreen({ x: 0, y: guides.y }).y} x1={0} x2={size.w} stroke="#ff3d8b" strokeWidth={1} />}
          {marquee && (() => {
            const a = toScreen(marquee.a), b = toScreen(marquee.b);
            return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="rgba(74,163,255,0.08)" stroke="#4aa3ff" strokeDasharray="3 3" />;
          })()}
          {creating && (() => {
            const a = toScreen(creating.a), b = toScreen(creating.b);
            return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="rgba(255,90,54,0.06)" stroke="#ff5a36" strokeDasharray="4 3" />;
          })()}
          {pen && (() => {
            const pts = pen.pts.map((q) => ({ a: toScreen(q), h: toScreen({ x: q.x + q.hx, y: q.y + q.hy }), hi: toScreen({ x: q.x - q.hx, y: q.y - q.hy }) }));
            let d = `M${pts[0].a.x} ${pts[0].a.y}`;
            for (let i = 1; i < pts.length; i++) d += `C${pts[i - 1].h.x} ${pts[i - 1].h.y} ${pts[i].hi.x} ${pts[i].hi.y} ${pts[i].a.x} ${pts[i].a.y}`;
            const hover = penHover ? toScreen(penHover) : null;
            const last = pts[pts.length - 1];
            return (
              <g>
                <path d={d} fill="none" stroke="#ff5a36" strokeWidth={1.2} />
                {hover && <line x1={last.a.x} y1={last.a.y} x2={hover.x} y2={hover.y} stroke="#ff5a36" strokeDasharray="3 3" />}
                {pts.map((q, i) => (
                  <g key={i}>
                    {(q.h.x !== q.a.x || q.h.y !== q.a.y) && <line x1={q.hi.x} y1={q.hi.y} x2={q.h.x} y2={q.h.y} stroke="#ff5a36" strokeWidth={0.8} />}
                    <rect x={q.a.x - 3.5} y={q.a.y - 3.5} width={7} height={7} fill={i === 0 ? '#ff5a36' : '#fff'} stroke="#ff5a36" />
                  </g>
                ))}
              </g>
            );
          })()}
        </g>
      </svg>
      <canvas ref={liveRef} width={Math.round(size.w * dpr)} height={Math.round(size.h * dpr)} className="pointer-events-none absolute inset-0" style={{ width: size.w, height: size.h }} />
      <Rulers zoom={zoom} pan={pan} size={size} unit={project.unit} />
      <SurfaceTabs surfaces={layoutSurfaces(product, null)} active={activeSurface} onPick={(id) => { st().setSurface(id); if (only) st().requestFit(); }} onFocus={(sd) => { userZoomed.current = true; fitBox(sd.bounds); }} />
      <OverlayBar ov={ov} />
      {(tool === 'brush' || tool === 'eraser') && <BrushCursor zoom={zoom} size={brush.size} />}
      {textEditing && (() => {
        const target = allEls.find((x) => x.el.id === textEditing);
        if (!target) return null;
        const b = sceneBounds(target.el, target.surface);
        const a = toScreen({ x: b.x, y: b.y });
        return <TextStoryEditor elementId={textEditing} anchor={{ x: a.x, y: a.y, w: b.w * zoom, h: b.h * zoom }} viewport={size} />;
      })()}
    </div>
  );
}

function SurfaceTabs({ surfaces, active, onPick, onFocus }: { surfaces: SurfaceDesc[]; active: string; onPick: (id: string) => void; onFocus: (sd: SurfaceDesc) => void }) {
  const only = useFocus((s) => s.only);
  if (surfaces.length <= 1) return null;
  return (
    <div data-ui className="absolute left-1/2 top-6 z-10 flex max-w-[calc(100%-260px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-lg border border-ink-700 bg-ink-900/90 p-0.5 shadow-lg backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
      {surfaces.map((sd) => (
        <button key={sd.id} type="button" title="Click to select · double-click to zoom to it" onClick={() => onPick(sd.id)} onDoubleClick={() => onFocus(sd)}
          className={clsx('h-6 shrink-0 rounded-[5px] px-2 text-[11px]', active === sd.id ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-100')}>
          {sd.label}
        </button>
      ))}
      <div className="mx-0.5 h-4 w-px bg-ink-700" />
      <button type="button" title={only ? 'Show every surface' : 'Show only the selected surface'} onClick={() => { useFocus.setState({ only: !only }); useStore.getState().requestFit(); }}
        className={clsx('inline-flex h-6 items-center gap-1 rounded-[5px] px-2 text-[11px]', only ? 'bg-rubric/25 text-ink-100' : 'text-ink-400 hover:text-ink-100')}>
        <Maximize2 size={11} /> {only ? 'One' : 'All'}
      </button>
    </div>
  );
}

const OVERLAY_BUTTONS: { key: keyof Overlays; label: string; icon: React.ReactNode; title: string }[] = [
  { key: 'cut', label: 'Cut', icon: <Scissors size={12} />, title: 'Cut contour (die line)' },
  { key: 'folds', label: 'Folds', icon: <Layers3 size={12} />, title: 'Fold and crease lines' },
  { key: 'bleed', label: 'Bleed', icon: <SquareDashed size={12} />, title: 'Bleed area' },
  { key: 'safe', label: 'Safe', icon: <Eye size={12} />, title: 'Safe area inside each panel' },
  { key: 'zones', label: 'Zones', icon: <Shapes size={12} />, title: 'Glue, seals, seams, distortion and print-area zones' },
  { key: 'dims', label: 'Dims', icon: <Ruler size={12} />, title: 'Dimensions' },
  { key: 'snap', label: 'Snap', icon: <Grid2x2 size={12} />, title: 'Snap to panels, folds, guides and items (hold Alt to bypass)' },
];

function OverlayBar({ ov }: { ov: Overlays }) {
  return (
    <div data-ui className="absolute bottom-3 right-3 z-10 flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-900/90 p-0.5 shadow-lg backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
      {OVERLAY_BUTTONS.map((b) => (
        <button key={b.key} type="button" title={b.title} onClick={() => useStore.getState().setOverlay({ [b.key]: !ov[b.key] })}
          className={clsx('inline-flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[10.5px]', ov[b.key] ? 'bg-ink-700 text-ink-100' : 'text-ink-500 hover:text-ink-200')}>
          {b.icon}<span className="hidden xl:inline">{b.label}</span>
        </button>
      ))}
    </div>
  );
}

function BrushCursor({ zoom, size }: { zoom: number; size: number }) {
  const [pos, setPos] = useState<Pt | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      const root = t.closest?.('.pasteboard');
      if (!root) { setPos(null); return; }
      const r = root.getBoundingClientRect();
      setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, []);
  if (!pos) return null;
  const d = Math.max(3, size * zoom);
  return <div className="pointer-events-none absolute rounded-full border border-white/70 mix-blend-difference" style={{ left: pos.x - d / 2, top: pos.y - d / 2, width: d, height: d }} />;
}
