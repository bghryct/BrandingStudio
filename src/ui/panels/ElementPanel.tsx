import React, { useRef } from 'react';
import type { Draft } from 'immer';
import {
  FlipHorizontal2, FlipVertical2, ArrowUpToLine, ArrowDownToLine, Copy, Trash, Upload, Lock, LockOpen, Plus, X, Dices,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
} from 'lucide-react';
import { useStore } from '../../store/store';
import { findElement, surfaceElementsDraft, productOf } from '../../model/surfaces';
import type {
  BlendMode, Element, Finish, TextElement, ImageElement, ShapeElement, RuleElement, PathElement, SvgElement, GradientElement,
  PatternElement, DrawingElement, LogoElement, BarcodeElement, Project, RuleKind, ShapeKind, GradientFill, PatternKind, LogoVariant,
} from '../../model/types';
import { Section, Row, NumberField, Slider, Select, Toggle, ColorField, TextInput, Button, IconButton, Hint, Segmented } from '../controls';
import { getFamilies } from '../../engine/fonts';
import { importFiles } from '../importFiles';
import { surfaceOf, panelOrigin } from '../../products';
import type { DielineSurface } from '../../products/types';
import { PATTERN_KINDS } from '../../engine/generators/patterns';
import { barcodeNumber } from '../../engine/generators/barcode';
import { parsePath, pathBounds, serialize, transformSegs } from '../../lib/pathData';
import { anchorOffsetOf } from '../../render/compile';

const BLENDS: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
export const FINISHES: { value: Finish; label: string }[] = [
  { value: 'none', label: 'Print (CMYK)' }, { value: 'gold-foil', label: 'Gold foil' }, { value: 'silver-foil', label: 'Silver foil' },
  { value: 'copper-foil', label: 'Copper foil' }, { value: 'holo-foil', label: 'Holographic foil' }, { value: 'emboss', label: 'Emboss (raised)' },
  { value: 'blind-deboss', label: 'Deboss (pressed)' }, { value: 'spot-gloss', label: 'Spot gloss UV' }, { value: 'white-base', label: 'White base (opaque on metal / clear)' },
];
const DASHES: { label: string; value: number[] }[] = [
  { label: 'Solid', value: [] }, { label: 'Dotted', value: [0.01, 3] }, { label: 'Dash 4·2', value: [4, 2] }, { label: 'Dash 8·4', value: [8, 4] },
  { label: 'Dash-dot', value: [8, 3, 1, 3] }, { label: 'Stitch 3·3', value: [3, 3] },
];

export function useEdit(id: string) {
  const s = useStore.getState;
  return {
    set: (p: Partial<Element> | ((d: Draft<Element>) => void)) => s().updateElement(id, p),
    live: (p: Partial<Element> | ((d: Draft<Element>) => void)) => s().updateElement(id, p, { history: false }),
    begin: () => s().checkpoint(),
  };
}

export function ElementPanel() {
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  const els = selection.map((id) => findElement(project, id)).filter(Boolean);
  if (!els.length) return <NothingSelected />;
  if (els.length > 1) return <MultiPanel ids={selection} />;
  const loc = els[0]!;
  const product = productOf(project, loc.productId);
  const surface = product ? surfaceOf(product, loc.surfaceId) : undefined;
  return <SinglePanel key={loc.el.id} el={loc.el} surface={surface} project={project} />;
}

function NothingSelected() {
  return (
    <div className="space-y-3 p-4 text-[11.5px] leading-relaxed text-ink-400">
      <p>Select an item on the dieline, or pick a tool on the left to draw one.</p>
      <p><span className="text-ink-200">Panels</span> — items drop onto the panel under them (front, side, lid, label…) and stay with it when the product's size changes.</p>
      <p><span className="text-ink-200">Brand logo</span> items follow the brand kit: change the name, typeface or colours in the Brand tab and every logo updates.</p>
      <p><span className="text-ink-200">Finishes</span> — foils, emboss, deboss, spot UV and white base show in the 3D mockup and separate onto named spot plates in the PDF.</p>
      <p>The <span className="text-ink-200">Product</span> tab sets dimensions, materials and print options.</p>
    </div>
  );
}

