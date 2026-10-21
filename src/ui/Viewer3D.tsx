import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Play, Pause, RotateCcw, Camera, Film, Image as ImageIcon, PanelLeft } from 'lucide-react';
import { useStore } from '../store/store';
import { ProductScene, SCENE_UNITS_PER_PT } from '../three/ProductScene';
import { buildModel, type ProductModel } from '../three/models';
import { animationsFor, ANIMATIONS } from '../three/animation';
import type { AnimationMode, LightingPreset, LightingOptions, BackdropPreset, SurfaceTextures } from '../three/types';
import { buildProductTextures, surfaceDensity } from '../render/productTextures';
import { autoEnv, ENV_PRESETS } from '../three/env';
import { preloadAssets } from '../three/assets';
import { LIQUIDS, type LiquidKind } from '../three/pour';
import { useFontStore } from '../engine/fonts';
import { exportVideo, getVideoSupport, type VideoFormat, type VideoSupport } from '../export/video';
import { downloadBlob, safeName } from './projectIO';
import { Button, Select, Slider, Toggle, Section, ColorField, Hint } from './controls';
import { resolveLighting } from '../three/lighting';
import { useScene3D } from './scene3d';
import { dielineOf, getTemplate, optionsOf } from '../products';
import type { Product } from '../model/types';

const LIGHTS: { id: LightingPreset; label: string }[] = [
  { id: 'studio', label: 'Studio' }, { id: 'soft-box', label: 'Soft box' }, { id: 'window', label: 'Window' },
  { id: 'golden-hour', label: 'Golden hour' }, { id: 'dramatic', label: 'Dramatic' }, { id: 'top-down', label: 'Top-down' },
  { id: 'overcast', label: 'Overcast' }, { id: 'gallery', label: 'Gallery' }, { id: 'night', label: 'Night' },
];

const BACKDROPS: { id: BackdropPreset; label: string; color: string; color2: string }[] = [
  { id: 'studio-sweep', label: 'Studio sweep', color: '#d8d8d6', color2: '#b4b3b0' },
  { id: 'solid', label: 'Solid', color: '#e8e4dc', color2: '#c8c2b8' },
  { id: 'gradient', label: 'Gradient', color: '#f1ece3', color2: '#9e978b' },
  { id: 'wood', label: 'Oak table', color: '#8a5a36', color2: '#5c3a22' },
  { id: 'linen', label: 'Linen', color: '#d8cfbf', color2: '#b8ad99' },
  { id: 'concrete', label: 'Concrete', color: '#9c9a96', color2: '#6f6d69' },
  { id: 'paper', label: 'Paper', color: '#f3eee3', color2: '#d9d1c1' },
  { id: 'marble', label: 'Marble', color: '#eceae6', color2: '#9a9690' },
  { id: 'felt', label: 'Felt', color: '#2f4a3e', color2: '#1f3229' },
  { id: 'transparent', label: 'Transparent', color: '#00000000', color2: '#00000000' },
];

const ORIENTATIONS = [
  { id: 'landscape', label: 'Landscape 3:2', w: 3, h: 2 },
  { id: 'wide', label: 'Wide 16:9', w: 16, h: 9 },
  { id: 'portrait', label: 'Portrait 4:5', w: 4, h: 5 },
  { id: 'square', label: 'Square 1:1', w: 1, h: 1 },
  { id: 'story', label: 'Story 9:16', w: 9, h: 16 },
] as const;
type OrientationId = (typeof ORIENTATIONS)[number]['id'];

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
function sizeFor(o: OrientationId, longEdge: number) {
  const r = ORIENTATIONS.find((x) => x.id === o)!;
  return r.w >= r.h ? { w: even(longEdge), h: even((longEdge * r.h) / r.w) } : { w: even((longEdge * r.w) / r.h), h: even(longEdge) };
}
const focal = (fov: number) => Math.round(12 / Math.tan((fov * Math.PI) / 360));

/** Products on set: the active one, or the whole range for a line-up. */
function onSet(products: Product[], activeId: string, lineup: boolean): Product[] {
  const active = products.find((p) => p.id === activeId) ?? products[0];
  if (!active) return [];
  if (!lineup) return [active];
  return [active, ...products.filter((p) => p.id !== active.id)].slice(0, 7);
}

const LYING = ['card', 'letterhead', 'pillow'];
const ROLLING = ['can', 'bottle', 'jar', 'tube', 'cup'];
const FOLDING = ['tuck-reverse', 'tuck-straight', 'mailer', 'sleeve', 'pillow', 'paper-bag'];
const OPENING = ['sleeve', 'tube', 'card'];
const POURING = ['can', 'bottle'];
const DRINKS = ['can', 'bottle', 'cup'];

