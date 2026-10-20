/**
 * Starter brands: a complete kit (palette with CMYK builds and spot references, typefaces,
 * logo mark), product copy, a visual "look" for the generative designer, and the product range
 * the brand would typically launch with.
 */
import type { BrandKit, OptionValue, PatternKind, Swatch } from './types';
import { mm } from './units';

export interface BrandLook {
  /** Palette role used for printed grounds. */
  ground: 'background' | 'primary' | 'secondary' | 'accent';
  /** Repeat pattern laid over the ground (null = none). */
  pattern: PatternKind | null;
  patternScale: number;
  patternOpacity: number;
  /** Hero composition. */
  layout: 'circle' | 'band' | 'frame' | 'stack' | 'split';
  caps: boolean;
  /** Foil for luxury details (null = print). */
  foil: 'gold-foil' | 'silver-foil' | null;
}

export interface BrandCopy {
  variants: string[];
  descriptor: string;
  blurb: string;
  ingredients: string;
  web: string;
  claim: string;
  contact: { name: string; title: string; phone: string; email: string; address: string };
}

export interface BrandPreset {
  id: string;
  label: string;
  summary: string;
  kit: BrandKit;
  copy: BrandCopy;
  look: BrandLook;
  products: { template: string; name: string; options?: Record<string, OptionValue> }[];
}

const sw = (id: string, name: string, hex: string, cmyk: [number, number, number, number], role: Swatch['role'], spot?: string): Swatch =>
  ({ id, name, hex, cmyk: { c: cmyk[0], m: cmyk[1], y: cmyk[2], k: cmyk[3] }, role, spot });

