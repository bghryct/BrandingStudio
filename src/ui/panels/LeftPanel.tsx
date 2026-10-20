import React, { useRef } from 'react';
import clsx from 'clsx';
import { Plus, Trash, Copy, Eye, EyeOff, Lock, LockOpen, ChevronUp, ChevronDown, Upload, Image as ImageIcon, Stamp } from 'lucide-react';
import { useStore, type LeftTab, activeSurfaceKey } from '../../store/store';
import { productOf } from '../../model/surfaces';
import { dielineOf, getTemplate, surfaceOf } from '../../products';
import { Button, Hint, ColorField } from '../controls';
import { SurfaceThumb } from '../thumbs';
import { BrandPanel } from './BrandPanel';
import { importFiles } from '../importFiles';
import { makeImage, makeSvg } from '../../model/factory';
import type { Element } from '../../model/types';

const TABS: { id: LeftTab; label: string }[] = [
  { id: 'products', label: 'Products' },
  { id: 'layers', label: 'Layers' },
  { id: 'brand', label: 'Brand' },
  { id: 'assets', label: 'Assets' },
];

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  return (
    <aside className="flex w-[272px] shrink-0 flex-col border-r border-ink-700 bg-ink-850">
      <div className="flex h-9 shrink-0 items-end gap-0.5 border-b border-ink-700 px-1.5">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => useStore.getState().setLeftTab(t.id)}
            className={clsx('h-8 rounded-t px-2.5 text-[11.5px]', tab === t.id ? 'border-x border-t border-ink-700 bg-ink-800 text-ink-100' : 'text-ink-400 hover:text-ink-200')}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {tab === 'products' && <ProductsTab />}
        {tab === 'layers' && <LayersTab />}
        {tab === 'brand' && <BrandPanel />}
        {tab === 'assets' && <AssetsTab />}
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Products                                                                     */
/* -------------------------------------------------------------------------- */