export default function Viewer3D() {
  const project = useStore((s) => s.project);
  const activeId = useStore((s) => s.product);
  const fontVersion = useFontStore((s) => s.version);
  const st = useScene3D();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ProductScene | null>(null);
  const modelsRef = useRef<ProductModel[]>([]);
  const texRef = useRef(new Map<string, { product: Product; version: number; tex: SurfaceTextures; ppp: number }>());
  /** Density the hero's textures were built at (px per pt), and the latest state the sharpener reads. */
  const densityRef = useRef<{ id: string; ppp: number }>({ id: '', ppp: 0 });
  const liveRef = useRef<{ project: typeof project; products: Product[]; fontVersion: number }>({ project, products: [], fontVersion });
  const sharpenRef = useRef<{ busy: boolean; again: boolean }>({ busy: false, again: false });
  const [playing, setPlaying] = useState(true);
  const [building, setBuilding] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Bumps when the Blender assets (cloth garments, ice, normal maps) have loaded: models rebuild. */
  const [assetsReady, setAssetsReady] = useState(0);
  useEffect(() => { let live = true; void preloadAssets().then(() => { if (live) setAssetsReady((v) => v + 1); }); return () => { live = false; }; }, []);
  const [scrub, setScrub] = useState(0);
  const [fold, setFold] = useState(1);
  const [open, setOpen] = useState(0);
  const [pour, setPour] = useState(1);
  const rootRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 760));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const products = useMemo(() => onSet(project.products, activeId, st.lineup), [project.products, activeId, st.lineup]);
  liveRef.current = { project, products, fontVersion };
  const hero = products[0] ?? null;
  const geoKey = products.map((p) => `${p.id}:${p.template}`).join(',');
  const optionsKey = products.map((p) => p.options);
  const traits = useMemo(() => {
    if (!hero) return {};
    const id = hero.template;
    return { lying: LYING.includes(id), rollRadius: ROLLING.includes(id) ? 1 : undefined, hasFold: FOLDING.includes(id), hasOpen: OPENING.includes(id), canPour: POURING.includes(id), drink: POURING.includes(id) };
  }, [hero]);
  const multi = st.lineup && products.length > 1;
  const anims = useMemo(() => (hero ? (multi ? ANIMATIONS.filter((a) => ['turntable', 'hero', 'float', 'reveal'].includes(a.id)) : animationsFor(getTemplate(hero.template).animations, traits)) : []), [hero, traits, multi]);
  const mode: AnimationMode = anims.some((a) => a.id === st.mode) ? st.mode : (anims[0]?.id ?? 'none');
  const baseDuration = anims.find((a) => a.id === mode)?.duration ?? 6;

  const call = <T,>(fn: (s: ProductScene) => T): T | undefined => {
    const s = sceneRef.current;
    if (!s) return undefined;
    try { return fn(s); } catch (e) { console.warn(e); return undefined; }
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    let sc: ProductScene;
    try {
      sc = new ProductScene(canvas, { preserveDrawingBuffer: true });
    } catch (e) {
      setError(`WebGL is not available in this browser (${(e as Error).message}).`);
      return;
    }
    sceneRef.current = sc;
    if (import.meta.env.DEV) (window as unknown as { __scene: ProductScene }).__scene = sc;
    // Re-rasterise the hero's art when the camera settles closer than its textures can resolve.
    let timer = 0;
    sc.onCameraChange = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void sharpen(); }, 380); };
    const ro = new ResizeObserver(() => {
      const el = wrapRef.current;
      if (el) sc.resize(el.clientWidth, el.clientHeight, Math.min(2, window.devicePixelRatio || 1));
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => { ro.disconnect(); window.clearTimeout(timer); sc.onCameraChange = null; sc.dispose(); sceneRef.current = null; };
  }, []);

  const refreshOpts = () => ({
    dew: { amount: st.dew, size: st.dewSize, drips: st.drips, frost: st.dew > 0 ? st.frost : 0 },
    ice: st.ice, iceBed: st.iceBed, glass: st.glass, liquid: st.liquid, liquidColor: st.liquidColor, glassIce: st.glassIce,
  });
  function applyAll() {
    call((s) => s.setRefresh(refreshOpts()));
    call((s) => s.setToneMapping(st.tone));
    call((s) => s.setEnvironment(st.env === 'auto' ? autoEnv(st.lighting) : st.env));
    call((s) => s.setLighting({ preset: st.lighting, ...st.light }));
    call((s) => s.setBackdrop({ preset: st.backdrop, color: st.color, color2: st.color2, showGround: st.ground }));
    call((s) => s.setCamera({ fov: st.fov }));
  }

  const startMode = (m: AnimationMode, play = true) => {
    st.set({ mode: m });
    const s = sceneRef.current;
    if (!s) return;
    const base = anims.find((a) => a.id === m)?.duration ?? 6;
    s.setAnimation(m, { loop: st.loop, duration: base / st.speed });
    if (play) { s.play(); setPlaying(true); } else s.pause();
  };

  // Geometry follows templates and options; artwork arrives separately as textures.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    try {
      const models = products.map((p) => buildModel({ template: p.template, options: optionsOf(p), dieline: dielineOf(p), scale: SCENE_UNITS_PER_PT, anisotropy: 8 }));
      modelsRef.current = models;
      models.forEach((m, i) => { const t = texRef.current.get(products[i].id); if (t) m.applyTextures(t.tex); });
      s.setModels(models);
      applyAll();
      startMode(mode, playing);
      setError(null);
    } catch (e) {
      console.error(e);
      setError(`Could not build the 3D model: ${(e as Error).message}`);
    }
  }, [geoKey, assetsReady, ...optionsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Textures follow every visual change (debounced).
  useEffect(() => {
    const signal = { cancelled: false };
    setBuilding(true);
    const t = setTimeout(async () => {
      try {
        for (let i = 0; i < products.length; i++) {
          const p = products[i];
          const prev = texRef.current.get(p.id);
          if (prev && prev.product === p && prev.version === fontVersion) {
            if (i === 0) { densityRef.current = { id: p.id, ppp: prev.ppp }; void sharpen(); }
            continue;
          }
          const want = i === 0 ? demandNow() : 0;
          const tex = await buildProductTextures(project, p, { signal, maxPx: i === 0 ? 2560 : 1400, ppp: want || undefined });
          if (!tex || signal.cancelled) return;
          const ppp = i === 0 ? effectiveDensity(p, want) : 0;
          texRef.current.set(p.id, { product: p, version: fontVersion, tex, ppp });
          if (i === 0) densityRef.current = { id: p.id, ppp };
          modelsRef.current[i]?.applyTextures(tex);
          sceneRef.current?.invalidate();
        }
      } catch (e) {
        console.error(e);
        setError(`Could not render textures: ${(e as Error).message}`);
      } finally {
        if (!signal.cancelled) setBuilding(false);
      }
    }, 300);
    return () => { signal.cancelled = true; clearTimeout(t); };
  }, [project, products, fontVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { call((s) => s.setLighting({ preset: st.lighting, ...st.light })); }, [st.lighting, st.light]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { call((s) => s.setEnvironment(st.env === 'auto' ? autoEnv(st.lighting) : st.env)); }, [st.env, st.lighting]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { call((s) => s.setToneMapping(st.tone)); }, [st.tone]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { call((s) => s.setRefresh(refreshOpts())); }, [st.dew, st.dewSize, st.drips, st.frost, st.ice, st.iceBed, st.glass, st.liquid, st.liquidColor, st.glassIce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { call((s) => s.setBackdrop({ preset: st.backdrop, color: st.color, color2: st.color2, showGround: st.ground })); }, [st.backdrop, st.color, st.color2, st.ground]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { call((s) => s.setCamera({ fov: st.fov })); }, [st.fov]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { startMode(mode, playing); }, [mode, st.speed, st.loop]); // eslint-disable-line react-hooks/exhaustive-deps
  // The time slider follows the playhead while an animation plays (and notices a one-shot run ending).
  useEffect(() => {
    if (!playing || mode === 'none') return;
    const id = window.setInterval(() => {
      const s = sceneRef.current;
      if (!s) return;
      const d = s.getAnimationDuration();
      setScrub(d > 0 ? Math.min(1, (s.getTime() % (d + 1e-9)) / d) : 0);
      if (!s.isPlaying()) setPlaying(false);
    }, 120);
    return () => window.clearInterval(id);
  }, [playing, mode]);

  /** The density the view asks of the hero's art, rounded up to steps of √2 (fewer rebuilds). */
  function demandNow(width?: number, height?: number): number {
    const d = sceneRef.current?.getTextureDemand(width, height) ?? 0;
    return d > 0 ? Math.pow(2, Math.ceil(Math.log2(d) * 2) / 2) : 0;
  }
  /** The highest density any of a product's surfaces actually gets for a request. */
  function effectiveDensity(p: Product, want: number): number {
    let best = 0;
    for (const sf of dielineOf(p).surfaces) best = Math.max(best, surfaceDensity({ w: sf.w + 2 * sf.bleed, h: sf.h + 2 * sf.bleed }, { maxPx: 2560, ppp: want || undefined }));
    return best;
  }
  /** Sharpen the hero's textures for the current view (or an export of width × height). */
  async function sharpen(width?: number, height?: number): Promise<void> {
    const flight = sharpenRef.current;
    if (flight.busy) { flight.again = true; return; }
    const { project: pr, products: list, fontVersion: fv } = liveRef.current;
    const hero = list[0];
    const s = sceneRef.current;
    if (!hero || !s) return;
    const want = demandNow(width, height);
    const cur = densityRef.current;
    if (cur.id !== hero.id || !want) return;
    const eff = effectiveDensity(hero, want);
    if (eff <= cur.ppp * 1.15) return;
    flight.busy = true;
    try {
      const tex = await buildProductTextures(pr, hero, { maxPx: 2560, ppp: want });
      if (!tex || liveRef.current.products[0] !== hero) return;
      texRef.current.set(hero.id, { product: hero, version: fv, tex, ppp: eff });
      modelsRef.current[0]?.applyTextures(tex);
      densityRef.current = { id: hero.id, ppp: eff };
      sceneRef.current?.invalidate();
    } catch (e) {
      console.warn('3D textures: could not sharpen', e);
    } finally {
      flight.busy = false;
      if (flight.again) { flight.again = false; void sharpen(); }
    }
  }

  const togglePlay = () => {
    const s = sceneRef.current;
    if (!s) return;
    if (mode === 'none') return;
    if (s.isPlaying()) { s.pause(); setPlaying(false); return; }
    // Resume from where the time slider stands.
    const d = baseDuration / st.speed;
    s.setAnimation(mode, { loop: st.loop, duration: d });
    if (scrub > 0 && scrub < 0.999) s.seek(scrub * d);
    s.play(); setPlaying(true);
  };

  const bgCss = st.backdrop === 'transparent' ? 'repeating-conic-gradient(#3a3940 0% 25%, #2b2a2f 0% 50%) 50% / 16px 16px' : st.color;

  return (
    <div ref={rootRef} className="relative flex h-full w-full">
      {st.panel && (
        <aside className={clsx('scroll-thin w-[268px] shrink-0 overflow-y-auto border-r border-ink-700 bg-ink-850', narrow && 'absolute inset-y-0 left-0 z-10 max-w-[85%] shadow-2xl')}>
          <ProductPicker />
          <ScenePanel anims={anims} mode={mode} startMode={(m) => startMode(m)} />
          <ExportPanel scene={sceneRef} wrap={wrapRef} title={`${project.brand.name}-${hero?.name ?? 'product'}`} mode={mode} duration={baseDuration / st.speed} prepare={(w, h) => sharpen(w, h)} onDone={() => { applyAll(); startMode(mode, playing); }} />
        </aside>
      )}
      <div ref={wrapRef} className="relative min-w-0 flex-1" style={{ background: bgCss }}>
        <canvas ref={canvasRef} className="block h-full w-full" />
        {!hero && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-700">Add a product to see it in 3D.</div>}
        {error && <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-[13px] text-ink-900">{error}</div>}
        {building && !error && hero && <div className="absolute left-3 top-3 rounded bg-black/55 px-2 py-1 text-[11px] text-white">Rendering artwork…</div>}
        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-lg bg-black/50 p-1 backdrop-blur">
          <button type="button" title={st.panel ? 'Hide scene panel' : 'Show scene panel'} className="rounded p-1.5 text-white/80 hover:bg-white/10" onClick={() => st.set({ panel: !st.panel })}><PanelLeft size={14} /></button>
          <button type="button" title="Reset camera" className="rounded p-1.5 text-white/80 hover:bg-white/10" onClick={() => sceneRef.current?.resetCamera()}><RotateCcw size={14} /></button>
          <button type="button" title="Quick snapshot (current view)" className="rounded p-1.5 text-white/80 hover:bg-white/10" onClick={() => {
            const url = sceneRef.current?.snapshot();
            if (url) { const a = document.createElement('a'); a.href = url; a.download = `${safeName(hero?.name ?? 'product')}-3d.png`; a.click(); }
          }}><Camera size={14} /></button>
        </div>
        {hero && (
          <div className="absolute bottom-3 left-1/2 flex w-[min(680px,calc(100%-24px))] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl bg-black/55 px-3 py-2 text-white backdrop-blur">
            <button type="button" onClick={togglePlay} className="rounded-full bg-white/15 p-1.5 hover:bg-white/25" title={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
            <span className="min-w-[80px] truncate text-[11.5px] text-white/80">{anims.find((a) => a.id === mode)?.label ?? 'Still'}</span>
            <label className="flex min-w-[120px] flex-1 items-center gap-1.5 text-[10.5px] text-white/70" title="Scrub the animation">
              Time
              <input type="range" className="w-full" min={0} max={1} step={0.001} value={scrub} onChange={(e) => {
                const v = parseFloat(e.target.value);
                setScrub(v);
                const s = sceneRef.current;
                if (!s) return;
                if (!s.isPlaying() && mode !== 'none') s.setAnimation(mode, { loop: st.loop, duration: baseDuration / st.speed });
                s.pause(); setPlaying(false);
                s.seek(v * s.getAnimationDuration());
                s.render();
              }} />
            </label>
            {traits.hasFold && !multi && (
              <label className="flex items-center gap-1.5 text-[10.5px] text-white/70">Fold
                <input type="range" className="w-20" min={0} max={1} step={0.01} value={fold} onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setFold(v); setPlaying(false);
                  sceneRef.current?.setAnimation('none');
                  sceneRef.current?.setManual({ fold: v });
                }} />
              </label>
            )}
            {traits.canPour && !multi && (st.glass || mode === 'pour') && (
              <label className="flex items-center gap-1.5 text-[10.5px] text-white/70" title="A still of the pour: 0 = empty glass, the middle = mid-pour, 1 = full">Pour
                <input type="range" className="w-20" min={0} max={1} step={0.01} value={pour} onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setPour(v); setPlaying(false);
                  sceneRef.current?.setAnimation('none');
                  sceneRef.current?.setManual({ pour: v });
                }} />
              </label>
            )}
            {traits.hasOpen && !multi && (
              <label className="flex items-center gap-1.5 text-[10.5px] text-white/70">Open
                <input type="range" className="w-20" min={0} max={1} step={0.01} value={open} onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setOpen(v); setPlaying(false);
                  sceneRef.current?.setAnimation('none');
                  sceneRef.current?.setManual({ open: v });
                }} />
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Panels                                                                      */
/* -------------------------------------------------------------------------- */

function ProductPicker() {
  const products = useStore((s) => s.project.products);
  const active = useStore((s) => s.product);
  const st = useScene3D();
  return (
    <Section title="On set" id="s3d-product">
      <Select label="Product" value={active} options={products.map((p) => ({ value: p.id, label: p.name }))} onChange={(v) => useStore.getState().setProduct(v)} />
      {products.length > 1 && <Toggle label="Line-up: the whole range side by side" checked={st.lineup} onChange={(v) => st.set({ lineup: v })} />}
      <Hint>Glass, liquids, closures, coatings and print methods are in the Product tab on the right.</Hint>
    </Section>
  );
}

function ScenePanel({ anims, mode, startMode }: { anims: typeof ANIMATIONS; mode: AnimationMode; startMode: (m: AnimationMode) => void }) {
  const st = useScene3D();
  const light = (k: keyof LightingOptions, v: number) => st.set({ light: { ...st.light, [k]: v } });
  const L = resolveLighting({ preset: st.lighting, ...st.light });
  return (
    <div>
      <Section title="Animation" id="s3d-anim">
        <div className="space-y-0.5">
          {anims.map((a) => (
            <button key={a.id} type="button" title={a.description} onClick={() => startMode(a.id)}
              className={clsx('flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[11.5px]', mode === a.id ? 'bg-rubric/25 text-ink-100' : 'text-ink-300 hover:bg-ink-750')}>
              <span>{a.label}</span>
              <span className="tabular-nums text-[10px] text-ink-500">{(a.duration / st.speed).toFixed(1)} s</span>
            </button>
          ))}
        </div>
        <Slider label="Speed" value={st.speed} min={0.25} max={3} step={0.05} onChange={(v) => st.set({ speed: v })} format={(v) => `${v.toFixed(2)}×`} />
        <div className="flex items-center justify-between">
          <Toggle label="Loop" checked={st.loop} onChange={(v) => st.set({ loop: v })} />
          <Button variant="ghost" onClick={() => startMode(mode)}>Restart</Button>
        </div>
      </Section>
      <Section title="Lighting" id="s3d-light">
        <div className="grid grid-cols-3 gap-1">
          {LIGHTS.map((l) => (
            <button key={l.id} type="button" onClick={() => st.set({ lighting: l.id, light: {} })}
              className={clsx('h-7 rounded border text-[10.5px]', st.lighting === l.id ? 'border-rubric bg-rubric/20 text-ink-100' : 'border-ink-700 text-ink-400 hover:text-ink-100')}>{l.label}</button>
          ))}
        </div>
        <Select label="Environment (reflections)" value={st.env} options={[{ value: 'auto', label: 'Auto (follows the lighting)' }, ...ENV_PRESETS.map((e) => ({ value: e.id, label: e.label }))]} onChange={(v) => st.set({ env: v as typeof st.env })} />
        <Select label="Tone mapping" value={st.tone} options={[{ value: 'neutral', label: 'Neutral (true brand colours)' }, { value: 'agx', label: 'AgX (filmic, soft highlights)' }, { value: 'aces', label: 'ACES (contrasty)' }]} onChange={(v) => st.set({ tone: v as typeof st.tone })} />
        <Slider label="Intensity" value={L.intensity} min={0} max={3} onChange={(v) => light('intensity', v)} />
        <Slider label="Key light direction" value={L.azimuth} min={-180} max={180} step={1} onChange={(v) => light('azimuth', v)} format={(v) => `${Math.round(v)}°`} />
        <Slider label="Key light height" value={L.elevation} min={5} max={85} step={1} onChange={(v) => light('elevation', v)} format={(v) => `${Math.round(v)}°`} />
        <Slider label="Warmth" value={L.warmth} min={-1} max={1} onChange={(v) => light('warmth', v)} format={(v) => (v > 0.05 ? 'warm' : v < -0.05 ? 'cool' : 'neutral')} />
        <Slider label="Exposure" value={L.exposure} min={0.3} max={3} onChange={(v) => light('exposure', v)} />
        <Slider label="Shadow softness" value={L.shadowSoftness} min={0} max={1} onChange={(v) => light('shadowSoftness', v)} />
        <Slider label="Ambient bounce" value={L.ambient} min={0} max={2} onChange={(v) => light('ambient', v)} />
      </Section>
      <Section title="Backdrop" id="s3d-backdrop">
        <div className="grid grid-cols-2 gap-1">
          {BACKDROPS.map((b) => (
            <button key={b.id} type="button" onClick={() => st.set({ backdrop: b.id, color: b.color, color2: b.color2 })}
              className={clsx('flex h-7 items-center gap-1.5 rounded border px-1.5 text-left text-[10.5px]', st.backdrop === b.id ? 'border-rubric bg-rubric/20 text-ink-100' : 'border-ink-700 text-ink-400 hover:text-ink-100')}>
              <span className={clsx('h-3.5 w-3.5 shrink-0 rounded-sm border border-white/15', b.id === 'transparent' && 'checker')} style={b.id === 'transparent' ? undefined : { background: `linear-gradient(135deg, ${b.color}, ${b.color2})` }} />
              {b.label}
            </button>
          ))}
        </div>
        {st.backdrop !== 'transparent' && (
          <div className="grid grid-cols-2 gap-2">
            <ColorField label={st.backdrop === 'gradient' ? 'Top' : 'Colour'} value={st.color} onChange={(v) => v && st.set({ color: v })} />
            {st.backdrop !== 'solid' && st.backdrop !== 'studio-sweep' && <ColorField label={st.backdrop === 'gradient' ? 'Bottom' : 'Grain / vein'} value={st.color2} onChange={(v) => v && st.set({ color2: v })} />}
          </div>
        )}
        <Toggle label="Ground & contact shadow" checked={st.ground} onChange={(v) => st.set({ ground: v })} />
        {st.backdrop === 'transparent' && <Hint>Stills export as PNG with alpha; WebM keeps transparency where the encoder supports it.</Hint>}
      </Section>
      <Section title="Refreshing" id="s3d-refresh">
        <Hint>Cold-drink styling for cans, bottles and cups: dew, ice and a glass to pour into.</Hint>
        <Slider label="Condensation" value={st.dew} min={0} max={1} onChange={(v) => st.set({ dew: v })} format={(v) => (v < 0.02 ? 'off' : `${Math.round(v * 100)}%`)} />
        {st.dew > 0.01 && (
          <>
            <Slider label="Droplet size" value={st.dewSize} min={0.5} max={2} onChange={(v) => st.set({ dewSize: v })} format={(v) => `${v.toFixed(2)}×`} />
            <Slider label="Frost haze" value={st.frost} min={0} max={1} onChange={(v) => st.set({ frost: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <Toggle label="Running drips" checked={st.drips} onChange={(v) => st.set({ drips: v })} />
          </>
        )}
        <Slider label="Ice cubes around" value={st.ice} min={0} max={12} step={1} onChange={(v) => st.set({ ice: v })} format={(v) => (v ? String(Math.round(v)) : 'none')} />
        <Toggle label="Stand in crushed ice" checked={st.iceBed} onChange={(v) => st.set({ iceBed: v })} />
        <Toggle label="Glass on set (pour into it)" checked={st.glass} onChange={(v) => st.set({ glass: v })} />
        <Select label="Drink" value={st.liquid} options={(Object.keys(LIQUIDS) as LiquidKind[]).map((k) => ({ value: k, label: LIQUIDS[k].label }))} onChange={(v) => st.set({ liquid: v as LiquidKind, liquidColor: null })} />
        <ColorField label="Drink colour" value={st.liquidColor ?? LIQUIDS[st.liquid].color} onChange={(v) => st.set({ liquidColor: v || null })} />
        <Slider label="Ice in the glass" value={st.glassIce} min={0} max={5} step={1} onChange={(v) => st.set({ glassIce: v })} format={(v) => (v ? String(Math.round(v)) : 'none')} />
        <Hint>Pick the Pour or Fizz animation, or use the Pour slider under the view for a mid-pour still.</Hint>
      </Section>
      <Section title="Camera" id="s3d-camera">
        <Slider label="Lens" value={st.fov} min={15} max={75} step={1} onChange={(v) => st.set({ fov: v })} format={(v) => `${focal(v)} mm`} hint="Longer lenses flatten perspective for product shots" />
        <Hint>Drag to orbit, scroll to zoom, right-drag to pan; the reset button returns to automatic framing.</Hint>
      </Section>
    </div>
  );
}

function ExportPanel({ scene, wrap, title, mode, duration, prepare, onDone }: { scene: React.MutableRefObject<ProductScene | null>; wrap: React.RefObject<HTMLDivElement | null>; title: string; mode: AnimationMode; duration: number; prepare: (w: number, h: number) => Promise<void>; onDone: () => void }) {
  const st = useScene3D();
  const [orientation, setOrientation] = useState<OrientationId>('portrait');
  const [stillEdge, setStillEdge] = useState(2400);
  const [videoEdge, setVideoEdge] = useState(1080);
  const [format, setFormat] = useState<VideoFormat>('mp4');
  const [fps, setFps] = useState(30);
  const [support, setSupport] = useState<VideoSupport | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [photoSamples, setPhotoSamples] = useState(128);
  const [photoDenoise, setPhotoDenoise] = useState(true);
  const [photo, setPhoto] = useState<{ p: number; samples: number; t0: number } | null>(null);
  const photoAbort = useRef<AbortController | null>(null);

  useEffect(() => { void getVideoSupport().then((s) => { setSupport(s); if (!s.mp4) setFormat(s.webm ? 'webm' : 'gif'); }); }, []);
  useEffect(() => { if (format === 'gif') { setFps(15); setVideoEdge((e) => Math.min(e, 800)); } }, [format]);

  const restore = () => {
    const s = scene.current, el = wrap.current;
    if (s && el) s.resize(el.clientWidth, el.clientHeight, Math.min(2, window.devicePixelRatio || 1));
  };

  const still = async () => {
    const s = scene.current;
    if (!s) return;
    const { w, h } = sizeFor(orientation, stillEdge);
    try {
      // Art as sharp as the export resolution needs.
      await prepare(w, h);
      const canvas = s.renderStill(w, h);
      const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
      downloadBlob(blob, `${safeName(title)}-${orientation}-${w}x${h}.png`);
      useStore.getState().notify(`Still exported — ${w} × ${h} px.`);
    } catch (e) {
      useStore.getState().notify(`Still export failed: ${(e as Error).message}`, 'error');
    } finally {
      restore();
    }
  };

  const renderPhoto = async () => {
    const s = scene.current;
    if (!s) return;
    const { w, h } = sizeFor(orientation, stillEdge);
    photoAbort.current = new AbortController();
    const t0 = performance.now();
    setPhoto({ p: 0, samples: 0, t0 });
    s.pause();
    try {
      await prepare(w, h);
      const canvas = await s.renderPhoto({ width: w, height: h, samples: photoSamples, denoise: photoDenoise ? {} : false, signal: photoAbort.current.signal, onProgress: (p, n) => setPhoto({ p, samples: n, t0 }) });
      const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
      downloadBlob(blob, `${safeName(title)}-photo-${w}x${h}.png`);
      useStore.getState().notify(`Photo rendered — ${w} × ${h}, ${photoSamples} samples in ${((performance.now() - t0) / 1000).toFixed(0)} s.`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') useStore.getState().notify(`Photo render failed: ${(e as Error).message}`, 'error');
    } finally {
      setPhoto(null);
      restore();
      onDone();
    }
  };

  const video = async () => {
    const s = scene.current;
    if (!s || mode === 'none') return;
    const { w, h } = sizeFor(orientation, videoEdge);
    await prepare(w, h);
    abort.current = new AbortController();
    setProgress(0);
    s.pause();
    s.setAnimation(mode, { loop: false, duration });
    try {
      const blob = await exportVideo(s, { format, width: w, height: h, fps, duration, onProgress: setProgress, signal: abort.current.signal });
      downloadBlob(blob, `${safeName(title)}-${mode}-${orientation}.${format}`);
      useStore.getState().notify(`${format.toUpperCase()} exported — ${w} × ${h}, ${(blob.size / 1e6).toFixed(1)} MB.`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') useStore.getState().notify(`Video export failed: ${(e as Error).message}`, 'error');
    } finally {
      setProgress(null);
      restore();
      onDone();
    }
  };

  const vs = sizeFor(orientation, videoEdge), ss = sizeFor(orientation, stillEdge);
  return (
    <Section title="Export stills & motion" id="s3d-export">
      <span className="text-[10.5px] text-ink-400">Aspect</span>
      <div className="grid grid-cols-5 gap-1">
        {ORIENTATIONS.map((o) => (
          <button key={o.id} type="button" onClick={() => setOrientation(o.id)} title={o.label}
            className={clsx('flex h-12 flex-col items-center justify-center gap-1 rounded border text-[9px]', orientation === o.id ? 'border-rubric bg-rubric/20 text-ink-100' : 'border-ink-700 text-ink-400 hover:text-ink-100')}>
            <span className="block rounded-[2px] border border-current" style={{ width: o.w >= o.h ? 20 : (20 * o.w) / o.h, height: o.w >= o.h ? (20 * o.h) / o.w : 20 }} />
            {o.label.split(' ')[0]}
          </button>
        ))}
      </div>
      <div className="rounded-md border border-ink-700 p-2">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-ink-200"><ImageIcon size={12} /> Still image</div>
        <Select label="Long edge" value={String(stillEdge)} options={[1200, 1600, 2400, 3200, 4096].map((v) => ({ value: String(v), label: `${v} px` }))} onChange={(v) => setStillEdge(Number(v))} />
        <Button variant="primary" className="mt-2 w-full" onClick={still}>Render PNG · {ss.w} × {ss.h}</Button>
      </div>
      <div className="rounded-md border border-ink-700 p-2">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-ink-200"><Camera size={12} /> Photo (path-traced)</div>
        <Select label="Samples" value={String(photoSamples)} options={[32, 64, 128, 256, 512, 1024].map((v) => ({ value: String(v), label: `${v} samples${v <= 32 ? ' · preview' : v <= 64 ? ' · draft' : v === 128 ? ' · good' : v >= 512 ? ' · final' : ''}` }))} onChange={(v) => setPhotoSamples(Number(v))} />
        <Toggle label="Denoise (keeps print sharp)" checked={photoDenoise} onChange={setPhotoDenoise} />
        {photo ? (
          <div className="mt-2 space-y-1.5">
            <div className="h-1.5 overflow-hidden rounded bg-ink-700"><div className="h-full bg-rubric" style={{ width: `${Math.round(photo.p * 100)}%` }} /></div>
            <div className="flex items-center justify-between text-[11px] text-ink-300">
              <span>Tracing… {Math.floor(photo.samples)} / {photoSamples}{photo.p > 0.04 ? ` · ~${Math.max(1, Math.round(((performance.now() - photo.t0) / 1000) * (1 / photo.p - 1)))} s left` : ''}</span>
              <Button variant="ghost" onClick={() => photoAbort.current?.abort()}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" className="mt-2 w-full" onClick={renderPhoto}>Render photo · {ss.w} × {ss.h}</Button>
        )}
        <Hint>Path-traces the shot with the studio HDRI: real refraction through glass, drinks, ice and drops, and soft shadows. Uses the still&apos;s aspect and size; the live view stays fast. At 1600 px, 128 samples take a few minutes on a laptop GPU.</Hint>
      </div>
      <div className="rounded-md border border-ink-700 p-2">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-ink-200"><Film size={12} /> Motion · {ANIMATIONS.find((a) => a.id === mode)?.label ?? 'choose an animation'}</div>
        <Select<VideoFormat> label="Format" value={format} options={[
          { value: 'mp4', label: `MP4 · H.264${support && !support.mp4 ? ' (unsupported here)' : ''}` },
          { value: 'webm', label: `WebM · VP9${support && !support.webm ? ' (unsupported here)' : ''}` },
          { value: 'gif', label: 'GIF' },
        ]} onChange={setFormat} />
        <div className="mt-1 grid grid-cols-2 gap-2">
          <Select label="Long edge" value={String(videoEdge)} options={(format === 'gif' ? [480, 640, 800] : [720, 1080, 1920, 2160]).map((v) => ({ value: String(v), label: `${v} px` }))} onChange={(v) => setVideoEdge(Number(v))} />
          <Select label="Frame rate" value={String(fps)} options={(format === 'gif' ? [10, 12, 15, 20] : [24, 25, 30, 60]).map((f) => ({ value: String(f), label: `${f} fps` }))} onChange={(v) => setFps(Number(v))} />
        </div>
        {progress != null ? (
          <div className="mt-2 space-y-1.5">
            <div className="h-1.5 overflow-hidden rounded bg-ink-700"><div className="h-full bg-rubric" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            <div className="flex items-center justify-between text-[11px] text-ink-300">Encoding… {Math.round(progress * 100)}%<Button variant="ghost" onClick={() => abort.current?.abort()}>Cancel</Button></div>
          </div>
        ) : (
          <Button variant="primary" className="mt-2 w-full" disabled={mode === 'none' || (format === 'mp4' && support != null && !support.mp4) || (format === 'webm' && support != null && !support.webm)} onClick={video}>Render {format.toUpperCase()} · {vs.w} × {vs.h} · {duration.toFixed(1)} s</Button>
        )}
        <Hint>Frames render one by one at full quality and encode in your browser; the framing adapts to the aspect. {st.backdrop === 'transparent' ? 'WebM keeps the transparent backdrop where supported.' : ''}</Hint>
      </div>
    </Section>
  );
}