function MultiPanel({ ids }: { ids: string[] }) {
  const s = useStore.getState;
  const align = (mode: 'l' | 'c' | 'r' | 't' | 'm' | 'b') => {
    const p = s().project;
    const items = ids.map((id) => findElement(p, id)!).filter(Boolean);
    const pos = items.map((it) => {
      const prod = productOf(p, it.productId);
      const o = anchorOffsetOf(it.el, prod ? surfaceOf(prod, it.surfaceId) ?? null : null);
      return { it, ox: o.x, oy: o.y };
    });
    const minX = Math.min(...pos.map((q) => q.it.el.x + q.ox)), maxX = Math.max(...pos.map((q) => q.it.el.x + q.ox + q.it.el.w));
    const minY = Math.min(...pos.map((q) => q.it.el.y + q.oy)), maxY = Math.max(...pos.map((q) => q.it.el.y + q.oy + q.it.el.h));
    s().update((d) => {
      for (const { it, ox, oy } of pos) {
        const el = surfaceElementsDraft(d as Project, it.key)![it.index];
        if (mode === 'l') el.x = minX - ox; if (mode === 'r') el.x = maxX - el.w - ox; if (mode === 'c') el.x = (minX + maxX) / 2 - el.w / 2 - ox;
        if (mode === 't') el.y = minY - oy; if (mode === 'b') el.y = maxY - el.h - oy; if (mode === 'm') el.y = (minY + maxY) / 2 - el.h / 2 - oy;
      }
    });
  };
  return (
    <Section title={`${ids.length} items`}>
      <AlignButtons onAlign={align} />
      <Row>
        <Button onClick={() => s().duplicateSelection()}><Copy size={12} /> Duplicate</Button>
        <Button variant="danger" onClick={() => s().deleteSelection()}><Trash size={12} /> Delete</Button>
      </Row>
    </Section>
  );
}

function AlignButtons({ onAlign }: { onAlign: (m: 'l' | 'c' | 'r' | 't' | 'm' | 'b') => void }) {
  return (
    <div className="flex justify-between">
      <IconButton title="Align left" onClick={() => onAlign('l')}><AlignStartVertical size={14} /></IconButton>
      <IconButton title="Align centre" onClick={() => onAlign('c')}><AlignCenterVertical size={14} /></IconButton>
      <IconButton title="Align right" onClick={() => onAlign('r')}><AlignEndVertical size={14} /></IconButton>
      <IconButton title="Align top" onClick={() => onAlign('t')}><AlignStartHorizontal size={14} /></IconButton>
      <IconButton title="Align middle" onClick={() => onAlign('m')}><AlignCenterHorizontal size={14} /></IconButton>
      <IconButton title="Align bottom" onClick={() => onAlign('b')}><AlignEndHorizontal size={14} /></IconButton>
    </div>
  );
}

const TITLES: Record<Element['type'], string> = {
  text: 'Text', image: 'Image', shape: 'Shape', rule: 'Line', path: 'Path', svg: 'Graphic', gradient: 'Mesh gradient',
  pattern: 'Pattern', drawing: 'Drawing', logo: 'Brand logo', barcode: 'Barcode',
};

