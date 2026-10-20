import type {
  Element, ElementType, TextStyle, TextElement, ImageElement, ShapeElement, RuleElement, PathElement, SvgElement,
  GradientElement, PatternElement, DrawingElement, LogoElement, BarcodeElement, ElementBase, Product, SurfaceArt,
} from './types';
import { uid } from '../lib/random';
import { getTemplate, templateDefaults, dielineOf } from '../products';

export const INK = '#16151a';

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'inter',
  fontSize: 12,
  leading: 15,
  weight: 400,
  italic: false,
  tracking: 0,
  wordSpacing: 0,
  align: 'left',
  color: INK,
  axes: {},
  features: {},
  hyphenate: false,
  language: 'en-us',
  firstLineIndent: 0,
  indentFirstParagraph: false,
  paragraphSpacing: 0,
  opticalMargin: true,
  baselineGrid: false,
  direction: 'ltr',
  writingMode: 'horizontal',
  tateChuYoko: true,
  textTransform: 'none',
  firstLineSmallCaps: false,
  dropCap: { enabled: false, lines: 3, fontFamily: null, weight: 700, color: INK, frame: 'none', frameColor: INK, gap: 4 },
  avoidRunts: true,
  kerning: 'metrics',
};

export function textStyle(over: Partial<TextStyle> = {}): TextStyle {
  return {
    ...DEFAULT_TEXT_STYLE,
    ...over,
    features: { ...DEFAULT_TEXT_STYLE.features, ...(over.features ?? {}) },
    axes: { ...(over.axes ?? {}) },
    dropCap: { ...DEFAULT_TEXT_STYLE.dropCap, ...(over.dropCap ?? {}) },
  };
}

const NAMES: Record<ElementType, string> = {
  text: 'Text', image: 'Image', shape: 'Shape', rule: 'Line', path: 'Path', svg: 'Graphic',
  gradient: 'Mesh gradient', pattern: 'Pattern', drawing: 'Drawing', logo: 'Logo', barcode: 'Barcode',
};

function base(type: ElementType, over: Partial<ElementBase>): ElementBase {
  return {
    id: uid(type.slice(0, 3)), type, name: NAMES[type], x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1,
    blend: 'normal', locked: false, hidden: false, finish: 'none', anchor: null, ...over,
  };
}

type Over<T> = Partial<Omit<T, 'type'>>;

export function makeText(over: Over<TextElement> = {}): TextElement {
  return {
    ...base('text', over), type: 'text', text: 'Type here.', columns: 1, columnGap: 12, inset: 0, verticalAlign: 'top',
    flowNext: null, fill: null, ...over, style: textStyle(over.style),
  } as TextElement;
}

export function makeImage(over: Over<ImageElement> = {}): ImageElement {
  return { ...base('image', over), type: 'image', assetId: null, fit: 'cover', offsetX: 0, offsetY: 0, zoom: 1, grayscale: false, duotone: null, ...over } as ImageElement;
}

export function makeShape(over: Over<ShapeElement> = {}): ShapeElement {
  return {
    ...base('shape', over), type: 'shape', shape: 'rect', fill: '#e8483b', stroke: null, strokeWidth: 1, dash: [], cap: 'butt', join: 'miter',
    radius: 0, sides: 6, innerRatio: 0.5, gradient: null, ...over,
  } as ShapeElement;
}

export function makeRule(over: Over<RuleElement> = {}): RuleElement {
  return { ...base('rule', { h: 8, ...over }), type: 'rule', kind: 'single', stroke: INK, strokeWidth: 1, dash: [], cap: 'butt', ...over } as RuleElement;
}

export function makePath(over: Over<PathElement> = {}): PathElement {
  return {
    ...base('path', over), type: 'path', d: 'M0 100 C30 0 70 0 100 100', vw: 100, vh: 100, fill: null, stroke: INK, strokeWidth: 1.5,
    dash: [], cap: 'round', join: 'round', fillRule: 'nonzero', gradient: null, ...over,
  } as PathElement;
}