export const BRAND_PRESETS: BrandPreset[] = [
  {
    id: 'citrus',
    label: 'Citrus & Co.',
    summary: 'Sparkling citrus soda — sunny, bold and playful.',
    kit: {
      name: 'Citrus & Co.', tagline: 'Sparkling since sunrise',
      palette: [
        sw('c1', 'Blood Orange', '#f2542d', [0, 80, 85, 0], 'primary', 'PMS 172 C'),
        sw('c2', 'Sunbeam', '#f5b700', [0, 28, 100, 0], 'secondary', 'PMS 7549 C'),
        sw('c3', 'Lagoon', '#0e7c7b', [88, 20, 50, 5], 'accent', 'PMS 7716 C'),
        sw('c4', 'Night', '#1b1b1e', [70, 60, 55, 80], 'neutral'),
        sw('c5', 'Pith', '#fff4e6', [0, 4, 10, 0], 'background'),
      ],
      fonts: { headline: 'syne', body: 'inter', accent: 'red-hat-display' },
      logo: { assetId: null, mark: 'sun', monogram: 'C', weight: 800, tracking: -10, uppercase: false },
      propagate: true,
    },
    copy: {
      variants: ['Blood Orange', 'Yuzu Lime', 'Pink Grapefruit', 'Mandarin'],
      descriptor: 'Sparkling citrus water',
      blurb: 'Cold-pressed citrus, a whisper of cane sugar and a lot of bubbles. Best served ice cold, outdoors, with friends.',
      ingredients: 'Ingredients: carbonated water, cold-pressed orange juice (8%), cane sugar, natural citrus flavours, citric acid. 42 kcal per can.',
      web: 'citrusandco.example', claim: 'No artificial anything',
      contact: { name: 'Ada Sol', title: 'Head of Flavour', phone: '+1 555 0142', email: 'ada@citrusandco.example', address: '12 Orchard Lane, Valencia' },
    },
    look: { ground: 'primary', pattern: 'dots', patternScale: 22, patternOpacity: 0.16, layout: 'circle', caps: false, foil: null },
    products: [
      { template: 'can', name: 'Soda can 355 ml' },
      { template: 'bottle', name: 'Glass soda', options: { shape: 'soda', glass: 'flint', liquidColor: '#f07b2b', frontW: mm(80), frontH: mm(72), frontY: mm(22), backW: mm(66), backH: mm(56), backY: mm(30), labelShape: 'rounded' } },
      { template: 'tuck-reverse', name: '4-pack carton', options: { length: mm(140), width: mm(70), depth: mm(125) } },
      { template: 'tote', name: 'Market tote' },
      { template: 'tee', name: 'Crew tee', options: { fabric: 'white' } },
      { template: 'card', name: 'Business card', options: { stock: 'white' } },
    ],
  },
  {
    id: 'roastery',
    label: 'Nordhavn Roasters',
    summary: 'Specialty coffee — calm, crafted, kraft and ink.',
    kit: {
      name: 'Nordhavn', tagline: 'Small-batch coffee roasters',
      palette: [
        sw('r1', 'Harbour Ink', '#1f2a2e', [75, 55, 50, 75], 'primary', 'PMS 433 C'),
        sw('r2', 'Latte', '#c8a27a', [20, 35, 55, 5], 'secondary', 'PMS 7509 C'),
        sw('r3', 'Signal Red', '#d9482b', [5, 85, 90, 0], 'accent', 'PMS 7625 C'),
        sw('r4', 'Charcoal', '#2b2a28', [60, 55, 60, 70], 'neutral'),
        sw('r5', 'Oat', '#f3ede3', [3, 5, 10, 0], 'background'),
      ],
      fonts: { headline: 'fraunces', body: 'inter', accent: 'ibm-plex-mono' },
      logo: { assetId: null, mark: 'arch', monogram: 'N', weight: 600, tracking: 20, uppercase: false },
      propagate: true,
    },
    copy: {
      variants: ['Harbour Blend', 'Ethiopia Guji', 'Colombia Huila', 'Night Shift'],
      descriptor: 'Whole bean · medium roast',
      blurb: 'Roasted in small batches on the harbour front. Notes of stone fruit, cocoa and toasted almond. Brew it slowly.',
      ingredients: '100% arabica coffee. Roasted on 14.10. Best before 14.04. Store cool and dry; reseal after opening. Net wt 250 g.',
      web: 'nordhavn.example', claim: 'Roasted to order',
      contact: { name: 'Mads Holm', title: 'Head Roaster', phone: '+45 55 01 22 33', email: 'mads@nordhavn.example', address: 'Kajgade 4, 2150 Nordhavn' },
    },
    look: { ground: 'background', pattern: 'waves', patternScale: 14, patternOpacity: 0.12, layout: 'frame', caps: false, foil: null },
    products: [
      { template: 'pouch', name: 'Coffee pouch 250 g', options: { film: 'kraft', width: mm(130), height: mm(220), gusset: mm(45) } },
      { template: 'cup', name: 'Take-away cup', options: { size: '12oz', paper: 'kraft', lid: 'black' } },
      { template: 'mug', name: 'Café mug', options: { glaze: '#f3ede3', inside: '#1f2a2e' } },
      { template: 'tube', name: 'Gift tube', options: { material: 'kraft' } },
      { template: 'tote', name: 'Bean tote', options: { fabric: 'natural' } },
      { template: 'card', name: 'Business card', options: { stock: 'kraft' } },
    ],
  },
  {
    id: 'lumiere',
    label: 'Maison Lumière',
    summary: 'Luxury fragrance — black, champagne and gold foil.',
    kit: {
      name: 'Maison Lumière', tagline: 'Parfums de Paris',
      palette: [
        sw('l1', 'Noir', '#141416', [70, 65, 60, 90], 'primary', 'PMS Black 6 C'),
        sw('l2', 'Or', '#c9a227', [20, 30, 95, 5], 'accent', 'PMS 7753 C'),
        sw('l3', 'Champagne', '#e9d8c4', [5, 12, 22, 0], 'secondary', 'PMS 4685 C'),
        sw('l4', 'Graphite', '#3a3a3d', [60, 50, 45, 50], 'neutral'),
        sw('l5', 'Ivoire', '#f7f3ee', [2, 3, 6, 0], 'background'),
      ],
      fonts: { headline: 'cinzel', body: 'eb-garamond', accent: 'inter' },
      logo: { assetId: null, mark: 'diamond', monogram: 'L', weight: 500, tracking: 220, uppercase: true },
      propagate: true,
    },
    copy: {
      variants: ['Nuit Dorée', 'Jardin Blanc', 'Ambre Noir', 'Soie'],
      descriptor: 'Eau de parfum · 50 ml',
      blurb: 'An evening composition of bergamot, iris and warm amber, finished with a trace of smoked vanilla.',
      ingredients: 'Alcohol denat., parfum (fragrance), aqua, limonene, linalool, citral, coumarin. 50 ml e 1.7 fl oz.',
      web: 'maisonlumiere.example', claim: 'Composed in Grasse',
      contact: { name: 'Céleste Marchand', title: 'Directrice de Création', phone: '+33 1 55 01 22 33', email: 'celeste@maisonlumiere.example', address: '8 rue Cambon, 75001 Paris' },
    },
    look: { ground: 'primary', pattern: 'diamonds', patternScale: 26, patternOpacity: 0.07, layout: 'frame', caps: true, foil: 'gold-foil' },
    products: [
      { template: 'perfume', name: 'Eau de parfum', options: { shape: 'rect', deco: 'screen', glass: 'flint', capMaterial: 'gold', liquidColor: '#e8c67f' } },
      { template: 'tuck-straight', name: 'Perfume carton', options: { length: mm(66), width: mm(40), depth: mm(110), board: 'black', finish: 'soft-touch' } },
      { template: 'card', name: 'Business card', options: { stock: 'black', finish: 'soft-touch', corners: 'round' } },
      { template: 'letterhead', name: 'Letterhead', options: { stock: 'cotton' } },
      { template: 'tote', name: 'Boutique tote', options: { fabric: 'black', weave: 'canvas' } },
    ],
  },
  {
    id: 'botanics',
    label: 'Verdant Botanics',
    summary: 'Natural skincare — sage, sand and terracotta.',
    kit: {
      name: 'Verdant', tagline: 'Botanical skincare',
      palette: [
        sw('v1', 'Sage', '#2f5d50', [80, 35, 65, 25], 'primary', 'PMS 5545 C'),
        sw('v2', 'Sand', '#e8c9a0', [5, 20, 38, 0], 'secondary', 'PMS 7506 C'),
        sw('v3', 'Terracotta', '#d97a5b', [5, 60, 65, 0], 'accent', 'PMS 7416 C'),
        sw('v4', 'Moss Ink', '#1d2b26', [75, 50, 65, 65], 'neutral'),
        sw('v5', 'Linen', '#f4efe6', [3, 4, 9, 0], 'background'),
      ],
      fonts: { headline: 'fraunces', body: 'red-hat-display', accent: 'inter' },
      logo: { assetId: null, mark: 'leaf', monogram: 'V', weight: 500, tracking: 40, uppercase: false },
      propagate: true,
    },
    copy: {
      variants: ['Rosehip Night Balm', 'Calendula Cleanser', 'Sea Fennel Serum', 'Oat Body Butter'],
      descriptor: 'Restoring face balm',
      blurb: 'A rich balm of cold-pressed rosehip, calendula and shea that melts into the skin overnight. Free from synthetic fragrance.',
      ingredients: 'Butyrospermum parkii butter, Rosa canina fruit oil, Calendula officinalis flower extract, tocopherol, Helianthus annuus seed oil. 60 ml.',
      web: 'verdant.example', claim: 'Vegan · cruelty free',
      contact: { name: 'Iris Moreau', title: 'Founder & Formulator', phone: '+44 20 5550 1234', email: 'iris@verdant.example', address: 'Unit 3, Greenhouse Yard, Bristol' },
    },
    look: { ground: 'background', pattern: 'terrazzo', patternScale: 18, patternOpacity: 0.2, layout: 'stack', caps: false, foil: null },
    products: [
      { template: 'jar', name: 'Balm jar', options: { lid: 'wood', contents: '#e9d6b8', stock: 'white' } },
      { template: 'tuck-reverse', name: 'Serum carton', options: { length: mm(45), width: mm(45), depth: mm(120), board: 'sbs' } },
      { template: 'bottle', name: 'Apothecary oil', options: { shape: 'apothecary', glass: 'amber', liquidColor: '#c8862a', frontW: mm(84), frontH: mm(62), frontY: mm(18), backW: mm(70), backH: mm(50), backY: mm(24), neckLabel: false } },
      { template: 'tube', name: 'Gift tube', options: { material: 'white' } },
      { template: 'tote', name: 'Linen tote', options: { fabric: 'natural' } },
    ],
  },
  {
    id: 'hopline',
    label: 'Hopline Brewing',
    summary: 'Craft beer — condensed type, gold and black.',
    kit: {
      name: 'Hopline', tagline: 'Brewing company',
      palette: [
        sw('h1', 'Brewhouse Black', '#1c1c1c', [70, 65, 65, 85], 'primary', 'PMS Black C'),
        sw('h2', 'Malt Gold', '#f2c14e', [0, 25, 80, 0], 'secondary', 'PMS 7408 C'),
        sw('h3', 'Hop Red', '#e4572e', [0, 78, 85, 0], 'accent', 'PMS 7597 C'),
        sw('h4', 'Steel', '#4a4e54', [65, 52, 45, 35], 'neutral'),
        sw('h5', 'Foam', '#f5f0e6', [2, 4, 9, 0], 'background'),
      ],
      fonts: { headline: 'oswald', body: 'space-grotesk', accent: 'unifraktur' },
      logo: { assetId: null, mark: 'bolt', monogram: 'H', weight: 700, tracking: 60, uppercase: true },
      propagate: true,
    },
    copy: {
      variants: ['West Coast IPA', 'Hazy Pale', 'Night Porter', 'Pils'],
      descriptor: 'India pale ale · 6.4% abv',
      blurb: 'Brewed with Citra, Mosaic and Simcoe, dry hopped twice. Big pine and grapefruit, clean bitter finish.',
      ingredients: 'Water, barley malt, oats, hops, yeast. Contains gluten (barley, oats). 6.4% vol. 473 ml.',
      web: 'hopline.example', claim: 'Independent & local',
      contact: { name: 'Sam Kowalski', title: 'Head Brewer', phone: '+1 555 0177', email: 'sam@hopline.example', address: '400 Mill Street, Portland' },
    },
    look: { ground: 'secondary', pattern: 'stripes', patternScale: 16, patternOpacity: 0.1, layout: 'band', caps: true, foil: null },
    products: [
      { template: 'can', name: 'Tallboy 473 ml', options: { size: 'tall-473', varnish: 'matte', lid: 'black' } },
      { template: 'bottle', name: 'Longneck', options: { shape: 'longneck', glass: 'amber', liquidColor: '#c9851c', frontW: mm(84), frontH: mm(80), frontY: mm(20), backW: mm(70), backH: mm(64), backY: mm(26) } },
      { template: 'tee', name: 'Brewery tee', options: { fabric: 'black' } },
      { template: 'cap', name: 'Trucker cap', options: { fabric: 'black', brim: '#1c1c1c' } },
      { template: 'tote', name: 'Growler tote', options: { fabric: 'natural', weave: 'canvas' } },
    ],
  },
  {
    id: 'kollektiv',
    label: 'Pop Kollektiv',
    summary: 'Streetwear label — violet, pink and acid lime.',
    kit: {
      name: 'POP/KOLLEKTIV', tagline: 'Wear loud',
      palette: [
        sw('p1', 'Ultraviolet', '#6c3bff', [70, 75, 0, 0], 'primary', 'PMS 2725 C'),
        sw('p2', 'Bubblegum', '#ff4fa3', [0, 80, 0, 0], 'secondary', 'PMS 806 C'),
        sw('p3', 'Acid', '#c6ff3d', [25, 0, 85, 0], 'accent', 'PMS 802 C'),
        sw('p4', 'Tar', '#111014', [75, 70, 60, 90], 'neutral'),
        sw('p5', 'Chalk', '#f4f2f7', [3, 3, 0, 0], 'background'),
      ],
      fonts: { headline: 'syne', body: 'space-grotesk', accent: 'bungee' },
      logo: { assetId: null, mark: 'star', monogram: 'P', weight: 800, tracking: 0, uppercase: true },
      propagate: true,
    },
    copy: {
      variants: ['Drop 01', 'Drop 02', 'Night Market', 'Studio'],
      descriptor: 'Limited run · heavyweight cotton',
      blurb: 'Designed in the studio, printed in small runs, made to be worn hard. Thank you for wearing loud.',
      ingredients: '100% organic cotton, 280 gsm. Wash cold inside out. Do not tumble dry.',
      web: 'popkollektiv.example', claim: 'Made in small runs',
      contact: { name: 'Juno Park', title: 'Creative Director', phone: '+49 30 5550 1188', email: 'juno@popkollektiv.example', address: 'Studio 5, Kreuzberg, Berlin' },
    },
    look: { ground: 'primary', pattern: 'confetti', patternScale: 30, patternOpacity: 0.85, layout: 'split', caps: true, foil: null },
    products: [
      { template: 'hoodie', name: 'Drop hoodie', options: { fabric: 'black' } },
      { template: 'tee', name: 'Logo tee', options: { fabric: 'white' } },
      { template: 'cap', name: 'Dad cap', options: { fabric: 'custom', fabricColor: '#6c3bff', brim: '#6c3bff' } },
      { template: 'mailer', name: 'Shipping mailer', options: { board: 'sbs' } },
      { template: 'tote', name: 'Merch tote', options: { fabric: 'black' } },
    ],
  },
];

export const getBrandPreset = (id: string) => BRAND_PRESETS.find((b) => b.id === id) ?? BRAND_PRESETS[0];