function SinglePanel({ el, surface, project }: { el: Element; surface: DielineSurface | undefined; project: Project }) {
  const { set, live, begin } = useEdit(el.id);
  const s = useStore.getState;
  const panel = surface?.panels.find((p) => p.id === el.anchor) ?? null;
  // Alignment box: the anchored panel (in its own coordinates), else the whole surface.
  const box = (safe: boolean) => {
    if (panel) { const i = safe ? panel.safe : 0; return { x: i, y: i, w: panel.w - 2 * i, h: panel.h - 2 * i }; }
    const W = surface?.w ?? el.w, H = surface?.h ?? el.h;
    const i = safe ? surface?.panels[0]?.safe ?? 0 : 0;
    return { x: i, y: i, w: W - 2 * i, h: H - 2 * i };
  };
  const alignTo = (mode: 'l' | 'c' | 'r' | 't' | 'm' | 'b') => {
    const b = box(false);
    set((d) => {
      if (mode === 'l') d.x = b.x; if (mode === 'r') d.x = b.x + b.w - d.w; if (mode === 'c') d.x = b.x + b.w / 2 - d.w / 2;
      if (mode === 't') d.y = b.y; if (mode === 'b') d.y = b.y + b.h - d.h; if (mode === 'm') d.y = b.y + b.h / 2 - d.h / 2;
    });
  };
  const fill = (target: 'panel' | 'surface' | 'safe') => {
    if (!surface) return;
    if (target === 'surface') {
      const po = panelOrigin(surface, el.anchor);
      const bl = surface.bleed;
      set({ x: -bl - po.x, y: -bl - po.y, w: surface.w + 2 * bl, h: surface.h + 2 * bl, rotation: 0 });
    } else {
      const b = box(target === 'safe');
      set({ x: b.x, y: b.y, w: b.w, h: b.h, rotation: 0 });
    }
  };
  const reanchor = (id: string) => {
    if (!surface) return;
    const from = panelOrigin(surface, el.anchor), to = panelOrigin(surface, id || null);
    set({ anchor: id || null, x: el.x + from.x - to.x, y: el.y + from.y - to.y });
  };

  return (
    <div>
      <Section title={TITLES[el.type]} id="el-geometry" right={
        <div className="flex">
          <IconButton title={el.locked ? 'Unlock' : 'Lock'} onClick={() => set({ locked: !el.locked })}>{el.locked ? <Lock size={13} /> : <LockOpen size={13} />}</IconButton>
          <IconButton title="Duplicate (⌘D)" onClick={() => s().duplicateSelection()}><Copy size={13} /></IconButton>
          <IconButton title="Delete" onClick={() => s().deleteSelection()}><Trash size={13} /></IconButton>
        </div>
      }>
        <TextInput label="Name" value={el.name} onChange={(v) => live({ name: v })} />
        {surface && surface.panels.length > 1 && (
          <Select label="Anchored to panel" value={el.anchor ?? ''} options={[{ value: '', label: `Whole ${surface.label.toLowerCase()}` }, ...surface.panels.map((p) => ({ value: p.id, label: p.label }))]} onChange={reanchor}
            hint="Anchored items keep their place on the panel when the product's dimensions change" />
        )}
        <Row>
          <NumberField label={panel ? 'X (panel)' : 'X'} length value={el.x} onChange={(v) => set({ x: v })} onScrubStart={begin} />
          <NumberField label={panel ? 'Y (panel)' : 'Y'} length value={el.y} onChange={(v) => set({ y: v })} onScrubStart={begin} />
          <NumberField label="W" length value={el.w} min={0.5} onChange={(v) => set({ w: v })} onScrubStart={begin} />
          <NumberField label="H" length value={el.h} min={0.5} onChange={(v) => set({ h: v })} onScrubStart={begin} />
        </Row>
        <Row>
          <NumberField label="Rotation" unit="°" value={el.rotation} decimals={1} onChange={(v) => set({ rotation: v })} onScrubStart={begin} />
          <div className="flex items-end gap-1">
            <IconButton title="Flip horizontal" active={!!el.flipX} onClick={() => set({ flipX: !el.flipX })}><FlipHorizontal2 size={14} /></IconButton>
            <IconButton title="Flip vertical" active={!!el.flipY} onClick={() => set({ flipY: !el.flipY })}><FlipVertical2 size={14} /></IconButton>
            <IconButton title="Bring to front (⇧⌘])" onClick={() => s().arrange('front')}><ArrowUpToLine size={14} /></IconButton>
            <IconButton title="Send to back (⇧⌘[)" onClick={() => s().arrange('back')}><ArrowDownToLine size={14} /></IconButton>
          </div>
        </Row>
        <div>
          <span className="mb-1 block text-[10.5px] text-ink-400">Align to {panel ? panel.label.toLowerCase() : 'surface'}</span>
          <AlignButtons onAlign={alignTo} />
        </div>
        <div className="grid grid-cols-3 gap-1">
          <Button title="Cover the whole surface to the bleed" onClick={() => fill('surface')}>Fill surface</Button>
          <Button disabled={!panel} title="Cover the anchored panel" onClick={() => fill('panel')}>Fill panel</Button>
          <Button title="Fit inside the safe area" onClick={() => fill('safe')}>Fit safe</Button>
        </div>
      </Section>
      <Section title="Appearance" id="el-appearance">
        <Slider label="Opacity" value={el.opacity} min={0} max={1} onStart={begin} onChange={(v) => live({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <Select<BlendMode> label="Blend mode" value={el.blend} options={BLENDS.map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) }))} onChange={(v) => set({ blend: v })} hint="Multiply / screen simulate overprinting inks" />
        <Select<Finish> label="Finish" value={el.finish ?? 'none'} options={FINISHES} onChange={(v) => set({ finish: v })} hint="Foils, emboss, deboss, spot UV and white base render in 3D and are separated as named spots in the PDF" />
      </Section>
      <TypeSpecific el={el} project={project} />
    </div>
  );
}

