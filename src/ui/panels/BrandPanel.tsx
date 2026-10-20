import React, { useMemo, useRef } from 'react';
import clsx from 'clsx';
import { Plus, Trash, Upload, X, Wand2, Stamp } from 'lucide-react';
import { useStore, activeSurfaceKey } from '../../store/store';
import type { BrandKit, ColorRole, LogoElement, LogoMark, LogoVariant, Swatch } from '../../model/types';
import { Section, Row, NumberField, Slider, Select, Toggle, ColorField, TextInput, Button, Hint } from '../controls';
import { LOGO_MARKS } from '../../engine/generators/logo';
import { compileElementLocal } from '../../render/compile';
import { primsToSvg } from '../../render/svgString';
import { makeLogo } from '../../model/factory';
import { getFamilies, getFamily, useFontStore, cssFamily, ensureFamily } from '../../engine/fonts';
import { importFiles } from '../importFiles';
import { applyKit, setKitFont, setPaletteColor } from '../../model/brandOps';
import { nearestSpot } from '../../lib/spots';
import { cmykToHex, rgbToCmyk } from '../../lib/color';
import { uid } from '../../lib/random';
import { BRAND_PRESETS } from '../../model/brands';
import { createStarterProject } from '../../model/defaults';
import { designProduct } from '../../engine/designer';
import { useDesignStyle } from './ProductPanel';

const ROLES: { value: ColorRole; label: string }[] = [
  { value: 'primary', label: 'Primary' }, { value: 'secondary', label: 'Secondary' }, { value: 'accent', label: 'Accent' }, { value: 'neutral', label: 'Neutral / ink' }, { value: 'background', label: 'Background' },
];

