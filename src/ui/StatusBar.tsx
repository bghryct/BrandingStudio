import React from 'react';
import { useStore } from '../store/store';
import { useCursor } from './canvas/Editor';
import { useFontStore } from '../engine/fonts';
import { fromPt } from '../model/units';
import { productOf } from '../model/surfaces';
import { surfaceOf } from '../products';

export function StatusBar() {
  const zoom = useStore((s) => s.zoom);
  const unit = useStore((s) => s.project.unit);
  const product = useStore((s) => productOf(s.project, s.product));
  const surfaceId = useStore((s) => s.surface);
  const view = useStore((s) => s.view);
  const selection = useStore((s) => s.selection.length);
  const cursor = useCursor();
  const loading = useFontStore((s) => s.loading);
  const f = (v: number) => (+fromPt(v, unit).toFixed(unit === 'in' ? 3 : 1)).toString();
  const surface = product ? surfaceOf(product, surfaceId) : undefined;
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap border-t border-ink-700 bg-ink-900 px-3 text-[11px] tabular-nums text-ink-400">
      {view === 'design' && <button type="button" className="hover:text-ink-100" title="Fit (⌘0)" onClick={() => useStore.getState().requestFit()}>{Math.round(zoom * 100)}%</button>}
      {view === 'design' && <span className="hidden sm:inline">{cursor.surface ? `${cursor.surface} · ` : ''}x {f(cursor.x)} y {f(cursor.y)} {unit}</span>}
      {product && <span className="hidden md:inline text-ink-300">{product.name}</span>}
      {surface && <span className="hidden md:inline">{surface.label} · {f(surface.w)} × {f(surface.h)} {unit}{surface.bleed ? ` · bleed ${f(surface.bleed)}` : ''}</span>}
      {selection > 0 && <span>{selection} selected</span>}
      <span className="ml-auto flex items-center gap-2">
        {loading > 0 && <span className="text-gold">Loading fonts…</span>}
        <span className="hidden lg:inline text-ink-500">Space-drag to pan · ⌘-scroll to zoom · ⌘Z undo</span>
      </span>
    </footer>
  );
}