function ProductsTab() {
  const project = useStore((s) => s.project);
  const active = useStore((s) => s.product);
  const activeSurface = useStore((s) => s.surface);
  const s = useStore.getState;
  return (
    <div className="p-2">
      <Button variant="primary" className="mb-2 w-full" onClick={() => s().setGalleryOpen(true)}><Plus size={13} /> Add a product</Button>
      <div className="space-y-1.5">
        {project.products.map((p) => {
          const t = getTemplate(p.template);
          const surfaces = dielineOf(p).surfaces;
          const isActive = p.id === active;
          return (
            <div key={p.id} className={clsx('rounded-md border p-1.5', isActive ? 'border-rubric/70 bg-ink-800' : 'border-ink-700 hover:border-ink-600')}>
              <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => { s().setProduct(p.id); s().requestFit(); }}>
                <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-[#2f2e34]">
                  <SurfaceThumb project={project} product={p} width={80} height={56} withCut />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-ink-100">{p.name}</div>
                  <div className="truncate text-[10.5px] text-ink-400">{t.name}</div>
                  <div className="text-[10px] text-ink-500">{surfaces.length} surface{surfaces.length === 1 ? '' : 's'}</div>
                </div>
              </button>
              {isActive && (
                <div className="mt-1.5 space-y-0.5 border-t border-ink-700 pt-1.5">
                  {surfaces.map((sf) => (
                    <button key={sf.id} type="button" onClick={() => s().setSurface(sf.id)}
                      className={clsx('flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px]', activeSurface === sf.id ? 'bg-ink-700 text-ink-100' : 'text-ink-300 hover:bg-ink-750')}>
                      <SurfaceThumb project={project} product={p} surfaceId={sf.id} width={28} height={20} />
                      <span className="truncate">{sf.label}</span>
                      <span className="ml-auto shrink-0 text-[9.5px] text-ink-500">{(p.surfaces[sf.id]?.elements.length ?? 0)} items</span>
                    </button>
                  ))}
                  <div className="flex justify-end gap-1 pt-1">
                    <Button onClick={() => s().duplicateProduct(p.id)}><Copy size={12} /> Duplicate</Button>
                    <Button variant="danger" onClick={() => { if (confirm(`Delete “${p.name}” and its artwork?`)) s().deleteProduct(p.id); }}><Trash size={12} /></Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!project.products.length && <Hint>No products yet — add one to start designing.</Hint>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Layers                                                                       */
/* -------------------------------------------------------------------------- */

const TYPE_LABEL: Record<Element['type'], string> = {
  text: 'T', image: 'Img', shape: '◼', rule: '—', path: '✎', svg: 'Svg', gradient: 'Grad', pattern: 'Ptn', drawing: 'Draw', logo: 'Logo', barcode: 'EAN',
};

function LayersTab() {
  const project = useStore((s) => s.project);
  const productId = useStore((s) => s.product);
  const surfaceId = useStore((s) => s.surface);
  const selection = useStore((s) => s.selection);
  const s = useStore.getState;
  const product = productOf(project, productId);
  if (!product) return <div className="p-3"><Hint>No product selected.</Hint></div>;
  const surface = surfaceOf(product, surfaceId);
  const art = product.surfaces[surfaceId];
  const els = art?.elements ?? [];
  const update = (id: string, patch: Partial<Element>) => s().updateElement(id, patch);
  const move = (id: string, dir: 1 | -1) => s().update((d) => {
    const p = d.products.find((x) => x.id === productId);
    const list = p?.surfaces[surfaceId]?.elements;
    if (!list) return;
    const i = list.findIndex((e) => e.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  });
  return (
    <div className="p-2">
      <div className="mb-2 flex items-center gap-1 overflow-x-auto">
        {dielineOf(product).surfaces.map((sf) => (
          <button key={sf.id} type="button" onClick={() => s().setSurface(sf.id)} className={clsx('h-6 shrink-0 rounded px-2 text-[10.5px]', sf.id === surfaceId ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:bg-ink-750')}>{sf.label}</button>
        ))}
      </div>
      {surface && (
        <div className="mb-2">
          <ColorField label="Printed ground" value={art?.background ?? null} allowNone onChange={(v) => s().update((d) => { const p = d.products.find((x) => x.id === productId); if (p?.surfaces[surfaceId]) p.surfaces[surfaceId].background = v; })} hint="None lets the substrate show" />
        </div>
      )}
      <div className="space-y-0.5">
        {[...els].reverse().map((el, ri) => {
          const i = els.length - 1 - ri;
          const sel = selection.includes(el.id);
          const panel = el.anchor ? surface?.panels.find((p) => p.id === el.anchor)?.label : null;
          return (
            <div key={el.id} className={clsx('group flex items-center gap-1 rounded px-1 py-0.5', sel ? 'bg-rubric/20' : 'hover:bg-ink-750')}>
              <span className="w-8 shrink-0 text-center font-mono text-[9px] text-ink-500">{TYPE_LABEL[el.type]}</span>
              <button type="button" className="min-w-0 flex-1 truncate text-left text-[11.5px] text-ink-200" onClick={(e) => s().select(e.shiftKey ? [...new Set([...selection, el.id])] : [el.id])} onDoubleClick={() => el.type === 'text' && s().setTextEditing(el.id)}>
                {el.name}{el.finish && el.finish !== 'none' ? <span className="ml-1 text-[9.5px] text-gold">· {el.finish}</span> : null}
                {panel ? <span className="ml-1 text-[9.5px] text-ink-500">· {panel}</span> : null}
              </button>
              <button type="button" title="Move up" className="hidden h-5 w-5 items-center justify-center text-ink-400 hover:text-ink-100 group-hover:inline-flex" disabled={i === els.length - 1} onClick={() => move(el.id, 1)}><ChevronUp size={12} /></button>
              <button type="button" title="Move down" className="hidden h-5 w-5 items-center justify-center text-ink-400 hover:text-ink-100 group-hover:inline-flex" disabled={i === 0} onClick={() => move(el.id, -1)}><ChevronDown size={12} /></button>
              <button type="button" title={el.locked ? 'Unlock' : 'Lock'} className="inline-flex h-5 w-5 items-center justify-center text-ink-400 hover:text-ink-100" onClick={() => update(el.id, { locked: !el.locked })}>{el.locked ? <Lock size={11} /> : <LockOpen size={11} className="opacity-40" />}</button>
              <button type="button" title={el.hidden ? 'Show' : 'Hide'} className="inline-flex h-5 w-5 items-center justify-center text-ink-400 hover:text-ink-100" onClick={() => update(el.id, { hidden: !el.hidden })}>{el.hidden ? <EyeOff size={11} /> : <Eye size={11} className="opacity-60" />}</button>
            </div>
          );
        })}
      </div>
      {!els.length && <Hint>This surface is empty. Draw with the tools on the left, drop images or SVGs onto the canvas, or place your logo from the Brand tab.</Hint>}
      {els.length > 0 && <Hint>Top of the list is in front. Locked items (like ground patterns) can't be picked on the canvas — unlock them here.</Hint>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Assets                                                                       */
/* -------------------------------------------------------------------------- */

function AssetsTab() {
  const assets = useStore((s) => s.project.assets);
  const logoId = useStore((s) => s.project.brand.logo.assetId);
  const products = useStore((s) => s.project.products);
  const s = useStore.getState;
  const ref = useRef<HTMLInputElement>(null);
  const list = Object.values(assets);
  const used = new Set<string>();
  for (const p of products) for (const a of Object.values(p.surfaces)) for (const el of a.elements) if ((el.type === 'image' || el.type === 'svg') && el.assetId) used.add(el.assetId);
  if (logoId) used.add(logoId);
  const place = (id: string) => {
    const a = assets[id];
    const key = activeSurfaceKey();
    if (!a || !key) return;
    const k = Math.min(1, 180 / a.width);
    const w = Math.max(20, a.width * k), h = Math.max(20, a.height * k);
    s().addElement(key, a.kind === 'svg' ? makeSvg({ name: a.name, assetId: a.id, x: 20, y: 20, w, h }) : makeImage({ name: a.name, assetId: a.id, x: 20, y: 20, w, h, fit: 'fill' }));
    s().setView('design');
  };
  return (
    <div className="p-2">
      <Button className="mb-2 w-full" onClick={() => ref.current?.click()}><Upload size={12} /> Upload images or SVG…</Button>
      <input ref={ref} type="file" multiple accept="image/*,.svg" className="hidden" onChange={async (e) => {
        const r = await importFiles(e.target.files ? [...e.target.files] : []);
        s().notify(r.errors[0] ?? `${r.assetIds.length} asset${r.assetIds.length === 1 ? '' : 's'} added.`, r.errors.length ? 'error' : 'info');
        e.target.value = '';
      }} />
      <div className="grid grid-cols-2 gap-1.5">
        {list.map((a) => (
          <div key={a.id} className="group relative overflow-hidden rounded-md border border-ink-700 bg-[#2f2e34]">
            <button type="button" title="Place on the current surface" className="block h-20 w-full" onClick={() => place(a.id)}>
              <img src={a.src} alt={a.name} className="h-full w-full object-contain p-1" />
            </button>
            <div className="flex items-center gap-1 border-t border-ink-700 px-1 py-0.5">
              <span className="min-w-0 flex-1 truncate text-[10px] text-ink-300">{a.id === logoId ? '★ ' : ''}{a.name}</span>
              <button type="button" title="Use as brand logo" className="text-ink-400 hover:text-ink-100" onClick={() => { s().update((d) => { d.brand.logo.assetId = a.id; }); s().notify('Brand logo set.'); }}><Stamp size={11} /></button>
              <button type="button" title={used.has(a.id) ? 'In use' : 'Delete'} disabled={used.has(a.id)} className="text-ink-400 hover:text-ink-100 disabled:opacity-30" onClick={() => s().update((d) => { delete d.assets[a.id]; })}><Trash size={11} /></button>
            </div>
          </div>
        ))}
      </div>
      {!list.length && <div className="mt-3 flex flex-col items-center gap-2 text-center text-ink-500"><ImageIcon size={22} /><Hint>Photos, illustrations and logos you upload or drop on the canvas appear here. They are saved inside the project file.</Hint></div>}
    </div>
  );
}