function LogoPreview({ variant, kit, dark }: { variant: LogoVariant; kit: BrandKit; dark?: boolean }) {
  const project = useStore((s) => s.project);
  const version = useFontStore((s) => s.version);
  const w = variant === 'lockup' || variant === 'wordmark' ? 150 : 70, h = variant === 'lockup' || variant === 'wordmark' ? 40 : 70;
  const html = useMemo(() => {
    const el: LogoElement = makeLogo({ variant, w, h, color: dark ? '#ffffff' : null });
    const prims = compileElementLocal(el, { project: { ...project, brand: kit }, product: null, surface: null });
    return primsToSvg(prims, { pxPerPt: 2, idPrefix: `lp${variant}${dark ? 'd' : ''}` });
  }, [variant, kit, project, dark, w, h, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={clsx('flex items-center justify-center rounded-md border border-ink-700 p-2', dark ? 'bg-ink-950' : 'bg-[#f4f1ec]')} title={variant}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full max-h-[64px] w-full"><g dangerouslySetInnerHTML={{ __html: html }} /></svg>
    </div>
  );
}

export function BrandPanel() {
  const kit = useStore((s) => s.project.brand);
  const assets = useStore((s) => s.project.assets);
  const s = useStore.getState;
  const logoRef = useRef<HTMLInputElement>(null);
  const setKit = (fn: (k: BrandKit) => void, history = true) => s().update((d) => { fn(d.brand as BrandKit); }, { history });
  const families = getFamilies().filter((f) => !f.system);
  const placeLogo = (variant: LogoVariant) => {
    const key = activeSurfaceKey();
    if (!key || key === '/') return;
    const el = makeLogo({ variant, x: 20, y: 20, w: variant === 'lockup' || variant === 'wordmark' ? 160 : 90, h: variant === 'lockup' || variant === 'wordmark' ? 50 : 90 });
    s().addElement(key, el);
    s().setView('design');
  };
  const logoAsset = kit.logo.assetId ? assets[kit.logo.assetId] : null;
  return (
    <div>
      <Section title="Identity" id="brand-id">
        <TextInput label="Brand name" value={kit.name} onChange={(v) => setKit((k) => { k.name = v; }, false)} />
        <TextInput label="Tagline" value={kit.tagline} onChange={(v) => setKit((k) => { k.tagline = v; }, false)} />
        <Hint>Logos follow the name; text frames can use {'{brand}'} and {'{tagline}'}.</Hint>
      </Section>

      <Section title="Logo" id="brand-logo">
        <div className="grid grid-cols-2 gap-1.5">
          {(['lockup', 'stacked', 'mark', 'badge'] as LogoVariant[]).map((v) => (
            <button key={v} type="button" className="h-[72px] text-left" title={`Place the ${v} on the current surface`} onClick={() => placeLogo(v)}>
              <LogoPreview variant={v} kit={kit} dark={v === 'badge'} />
            </button>
          ))}
        </div>
        <Hint>Click a version to place it on the surface you're designing.</Hint>
        {logoAsset ? (
          <div className="flex items-center gap-2 rounded-md border border-ink-700 p-1.5">
            <img src={logoAsset.src} alt="" className="h-9 w-14 rounded bg-white object-contain" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-300">{logoAsset.name}</span>
            <Button onClick={() => setKit((k) => { k.logo.assetId = null; })}><X size={12} /> Remove</Button>
          </div>
        ) : (
          <Button className="w-full" onClick={() => logoRef.current?.click()}><Upload size={12} /> Upload your logo (SVG or PNG)…</Button>
        )}
        <input ref={logoRef} type="file" accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
          const r = await importFiles(e.target.files ? [...e.target.files].slice(0, 1) : [], { asLogo: true });
          s().notify(r.errors[0] ?? r.messages[0] ?? 'Logo uploaded.', r.errors.length ? 'error' : 'info');
          e.target.value = '';
        }} />
        {!logoAsset && (
          <>
            <Select<LogoMark> label="Mark" value={kit.logo.mark} options={LOGO_MARKS} onChange={(v) => setKit((k) => { k.logo.mark = v; })} />
            <Row>
              <TextInput label="Monogram" value={kit.logo.monogram} onChange={(v) => setKit((k) => { k.logo.monogram = v.slice(0, 2); }, false)} />
              <div className="flex items-end"><Toggle label="Capitals" checked={kit.logo.uppercase} onChange={(v) => setKit((k) => { k.logo.uppercase = v; })} /></div>
            </Row>
            <Slider label="Wordmark weight" value={kit.logo.weight} min={100} max={900} step={10} onChange={(v) => setKit((k) => { k.logo.weight = Math.round(v); }, false)} format={(v) => String(Math.round(v))} />
            <Slider label="Letter spacing" value={kit.logo.tracking} min={-80} max={400} step={5} onChange={(v) => setKit((k) => { k.logo.tracking = Math.round(v); }, false)} format={(v) => `${Math.round(v)} ‰`} />
          </>
        )}
      </Section>

      <Section title="Colour palette" id="brand-palette" right={
        <button type="button" title="Add a colour" className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-300 hover:bg-ink-700" onClick={() => setKit((k) => { k.palette.push({ id: uid('sw'), name: 'New colour', hex: '#7a8f9a', cmyk: rgbToCmyk('#7a8f9a'), role: undefined }); })}><Plus size={13} /></button>
      }>
        {kit.palette.map((sw) => <SwatchRow key={sw.id} sw={sw} />)}
        <Toggle label="Update designs when a kit colour or typeface changes" checked={kit.propagate} onChange={(v) => setKit((k) => { k.propagate = v; })} />
      </Section>

      <Section title="Typefaces" id="brand-type">
        {(['headline', 'body', 'accent'] as const).map((slot) => {
          const fam = getFamily(kit.fonts[slot]);
          void ensureFamily(fam.id);
          return (
            <div key={slot}>
              <Select label={slot === 'headline' ? 'Headline & logo' : slot === 'body' ? 'Body & small print' : 'Accent'} value={kit.fonts[slot]} options={families.map((f) => ({ value: f.id, label: f.name, group: f.builtin ? f.category : 'Uploaded' }))} onChange={(v) => setKitFont(slot, v)} />
              <div className="mt-1 truncate text-[17px] leading-tight text-ink-100" style={{ fontFamily: cssFamily(fam.id), fontWeight: slot === 'headline' ? Math.max(600, kit.logo.weight) : 400 }}>{slot === 'body' ? 'Ingredients, care & legal copy 0123' : kit.name || 'Brand name'}</div>
            </div>
          );
        })}
        <Hint>Upload your own typefaces in the Fonts tab; they appear here.</Hint>
      </Section>

      <Section title="Starter brands" id="brand-presets" defaultOpen={false}>
        <p className="text-[10.5px] leading-snug text-ink-400">Apply a starter kit to your designs (colours map by role, typefaces by slot), or load the whole starter brand with its products.</p>
        {BRAND_PRESETS.map((b) => (
          <div key={b.id} className="rounded-md border border-ink-700 p-2">
            <div className="flex items-center gap-2">
              <span className="flex gap-0.5">{b.kit.palette.map((c) => <span key={c.id} className="h-3.5 w-3.5 rounded-sm border border-white/10" style={{ background: c.hex }} />)}</span>
              <span className="truncate text-[11.5px] font-medium text-ink-100">{b.label}</span>
            </div>
            <p className="mt-1 text-[10.5px] text-ink-400">{b.summary}</p>
            <div className="mt-1.5 grid grid-cols-2 gap-1">
              <Button title="Recolour and re-type every design with this kit" onClick={() => { applyKit(b.kit, { keepName: true }); s().notify(`${b.label} kit applied — ⌘Z to undo.`); }}><Stamp size={12} /> Apply kit</Button>
              <Button title="Replace the project with this starter brand and its product range" onClick={() => { if (confirm(`Load the “${b.label}” starter brand? This replaces the current project.`)) s().replaceProject(createStarterProject(b.id)); }}>Load brand</Button>
            </div>
          </div>
        ))}
        <Button className="w-full" onClick={() => {
          const style = BRAND_PRESETS.find((b) => b.id === useDesignStyle.getState().style) ?? BRAND_PRESETS[0];
          const p = s().project;
          s().update((d) => {
            d.products.forEach((prod, i) => { prod.surfaces = designProduct(p.products[i], { kit: p.brand, copy: style.copy, look: style.look, variant: i }) as typeof prod.surfaces; });
          });
          s().select([]);
          s().notify('Every product redesigned from the kit — ⌘Z to undo.');
        }}><Wand2 size={12} /> Redesign every product from the kit</Button>
      </Section>
    </div>
  );
}