function familyOptions() {
  return getFamilies().map((f) => ({ value: f.id, label: f.name, group: f.builtin ? f.category : 'Uploaded' }));
}

function GradientEditor({ g, w, h, onChange }: { g: GradientFill | null | undefined; w: number; h: number; onChange: (g: GradientFill | null) => void }) {
  const palette = useStore((s) => s.project.brand.palette);
  const on = !!g;
  const def: GradientFill = { kind: 'linear', angle: 90, stops: [{ offset: 0, color: palette[0]?.hex ?? '#ff5a36' }, { offset: 1, color: palette[1]?.hex ?? '#f5b700' }] };
  return (
    <div className="space-y-1.5 rounded-md border border-ink-700 p-2">
      <Toggle label="Gradient fill" checked={on} onChange={(v) => onChange(v ? def : null)} />
      {g && (
        <>
          <Segmented value={g.kind} onChange={(v) => onChange({ ...g, kind: v })} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }]} />
          {g.kind === 'linear' && <Slider label="Angle" value={g.angle} min={-180} max={180} step={1} onChange={(v) => onChange({ ...g, angle: v })} format={(v) => `${Math.round(v)}°`} />}
          <div className="h-3 rounded" style={{ background: `linear-gradient(90deg, ${[...g.stops].sort((a, b) => a.offset - b.offset).map((s) => `${s.color} ${s.offset * 100}%`).join(', ')})` }} title={`${Math.round(w)} × ${Math.round(h)} pt`} />
          {g.stops.map((st, i) => (
            <div key={i} className="flex items-end gap-1.5">
              <div className="w-24 shrink-0"><ColorField value={st.color} onChange={(v) => v && onChange({ ...g, stops: g.stops.map((x, j) => (j === i ? { ...x, color: v } : x)) })} /></div>
              <div className="min-w-0 flex-1"><Slider label={`Stop ${i + 1}`} value={st.offset} min={0} max={1} onChange={(v) => onChange({ ...g, stops: g.stops.map((x, j) => (j === i ? { ...x, offset: v } : x)) })} format={(v) => `${Math.round(v * 100)}%`} /></div>
              {g.stops.length > 2 && <IconButton title="Remove stop" onClick={() => onChange({ ...g, stops: g.stops.filter((_, j) => j !== i) })}><X size={12} /></IconButton>}
            </div>
          ))}
          <Button className="w-full" onClick={() => onChange({ ...g, stops: [...g.stops, { offset: 0.5, color: palette[2]?.hex ?? '#ffffff' }] })}><Plus size={12} /> Add stop</Button>
        </>
      )}
    </div>
  );
}

function StrokeControls<T extends ShapeElement | PathElement>({ el, set, live, begin }: { el: T; set: (p: Partial<Element>) => void; live: (p: Partial<Element>) => void; begin: () => void }) {
  return (
    <>
      <Row>
        <ColorField label="Fill" value={el.fill} allowNone onChange={(v) => set({ fill: v } as Partial<Element>)} />
        <ColorField label="Stroke" value={el.stroke} allowNone onChange={(v) => set({ stroke: v } as Partial<Element>)} />
      </Row>
      <GradientEditor g={el.gradient} w={el.w} h={el.h} onChange={(g) => set({ gradient: g } as Partial<Element>)} />
      <Row>
        <NumberField label="Stroke weight" unit="pt" value={el.strokeWidth} min={0} step={0.25} onChange={(v) => set({ strokeWidth: v } as Partial<Element>)} onScrubStart={begin} />
        <Select label="Dash" value={JSON.stringify(el.dash)} options={[...DASHES.map((d) => ({ value: JSON.stringify(d.value), label: d.label })), ...(DASHES.some((d) => JSON.stringify(d.value) === JSON.stringify(el.dash)) ? [] : [{ value: JSON.stringify(el.dash), label: 'Custom' }])]} onChange={(v) => set({ dash: JSON.parse(v) } as Partial<Element>)} />
      </Row>
      <Row>
        <Select label="Cap" value={el.cap} options={[{ value: 'butt', label: 'Butt' }, { value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }]} onChange={(v) => set({ cap: v } as Partial<Element>)} />
        <Select label="Join" value={el.join} options={[{ value: 'miter', label: 'Miter' }, { value: 'round', label: 'Round' }, { value: 'bevel', label: 'Bevel' }]} onChange={(v) => set({ join: v } as Partial<Element>)} />
      </Row>
      <TextInput label="Custom dash (pt, space separated)" value={el.dash.join(' ')} onChange={(v) => live({ dash: v.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0) } as Partial<Element>)} />
    </>
  );
}

