import React from 'react';
import { Copy, Trash, Wand2 } from 'lucide-react';
import { useStore } from '../../store/store';
import { productOf } from '../../model/surfaces';
import { dielineOf, getTemplate, optionsOf } from '../../products';
import type { OptionSpec } from '../../products/types';
import type { OptionValue, Product, Unit } from '../../model/types';
import { Section, NumberField, Slider, Select, Toggle, ColorField, TextInput, Button, Hint, Row, Segmented } from '../controls';
import { BRAND_PRESETS } from '../../model/brands';
import { designProduct } from '../../engine/designer';
import { create } from 'zustand';

const GROUP_ORDER: OptionSpec['group'][] = ['Size', 'Construction', 'Material', 'Print', 'Contents', 'Closure'];

/** The starter look used when (re)designing a product. */
export const useDesignStyle = create<{ style: string; variant: number }>(() => ({ style: BRAND_PRESETS[0].id, variant: 0 }));

export function ProductPanel() {
  const project = useStore((s) => s.project);
  const productId = useStore((s) => s.product);
  const product = productOf(project, productId);
  if (!product) return <div className="p-4 text-[11.5px] text-ink-400">No product selected. Add one from the template gallery.</div>;
  return <ProductControls key={product.id} product={product} unit={project.unit} />;
}

function ProductControls({ product, unit }: { product: Product; unit: Unit }) {
  const s = useStore.getState;
  const t = getTemplate(product.template);
  const o = optionsOf(product);
  const dieline = dielineOf(product);
  const set = (key: string, v: OptionValue, history = true) => s().setOption(product.id, key, v, { history });
  const groups = GROUP_ORDER.map((g) => ({ g, items: t.options.filter((x) => x.group === g && (!x.when || x.when(o))) })).filter((x) => x.items.length);
  const style = useDesignStyle();
  return (
    <div>
      <Section title={t.name} id="prod-head" right={
        <div className="flex">
          <button type="button" title="Duplicate product" className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-300 hover:bg-ink-700" onClick={() => s().duplicateProduct(product.id)}><Copy size={13} /></button>
          <button type="button" title="Delete product" className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-300 hover:bg-ink-700" onClick={() => { if (confirm(`Delete “${product.name}” and its artwork?`)) s().deleteProduct(product.id); }}><Trash size={13} /></button>
        </div>
      }>
        <TextInput label="Product name" value={product.name} onChange={(v) => s().update((d) => { const p = d.products.find((x) => x.id === product.id); if (p) p.name = v; }, { history: false })} />
        <p className="text-[10.5px] leading-snug text-ink-400">{t.description}</p>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-md border border-ink-700 bg-ink-900 p-2 text-[10.5px]">
          {dieline.specs.map((sp) => (
            <React.Fragment key={sp.label}>
              <span className="text-ink-500">{sp.label}</span>
              <span className="text-right tabular-nums text-ink-200">{sp.value}</span>
            </React.Fragment>
          ))}
        </div>
      </Section>
      {groups.map(({ g, items }) => (
        <Section key={g} title={g === 'Size' ? 'Size & dieline' : g} id={`prod-${g}`}>
          {items.map((spec) => <OptionControl key={spec.key} spec={spec} value={o[spec.key]} unit={unit} onChange={(v, h) => set(spec.key, v, h)} />)}
        </Section>
      ))}
      <Section title="Printed grounds" id="prod-grounds">
        {dieline.surfaces.map((sf) => (
          <ColorField key={sf.id} label={sf.label} value={product.surfaces[sf.id]?.background ?? null} allowNone
            onChange={(v) => s().update((d) => { const p = d.products.find((x) => x.id === product.id); if (p && p.surfaces[sf.id]) p.surfaces[sf.id].background = v; })}
            hint="Colour printed under the artwork. None lets the substrate show (board, kraft, metal, fabric, glass)." />
        ))}
        {dieline.surfaces.some((sf) => sf.notes?.length) && (
          <div className="space-y-1">
            {dieline.surfaces.flatMap((sf) => (sf.notes ?? []).map((n, i) => <Hint key={`${sf.id}${i}`}>{n}</Hint>))}
          </div>
        )}
      </Section>
      <Section title="Starter design" id="prod-design" defaultOpen={false}>
        <p className="text-[10.5px] leading-snug text-ink-400">Lay this product out again from the brand kit: hero front, back panel copy and barcode, side wordmarks, logos on lids. Undo restores your artwork.</p>
        <Select label="Look" value={style.style} options={BRAND_PRESETS.map((b) => ({ value: b.id, label: `${b.label} look` }))} onChange={(v) => useDesignStyle.setState({ style: v })} />
        <Row>
          <Segmented value={String(style.variant % 4)} onChange={(v) => useDesignStyle.setState({ variant: Number(v) })} options={[0, 1, 2, 3].map((i) => ({ value: String(i), label: `Var ${i + 1}` }))} />
        </Row>
        <Button className="w-full" onClick={() => {
          const preset = BRAND_PRESETS.find((b) => b.id === style.style) ?? BRAND_PRESETS[0];
          const p = s().project.products.find((x) => x.id === product.id);
          if (!p) return;
          const art = designProduct(p, { kit: s().project.brand, copy: preset.copy, look: preset.look, variant: style.variant });
          s().update((d) => { const q = d.products.find((x) => x.id === product.id); if (q) q.surfaces = art; });
          s().select([]);
          s().notify('Starter design applied — ⌘Z to undo.');
        }}><Wand2 size={12} /> Redesign this product</Button>
      </Section>
    </div>
  );
}

function OptionControl({ spec, value, unit, onChange }: { spec: OptionSpec; value: OptionValue; unit: Unit; onChange: (v: OptionValue, history?: boolean) => void }) {
  const begin = () => useStore.getState().checkpoint();
  void unit;
  switch (spec.kind) {
    case 'length':
      return <NumberField label={spec.label} length value={Number(value)} min={spec.min} max={spec.max} hint={spec.hint} onScrubStart={begin} onChange={(v) => onChange(v)} />;
    case 'number':
      return <NumberField label={spec.label} value={Number(value)} min={spec.min} max={spec.max} step={spec.step} hint={spec.hint} onScrubStart={begin} onChange={(v) => onChange(v)} />;
    case 'slider':
      return <Slider label={spec.label} value={Number(value)} min={spec.min ?? 0} max={spec.max ?? 1} step={spec.step ?? 0.01} hint={spec.hint} format={spec.format} onStart={begin} onChange={(v) => onChange(v, false)} />;
    case 'select':
      return <Select label={spec.label} value={String(value)} options={spec.choices ?? []} hint={spec.hint} onChange={(v) => onChange(v)} />;
    case 'color':
      return <ColorField label={spec.label} value={String(value)} hint={spec.hint} allowNone={spec.key === 'edge'} onChange={(v) => onChange(v ?? '#00000000')} />;
    case 'toggle':
      return <Toggle label={spec.label} checked={!!value} hint={spec.hint} onChange={(v) => onChange(v)} />;
  }
}
