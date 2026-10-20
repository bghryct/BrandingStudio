/**
 * Brand-kit propagation: when a kit colour or typeface changes, every design that uses it changes
 * with it; applying another kit maps colours by palette role and typefaces by slot.
 */
import type { Draft } from 'immer';
import type { BrandKit, Project, Swatch } from './types';
import { useStore } from '../store/store';

const HEX = /^#[0-9a-f]{6}$/i;

/** Replace colours everywhere in the artwork (simultaneous map, case-insensitive). */
export function recolorAll(d: Draft<Project>, map: Record<string, string>) {
  const m = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  if (!m.size) return;
  const walk = (o: unknown): unknown => {
    if (typeof o === 'string') return HEX.test(o) && m.has(o.toLowerCase()) ? m.get(o.toLowerCase())! : o;
    if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) o[i] = walk(o[i]); return o; }
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (k === 'text' || k === 'id' || k === 'd' || k === 'name') continue;
        (o as Record<string, unknown>)[k] = walk((o as Record<string, unknown>)[k]);
      }
    }
    return o;
  };
  for (const p of d.products) for (const art of Object.values(p.surfaces)) {
    if (art.background && m.has(art.background.toLowerCase())) art.background = m.get(art.background.toLowerCase())!;
    for (const el of art.elements) walk(el);
  }
  for (const st of d.paragraphStyles ?? []) if (st.props.color && m.has(st.props.color.toLowerCase())) st.props.color = m.get(st.props.color.toLowerCase())!;
  for (const st of d.characterStyles ?? []) if (st.props.color && m.has(st.props.color.toLowerCase())) st.props.color = m.get(st.props.color.toLowerCase())!;
}

/** Replace typefaces everywhere (text frames, patterns, styles). */
export function refontAll(d: Draft<Project>, map: Record<string, string>) {
  const f = (id: string) => map[id] ?? id;
  for (const p of d.products) for (const art of Object.values(p.surfaces)) for (const el of art.elements) {
    if (el.type === 'text') {
      const next = f(el.style.fontFamily);
      if (next !== el.style.fontFamily) { el.style.fontFamily = next; el.style.axes = {}; }
      if (el.style.dropCap.fontFamily) el.style.dropCap.fontFamily = f(el.style.dropCap.fontFamily);
    }
    if (el.type === 'pattern') el.fontFamily = f(el.fontFamily);
  }
  for (const st of d.paragraphStyles ?? []) if (st.props.fontFamily) st.props.fontFamily = f(st.props.fontFamily);
  for (const st of d.characterStyles ?? []) if (st.props.fontFamily) st.props.fontFamily = f(st.props.fontFamily);
}

/** Change one palette colour (and, when the kit propagates, the designs that use it). */
export function setPaletteColor(id: string, hex: string, opts: { history?: boolean } = {}) {
  const s = useStore.getState();
  const old = s.project.brand.palette.find((x) => x.id === id)?.hex;
  s.update((d) => {
    const sw = d.brand.palette.find((x) => x.id === id);
    if (!sw) return;
    if (d.brand.propagate && old && old.toLowerCase() !== hex.toLowerCase()) recolorAll(d, { [old]: hex });
    sw.hex = hex;
  }, opts);
}

export function setKitFont(slot: keyof BrandKit['fonts'], family: string) {
  const s = useStore.getState();
  const old = s.project.brand.fonts[slot];
  s.update((d) => {
    const others = Object.entries(d.brand.fonts).filter(([k]) => k !== slot).map(([, v]) => v);
    // Only remap when no other slot still uses the old face.
    if (d.brand.propagate && old !== family && !others.includes(old)) refontAll(d, { [old]: family });
    d.brand.fonts[slot] = family;
  });
}

/** Apply another kit: colours map by role (then by order), typefaces by slot; logo settings carry over. */
export function applyKit(kit: BrandKit, opts: { keepName?: boolean } = {}) {
  const s = useStore.getState();
  const cur = s.project.brand;
  const map: Record<string, string> = {};
  const byRole = (pal: Swatch[], r: string) => pal.find((x) => x.role === r);
  cur.palette.forEach((sw, i) => {
    const target = (sw.role ? byRole(kit.palette, sw.role) : null) ?? kit.palette[i % kit.palette.length];
    if (target && target.hex.toLowerCase() !== sw.hex.toLowerCase()) map[sw.hex] = target.hex;
  });
  const fonts: Record<string, string> = {};
  for (const slot of ['headline', 'body', 'accent'] as const) if (cur.fonts[slot] !== kit.fonts[slot]) fonts[cur.fonts[slot]] = kit.fonts[slot];
  s.update((d) => {
    recolorAll(d, map);
    refontAll(d, fonts);
    const name = d.brand.name, tagline = d.brand.tagline, asset = d.brand.logo.assetId;
    d.brand = JSON.parse(JSON.stringify(kit));
    if (opts.keepName) { d.brand.name = name; d.brand.tagline = tagline; }
    d.brand.logo.assetId = asset;
  });
}
