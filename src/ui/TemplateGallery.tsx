import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useStore } from '../store/store';
import { CATEGORIES, TEMPLATES, cutPath, templateDefaults } from '../products';
import type { ProductTemplate } from '../products/types';
import { polyToPath } from '../products/geom';
import { Toggle } from './controls';
import { BRAND_PRESETS } from '../model/brands';
import { designProduct } from '../engine/designer';
import { useDesignStyle } from './panels/ProductPanel';

function TemplatePreview({ t }: { t: ProductTemplate }) {
  const svg = useMemo(() => {
    const d = t.dieline(templateDefaults(t));
    const s = d.surfaces[0];
    if (!s) return null;
    const ctx = s.context;
    let box = { x: -s.bleed, y: -s.bleed, w: s.w + 2 * s.bleed, h: s.h + 2 * s.bleed };
    if (ctx) {
      // Garments and bottles: frame the context drawing.
      const nums = ctx.d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
      const x0 = Math.min(box.x, ...xs), y0 = Math.min(box.y, ...ys), x1 = Math.max(box.x + box.w, ...xs), y1 = Math.max(box.y + box.h, ...ys);
      box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const pad = Math.max(box.w, box.h) * 0.06;
    return { s, box: { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad } };
  }, [t]);
  if (!svg) return null;
  const { s, box } = svg;
  const sw = Math.max(box.w, box.h) / 160;
  return (
    <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="h-full w-full">
      {s.context && <path d={s.context.d} fill="#3a3940" stroke="#6d6a74" strokeWidth={sw} />}
      {s.cut.map((p, i) => <path key={i} d={polyToPath(p)} fill={s.context ? 'rgba(61,220,132,0.15)' : '#ece7de'} stroke="none" />)}
      {s.cutKind !== 'none' && <path d={cutPath(s)} fill="none" stroke="#ff2d6f" strokeWidth={sw} />}
      {s.cutKind === 'none' && <rect x={0} y={0} width={s.w} height={s.h} fill="none" stroke="#3ddc84" strokeWidth={sw} strokeDasharray={`${sw * 4} ${sw * 3}`} />}
      {s.folds.map((f, i) => <polyline key={i} points={f.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#19b5ff" strokeWidth={sw * 0.9} strokeDasharray={`${sw * 4} ${sw * 2.5}`} />)}
    </svg>
  );
}

export default function TemplateGallery() {
  const [cat, setCat] = useState<string>('All');
  const [starter, setStarter] = useState(true);
  const s = useStore.getState;
  const list = TEMPLATES.filter((t) => cat === 'All' || t.category === cat);
  const add = (t: ProductTemplate) => {
    const id = s().addProduct(t.id);
    if (starter) {
      const style = BRAND_PRESETS.find((b) => b.id === useDesignStyle.getState().style) ?? BRAND_PRESETS[0];
      const p = s().project.products.find((x) => x.id === id);
      if (p) {
        const art = designProduct(p, { kit: s().project.brand, copy: style.copy, look: style.look, variant: s().project.products.length });
        s().update((d) => { const q = d.products.find((x) => x.id === id); if (q) q.surfaces = art; }, { history: false });
      }
    }
    s().setGalleryOpen(false);
    s().setView('design');
    s().setRightTab('product');
    s().requestFit();
  };
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onPointerDown={(e) => { if (e.target === e.currentTarget) s().setGalleryOpen(false); }}>
      <div className="flex max-h-[min(860px,94vh)] w-[min(1080px,96vw)] flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-850 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-ink-700 px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink-100">Add a product</h2>
            <p className="text-[11px] text-ink-400">Parametric templates with real dielines — sizes, folds, glue flaps, bleed and safe areas.</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Toggle label="Start with a design from the brand kit" checked={starter} onChange={setStarter} />
            <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-300 hover:bg-ink-700" onClick={() => s().setGalleryOpen(false)} title="Close"><X size={15} /></button>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-ink-700 px-4 py-2">
          {['All', ...CATEGORIES].map((c) => (
            <button key={c} type="button" onClick={() => setCat(c)} className={clsx('h-7 shrink-0 rounded-full px-3 text-[11.5px]', cat === c ? 'bg-rubric text-white' : 'bg-ink-800 text-ink-300 hover:text-ink-100')}>{c}</button>
          ))}
        </div>
        <div className="scroll-thin grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((t) => (
            <button key={t.id} type="button" onClick={() => add(t)} className="group flex flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-800 text-left transition hover:border-rubric">
              <div className="flex h-36 items-center justify-center bg-[#2a292e] p-3"><TemplatePreview t={t} /></div>
              <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-ink-100">{t.name}</span>
                  <span className="shrink-0 rounded bg-ink-700 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-ink-400">{t.category}</span>
                </div>
                <p className="mt-1 text-[10.5px] leading-snug text-ink-400">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