export function makeSvg(over: Over<SvgElement> = {}): SvgElement {
  return { ...base('svg', over), type: 'svg', assetId: null, fillOverride: null, strokeOverride: null, ...over } as SvgElement;
}

export function makeGradient(over: Over<GradientElement> = {}): GradientElement {
  return {
    ...base('gradient', { w: 240, h: 300, ...over }), type: 'gradient', base: '#ffb36b',
    points: [
      { x: 0.25, y: 0.3, color: '#ff5e7e', radius: 0.6 },
      { x: 0.78, y: 0.55, color: '#7a6cff', radius: 0.55 },
      { x: 0.5, y: 0.95, color: '#ffe08a', radius: 0.45 },
    ],
    softness: 0.75, grain: 0.15, glow: false, ...over,
  } as GradientElement;
}

export function makePattern(over: Over<PatternElement> = {}): PatternElement {
  return {
    ...base('pattern', { w: 240, h: 240, ...over }), type: 'pattern', kind: 'dots', color: INK, color2: '#e8483b', background: null,
    scale: 18, angle: 0, density: 0.45, seed: 7, text: 'BRAND', fontFamily: 'inter', ...over,
  } as PatternElement;
}

export function makeDrawing(over: Over<DrawingElement> = {}): DrawingElement {
  return { ...base('drawing', over), type: 'drawing', strokes: [], paperGrain: 0.4, ...over } as DrawingElement;
}

export function makeLogo(over: Over<LogoElement> = {}): LogoElement {
  return { ...base('logo', { w: 160, h: 60, ...over }), type: 'logo', variant: 'lockup', color: null, color2: null, text: null, ...over } as LogoElement;
}

export function makeBarcode(over: Over<BarcodeElement> = {}): BarcodeElement {
  return { ...base('barcode', { w: 105, h: 72, ...over }), type: 'barcode', symbology: 'ean13', code: '501234567890', color: '#000000', background: '#ffffff', showText: true, ...over } as BarcodeElement;
}

export function makeElement(type: ElementType, over: Partial<Element> = {}): Element {
  switch (type) {
    case 'text': return makeText(over as Over<TextElement>);
    case 'image': return makeImage(over as Over<ImageElement>);
    case 'shape': return makeShape(over as Over<ShapeElement>);
    case 'rule': return makeRule(over as Over<RuleElement>);
    case 'path': return makePath(over as Over<PathElement>);
    case 'svg': return makeSvg(over as Over<SvgElement>);
    case 'gradient': return makeGradient(over as Over<GradientElement>);
    case 'pattern': return makePattern(over as Over<PatternElement>);
    case 'drawing': return makeDrawing(over as Over<DrawingElement>);
    case 'logo': return makeLogo(over as Over<LogoElement>);
    case 'barcode': return makeBarcode(over as Over<BarcodeElement>);
  }
}

/** Deep clone with fresh ids (duplicate / paste). */
export function cloneElement<T extends Element>(el: T, dx = 0, dy = 0): T {
  const copy = JSON.parse(JSON.stringify(el)) as T;
  copy.id = uid(el.type.slice(0, 3));
  copy.x += dx;
  copy.y += dy;
  if (copy.type === 'text') copy.flowNext = null;
  if (copy.type === 'drawing') copy.strokes = copy.strokes.map((s) => ({ ...s, id: uid('stk') }));
  return copy;
}

/** A new product of a template, with empty artwork on every surface. */
export function makeProduct(templateId: string, name?: string, options: Record<string, number | string | boolean> = {}): Product {
  const t = getTemplate(templateId);
  const product: Product = { id: uid('pr'), name: name ?? t.name, template: t.id, options: { ...templateDefaults(t), ...options }, surfaces: {} };
  for (const s of dielineOf(product).surfaces) product.surfaces[s.id] = blankArt(s.defaultGround);
  return product;
}

export const blankArt = (ground: string | null): SurfaceArt => ({ elements: [], background: ground });
