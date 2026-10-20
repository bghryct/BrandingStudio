import type { Project, Product } from './types';
import { uid } from '../lib/random';
import { makeProduct } from './factory';
import { BRAND_PRESETS, getBrandPreset, type BrandPreset } from './brands';
import { designProduct } from '../engine/designer';

/** A product of a preset's range, designed with the preset's kit and look. */
export function presetProduct(preset: BrandPreset, entry: BrandPreset['products'][number], variant: number): Product {
  const p = makeProduct(entry.template, entry.name, entry.options ?? {});
  p.surfaces = designProduct(p, { kit: preset.kit, copy: preset.copy, look: preset.look, variant });
  return p;
}

export function createStarterProject(presetId = BRAND_PRESETS[0].id): Project {
  const preset = getBrandPreset(presetId);
  return {
    version: 1,
    app: 'branding-studio',
    id: uid('prj'),
    name: preset.kit.name,
    unit: 'mm',
    brand: JSON.parse(JSON.stringify(preset.kit)),
    products: preset.products.map((entry, i) => presetProduct(preset, entry, i)),
    assets: {},
    fonts: [],
  };
}

export function createBlankProject(): Project {
  return {
    version: 1,
    app: 'branding-studio',
    id: uid('prj'),
    name: 'Untitled brand',
    unit: 'mm',
    brand: {
      name: 'Your Brand', tagline: 'Your tagline here',
      palette: [
        { id: uid('sw'), name: 'Ink', hex: '#16151a', cmyk: { c: 70, m: 65, y: 60, k: 85 }, role: 'primary' },
        { id: uid('sw'), name: 'Signal', hex: '#e8483b', cmyk: { c: 0, m: 85, y: 80, k: 0 }, role: 'accent' },
        { id: uid('sw'), name: 'Stone', hex: '#c9c2b6', cmyk: { c: 20, m: 20, y: 25, k: 5 }, role: 'secondary' },
        { id: uid('sw'), name: 'Charcoal', hex: '#2c2b2f', cmyk: { c: 65, m: 60, y: 55, k: 60 }, role: 'neutral' },
        { id: uid('sw'), name: 'Paper', hex: '#ffffff', cmyk: { c: 0, m: 0, y: 0, k: 0 }, role: 'background' },
      ],
      fonts: { headline: 'red-hat-display', body: 'inter', accent: 'fraunces' },
      logo: { assetId: null, mark: 'circle', monogram: 'Y', weight: 800, tracking: 0, uppercase: false },
      propagate: true,
    },
    products: [makeProduct('can', 'Beverage can')],
    assets: {},
    fonts: [],
  };
}