function TypeSpecific({ el, project }: { el: Element; project: Project }) {
  const { set, live, begin } = useEdit(el.id);
  const s = useStore.getState;
  const fileRef = useRef<HTMLInputElement>(null);
  const reseed = () => set({ seed: Math.floor(Math.random() * 100000) } as Partial<Element>);

  switch (el.type) {
    case 'text': {
      const e = el as TextElement;
      return (
        <Section title="Frame" id="el-text">
          <Button className="w-full" onClick={() => s().setTextEditing(e.id)}>Edit text…</Button>
          <Toggle label="Shrink type to fit" checked={!!e.autoFit} onChange={(v) => set({ autoFit: v } as Partial<Element>)} hint="The type shrinks until the text fits the frame" />
          <Row>
            <NumberField label="Columns" value={e.columns} min={1} max={6} decimals={0} onChange={(v) => set({ columns: Math.round(v) } as Partial<Element>)} />
            <NumberField label="Gutter" length value={e.columnGap} min={0} onChange={(v) => set({ columnGap: v } as Partial<Element>)} />
            <NumberField label="Inset" length value={e.inset} min={0} onChange={(v) => set({ inset: v } as Partial<Element>)} />
            <Select label="Vertical align" value={e.verticalAlign} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} onChange={(v) => set({ verticalAlign: v } as Partial<Element>)} />
          </Row>
          <ColorField label="Frame fill" value={e.fill} allowNone onChange={(v) => set({ fill: v } as Partial<Element>)} />
          <Hint>Typeface, size, colour and OpenType features are in the Type tab. Use {'{brand}'}, {'{tagline}'} and {'{product}'} to pull text from the brand kit.</Hint>
        </Section>
      );
    }
    case 'image': {
      const e = el as ImageElement;
      return (
        <Section title="Image" id="el-image">
          <Button className="w-full" onClick={() => fileRef.current?.click()}><Upload size={12} /> {e.assetId ? 'Replace image…' : 'Choose image…'}</Button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (ev) => {
            const r = await importFiles(ev.target.files ? [...ev.target.files] : [], { replaceImageId: e.id });
            if (r.errors.length) s().notify(r.errors[0], 'error');
            ev.target.value = '';
          }} />
          <Segmented value={e.fit} options={[{ value: 'cover', label: 'Fill frame' }, { value: 'contain', label: 'Fit' }, { value: 'fill', label: 'Stretch' }]} onChange={(v) => set({ fit: v } as Partial<Element>)} />
          <Slider label="Zoom" value={e.zoom} min={0.2} max={4} onStart={begin} onChange={(v) => live({ zoom: v } as Partial<Element>)} />
          <Slider label="Offset X" value={e.offsetX} min={-1} max={1} onStart={begin} onChange={(v) => live({ offsetX: v } as Partial<Element>)} />
          <Slider label="Offset Y" value={e.offsetY} min={-1} max={1} onStart={begin} onChange={(v) => live({ offsetY: v } as Partial<Element>)} />
          <Toggle label="Greyscale" checked={e.grayscale} onChange={(v) => set({ grayscale: v } as Partial<Element>)} />
          <Toggle label="Duotone" checked={!!e.duotone} onChange={(v) => set({ duotone: v ? [project.brand.palette[0]?.hex ?? '#1b2a4a', project.brand.palette[1]?.hex ?? '#f2c94c'] : null } as Partial<Element>)} />
          {e.duotone && (
            <Row>
              <ColorField label="Shadows" value={e.duotone[0]} onChange={(v) => v && set({ duotone: [v, e.duotone![1]] } as Partial<Element>)} />
              <ColorField label="Highlights" value={e.duotone[1]} onChange={(v) => v && set({ duotone: [e.duotone![0], v] } as Partial<Element>)} />
            </Row>
          )}
        </Section>
      );
    }
    case 'shape': {
      const e = el as ShapeElement;
      return (
        <Section title="Shape" id="el-shape">
          <Select<ShapeKind> label="Kind" value={e.shape} options={[{ value: 'rect', label: 'Rectangle' }, { value: 'pill', label: 'Pill' }, { value: 'ellipse', label: 'Ellipse' }, { value: 'arch', label: 'Arch' }, { value: 'polygon', label: 'Polygon' }, { value: 'star', label: 'Star' }, { value: 'burst', label: 'Starburst (seal)' }, { value: 'triangle', label: 'Triangle' }, { value: 'arc', label: 'Arc' }]} onChange={(v) => set({ shape: v, ...(v === 'burst' ? { sides: 24, innerRatio: 0.86 } : {}) } as Partial<Element>)} />
          {e.shape === 'rect' && <NumberField label="Corner radius" length value={e.radius} min={0} onChange={(v) => set({ radius: v } as Partial<Element>)} />}
          {(e.shape === 'polygon' || e.shape === 'star' || e.shape === 'burst') && <NumberField label="Sides / points" value={e.sides} min={3} max={64} decimals={0} onChange={(v) => set({ sides: Math.round(v) } as Partial<Element>)} />}
          {(e.shape === 'star' || e.shape === 'arc' || e.shape === 'burst') && <Slider label={e.shape === 'arc' ? 'Sweep' : 'Inner radius'} value={e.innerRatio} min={0.05} max={1} onStart={begin} onChange={(v) => live({ innerRatio: v } as Partial<Element>)} />}
          <StrokeControls el={e} set={set} live={live} begin={begin} />
        </Section>
      );
    }
    case 'rule': {
      const e = el as RuleElement;
      return (
        <Section title="Line" id="el-rule">
          <Select<RuleKind> label="Style" value={e.kind} options={[{ value: 'single', label: 'Single' }, { value: 'double', label: 'Double' }, { value: 'scotch', label: 'Scotch (thick-thin)' }, { value: 'dotted', label: 'Dotted' }, { value: 'wave', label: 'Wave' }, { value: 'zigzag', label: 'Zigzag' }, { value: 'greek-key', label: 'Greek key' }, { value: 'chain', label: 'Chain' }]} onChange={(v) => set({ kind: v } as Partial<Element>)} />
          <Row>
            <ColorField label="Colour" value={e.stroke} onChange={(v) => v && set({ stroke: v } as Partial<Element>)} />
            <NumberField label="Weight" unit="pt" value={e.strokeWidth} min={0.1} step={0.25} onChange={(v) => set({ strokeWidth: v } as Partial<Element>)} onScrubStart={begin} />
          </Row>
          <Select label="Dash" value={JSON.stringify(e.dash)} options={DASHES.map((d) => ({ value: JSON.stringify(d.value), label: d.label }))} onChange={(v) => set({ dash: JSON.parse(v) } as Partial<Element>)} />
        </Section>
      );
    }
    case 'path': {
      const e = el as PathElement;
      return (
        <Section title="Path" id="el-path">
          <StrokeControls el={e} set={set} live={live} begin={begin} />
          <Select label="Fill rule" value={e.fillRule} options={[{ value: 'nonzero', label: 'Non-zero' }, { value: 'evenodd', label: 'Even-odd (holes)' }]} onChange={(v) => set({ fillRule: v } as Partial<Element>)} />
          <Button className="w-full" onClick={() => {
            const segs = transformSegs(parsePath(e.d), [e.w / e.vw, 0, 0, e.h / e.vh, 0, 0]);
            const b = pathBounds(segs);
            set({ d: serialize(transformSegs(segs, [1, 0, 0, 1, -b.x, -b.y])), vw: Math.max(1, b.w), vh: Math.max(1, b.h), w: Math.max(1, b.w), h: Math.max(1, b.h), x: e.x + b.x, y: e.y + b.y } as Partial<Element>);
          }}>Fit frame to path</Button>
          <Hint>Edit anchors and handles with the direct-selection tool (A) or double-click the path.</Hint>
        </Section>
      );
    }
    case 'svg': {
      const e = el as SvgElement;
      return (
        <Section title="Graphic" id="el-svg">
          <Button className="w-full" onClick={() => fileRef.current?.click()}><Upload size={12} /> Replace SVG…</Button>
          <input ref={fileRef} type="file" accept=".svg,image/svg+xml" className="hidden" onChange={async (ev) => {
            const r = await importFiles(ev.target.files ? [...ev.target.files] : [], { replaceImageId: e.id });
            if (r.errors.length) s().notify(r.errors[0], 'error');
            ev.target.value = '';
          }} />
          <Row>
            <ColorField label="Recolour fills" value={e.fillOverride} allowNone onChange={(v) => set({ fillOverride: v } as Partial<Element>)} />
            <ColorField label="Recolour strokes" value={e.strokeOverride} allowNone onChange={(v) => set({ strokeOverride: v } as Partial<Element>)} />
          </Row>
          <Button className="w-full" onClick={() => { if (e.assetId) { s().update((d) => { d.brand.logo.assetId = e.assetId; }); s().notify('This graphic is now the brand logo.'); } }}>Use as brand logo</Button>
        </Section>
      );
    }
    case 'gradient': {
      const e = el as GradientElement;
      return (
        <Section title="Mesh gradient" id="el-gradient">
          <ColorField label="Base" value={e.base} onChange={(v) => v && set({ base: v } as Partial<Element>)} />
          {e.points.map((p, i) => (
            <div key={i} className="rounded-md border border-ink-700 p-2">
              <Row>
                <ColorField label={`Light ${i + 1}`} value={p.color} onChange={(v) => v && set((d) => { (d as Draft<GradientElement>).points[i].color = v; })} />
                <div className="flex items-end justify-end">{e.points.length > 1 && <IconButton title="Remove" onClick={() => set((d) => { (d as Draft<GradientElement>).points.splice(i, 1); })}><X size={12} /></IconButton>}</div>
              </Row>
              <Slider label="Radius" value={p.radius} min={0.05} max={1.5} onStart={begin} onChange={(v) => live((d) => { (d as Draft<GradientElement>).points[i].radius = v; })} />
              <Row>
                <Slider label="X" value={p.x} min={0} max={1} onStart={begin} onChange={(v) => live((d) => { (d as Draft<GradientElement>).points[i].x = v; })} />
                <Slider label="Y" value={p.y} min={0} max={1} onStart={begin} onChange={(v) => live((d) => { (d as Draft<GradientElement>).points[i].y = v; })} />
              </Row>
            </div>
          ))}
          {e.points.length < 6 && <Button className="w-full" onClick={() => set((d) => { (d as Draft<GradientElement>).points.push({ x: Math.random(), y: Math.random(), color: project.brand.palette[e.points.length % project.brand.palette.length]?.hex ?? '#ffffff', radius: 0.5 }); })}><Plus size={12} /> Add a light</Button>}
          <Slider label="Softness" value={e.softness} min={0} max={1} onStart={begin} onChange={(v) => live({ softness: v } as Partial<Element>)} />
          <Slider label="Grain" value={e.grain} min={0} max={1} onStart={begin} onChange={(v) => live({ grain: v } as Partial<Element>)} />
          <Toggle label="Glow" checked={e.glow} onChange={(v) => set({ glow: v } as Partial<Element>)} />
        </Section>
      );
    }
    case 'pattern': {
      const e = el as PatternElement;
      return (
        <Section title="Pattern" id="el-pattern">
          <Select<PatternKind> label="Pattern" value={e.kind} options={PATTERN_KINDS} onChange={(v) => set({ kind: v } as Partial<Element>)} />
          <Row>
            <ColorField label="Ink" value={e.color} onChange={(v) => v && set({ color: v } as Partial<Element>)} />
            <ColorField label="Second ink" value={e.color2} onChange={(v) => v && set({ color2: v } as Partial<Element>)} />
          </Row>
          <ColorField label="Ground" value={e.background} allowNone onChange={(v) => set({ background: v } as Partial<Element>)} />
          <NumberField label="Repeat size" length value={e.scale} min={2} onChange={(v) => set({ scale: v } as Partial<Element>)} onScrubStart={begin} />
          <Slider label="Mark size" value={e.density} min={0.05} max={1} onStart={begin} onChange={(v) => live({ density: v } as Partial<Element>)} />
          <Slider label="Angle" value={e.angle} min={-90} max={90} step={1} onStart={begin} onChange={(v) => live({ angle: v } as Partial<Element>)} format={(v) => `${Math.round(v)}°`} />
          {e.kind === 'type-repeat' && (
            <>
              <TextInput label="Word" value={e.text} onChange={(v) => live({ text: v } as Partial<Element>)} />
              <Select label="Typeface" value={e.fontFamily} options={familyOptions()} onChange={(v) => set({ fontFamily: v } as Partial<Element>)} />
            </>
          )}
          {(e.kind === 'terrazzo' || e.kind === 'confetti') && <Button className="w-full" onClick={reseed}><Dices size={12} /> Shuffle</Button>}
        </Section>
      );
    }
    case 'drawing': {
      const e = el as DrawingElement;
      return (
        <Section title="Drawing" id="el-drawing">
          <p className="text-[11px] text-ink-300">{e.strokes.length} stroke{e.strokes.length === 1 ? '' : 's'}</p>
          <Slider label="Paper tooth" value={e.paperGrain} min={0} max={1} onStart={begin} onChange={(v) => live({ paperGrain: v } as Partial<Element>)} />
          <Row>
            <Button disabled={!e.strokes.length} onClick={() => set((d) => { (d as Draft<DrawingElement>).strokes.pop(); })}>Undo stroke</Button>
            <Button variant="danger" disabled={!e.strokes.length} onClick={() => set({ strokes: [] } as Partial<Element>)}>Clear</Button>
          </Row>
          <Hint>Choose the B brush tool and paint; strokes inside a selected drawing add to it.</Hint>
        </Section>
      );
    }
    case 'logo': {
      const e = el as LogoElement;
      return (
        <Section title="Brand logo" id="el-logo">
          <Select<LogoVariant> label="Arrangement" value={e.variant} options={[{ value: 'lockup', label: 'Lockup (mark + name)' }, { value: 'stacked', label: 'Stacked' }, { value: 'wordmark', label: 'Wordmark' }, { value: 'mark', label: 'Mark only' }, { value: 'monogram', label: 'Monogram' }, { value: 'badge', label: 'Badge / seal' }]} onChange={(v) => set({ variant: v } as Partial<Element>)} />
          <Row>
            <ColorField label="Colour" value={e.color} allowNone onChange={(v) => set({ color: v } as Partial<Element>)} hint="None = brand primary" />
            <ColorField label="Accent" value={e.color2} allowNone onChange={(v) => set({ color2: v } as Partial<Element>)} hint="None = brand accent" />
          </Row>
          <TextInput label="Name override" value={e.text ?? ''} placeholder={project.brand.name} onChange={(v) => live({ text: v || null } as Partial<Element>)} />
          <Button className="w-full" onClick={() => { s().setLeftTab('brand'); s().setLeftOpen(true); }}>Edit the logo in the brand kit</Button>
          {project.brand.logo.assetId && <Hint>An uploaded logo is set in the brand kit; it replaces the generated mark and lockup.</Hint>}
        </Section>
      );
    }
    case 'barcode': {
      const e = el as BarcodeElement;
      const full = barcodeNumber(e);
      return (
        <Section title="Barcode" id="el-barcode">
          <Segmented value={e.symbology} onChange={(v) => set({ symbology: v } as Partial<Element>)} options={[{ value: 'ean13', label: 'EAN-13' }, { value: 'upca', label: 'UPC-A' }]} />
          <TextInput label={e.symbology === 'upca' ? 'Number (11 digits)' : 'Number (12 digits)'} value={e.code} onChange={(v) => live({ code: v.replace(/\D/g, '').slice(0, e.symbology === 'upca' ? 11 : 12) } as Partial<Element>)} mono />
          <p className="font-mono text-[11px] text-ink-300">Check digit {full[full.length - 1]} · {full}</p>
          <Row>
            <ColorField label="Bars" value={e.color} onChange={(v) => v && set({ color: v } as Partial<Element>)} />
            <ColorField label="Quiet zone" value={e.background} allowNone onChange={(v) => set({ background: v } as Partial<Element>)} />
          </Row>
          <Toggle label="Human-readable digits" checked={e.showText} onChange={(v) => set({ showText: v } as Partial<Element>)} />
          <Hint>Nominal EAN-13 size is 37.29 × 25.93 mm (80–200% allowed). Print dark bars on a light ground and keep the quiet zones clear.</Hint>
        </Section>
      );
    }
  }
}