function SwatchRow({ sw }: { sw: Swatch }) {
  const s = useStore.getState;
  const set = (fn: (x: Swatch) => void, history = true) => s().update((d) => { const x = d.brand.palette.find((q) => q.id === sw.id); if (x) fn(x as Swatch); }, { history });
  const near = nearestSpot(sw.hex);
  const cmyk = sw.cmyk ?? rgbToCmyk(sw.hex);
  return (
    <div className="space-y-1.5 rounded-md border border-ink-700 p-2">
      <div className="flex items-end gap-1.5">
        <div className="w-[88px] shrink-0"><ColorField value={sw.hex} onChange={(v) => v && setPaletteColor(sw.id, v)} /></div>
        <div className="min-w-0 flex-1"><TextInput value={sw.name} onChange={(v) => set((x) => { x.name = v; }, false)} /></div>
        <button type="button" title="Remove colour" className="mb-1 inline-flex h-6 w-6 items-center justify-center rounded text-ink-400 hover:bg-ink-700 hover:text-ink-100" onClick={() => s().update((d) => { d.brand.palette = d.brand.palette.filter((q) => q.id !== sw.id); })}><Trash size={12} /></button>
      </div>
      <Row>
        <Select label="Role" value={sw.role ?? ''} options={[{ value: '', label: '—' }, ...ROLES]} onChange={(v) => set((x) => { x.role = (v || undefined) as ColorRole | undefined; })} />
        <TextInput label="Spot reference" value={sw.spot ?? ''} placeholder={`≈ ${near.name}`} onChange={(v) => set((x) => { x.spot = v || undefined; }, false)} />
      </Row>
      <div className="grid grid-cols-4 gap-1">
        {(['c', 'm', 'y', 'k'] as const).map((ch) => (
          <NumberField key={ch} label={ch.toUpperCase()} unit="%" value={cmyk[ch]} min={0} max={100} decimals={0} onChange={(v) => set((x) => { x.cmyk = { ...cmyk, [ch]: Math.round(v) }; })} />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] text-ink-500">
        <button type="button" className="underline hover:text-ink-200" title="Set the screen colour from the CMYK build" onClick={() => setPaletteColor(sw.id, cmykToHex(cmyk))}>Preview CMYK on screen</button>
        <button type="button" className="underline hover:text-ink-200" title="Use the nearest common spot reference" onClick={() => set((x) => { x.spot = near.name; })}>≈ {near.name}</button>
      </div>
    </div>
  );
}
