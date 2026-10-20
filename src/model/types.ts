/**
 * Branding Studio — core document model.
 *
 * All geometry is stored in PostScript points (1 pt = 1/72 in), the native unit of PDF and of
 * type sizes, so the text engine, the SVG/Canvas renderers and the PDF writer never round-trip
 * through a lossy conversion. Display units (mm, in …) are a view concern.
 *
 * A project holds a brand kit and a list of products. Each product is an instance of a
 * parametric template (a can, a carton, a tote …); the template turns the product's options
 * into a dieline made of one or more print surfaces. Artwork lives per surface. Coordinates of
 * an element are relative to the top-left corner of its surface's trim box, or — when the
 * element is anchored — to the top-left corner of a panel of that surface, so artwork follows
 * the panel when the dimensions change. Negative values or values past the cut reach into the
 * bleed.
 */

export type ID = string;
export type Unit = 'mm' | 'cm' | 'in' | 'pt' | 'pc' | 'px';

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light'
  | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

/** CMYK in percent, 0–100. */
export interface CMYK { c: number; m: number; y: number; k: number }

export type ColorRole = 'primary' | 'secondary' | 'accent' | 'neutral' | 'background';

/** A palette colour (the brand palette doubles as the swatch list everywhere). */
export interface Swatch {
  id: ID;
  name: string;
  hex: string;
  /** Exact process build used by the PDF writer when the colour is used. */
  cmyk?: CMYK;
  /** Spot / solid ink reference, e.g. "Brand Red · 185 C". Printed as a separation on request. */
  spot?: string;
  role?: ColorRole;
}

/* ------------------------------------------------------------------------- */
/* Typography                                                                 */
/* ------------------------------------------------------------------------- */

export type TextAlign = 'left' | 'right' | 'center' | 'justify' | 'justify-all';
export type DropCapFrame = 'none' | 'gilded' | 'vine' | 'rubric' | 'box' | 'outline';

export interface DropCapStyle {
  enabled: boolean;
  lines: number;
  fontFamily: string | null;
  weight: number;
  color: string;
  frame: DropCapFrame;
  frameColor: string;
  gap: number;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;        // pt
  leading: number;         // pt, baseline to baseline
  weight: number;          // 100–900 (drives `wght` on variable fonts)
  italic: boolean;
  tracking: number;        // thousandths of an em
  wordSpacing: number;
  align: TextAlign;
  color: string;
  axes: Record<string, number>;
  features: Record<string, boolean>;
  hyphenate: boolean;
  language: string;
  firstLineIndent: number;
  indentFirstParagraph: boolean;
  paragraphSpacing: number;
  opticalMargin: boolean;
  baselineGrid: boolean;
  direction: 'ltr' | 'rtl';
  writingMode: 'horizontal' | 'vertical';
  tateChuYoko: boolean;
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'small-caps';
  firstLineSmallCaps: boolean;
  dropCap: DropCapStyle;
  avoidRunts: boolean;
  kerning?: KerningMode;
  leftIndent?: number;
  rightIndent?: number;
  wordSpaceMin?: number;
  wordSpaceMax?: number;
  hyphenMinWord?: number;
  hyphenBefore?: number;
  hyphenAfter?: number;
  hyphenLimit?: number;
  hyphenateCaps?: boolean;
}

export type KerningMode = 'metrics' | 'optical' | 'none';

export interface ParagraphStyleProps {
  fontFamily?: string;
  fontSize?: number;
  leading?: number;
  weight?: number;
  italic?: boolean;
  tracking?: number;
  color?: string;
  align?: TextAlign;
  firstLineIndent?: number;
  leftIndent?: number;
  rightIndent?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  textTransform?: TextStyle['textTransform'];
  features?: Record<string, boolean>;
  hyphenate?: boolean;
  kerning?: KerningMode;
}

export interface CharacterStyleProps {
  fontFamily?: string;
  weight?: number;
  italic?: boolean;
  sizeScale?: number;
  tracking?: number;
  color?: string;
  textTransform?: TextStyle['textTransform'];
  position?: 'normal' | 'superscript' | 'subscript';
  baselineShift?: number;
  features?: Record<string, boolean>;
}

export interface ParagraphStyleDef { id: ID; name: string; props: ParagraphStyleProps }
export interface CharacterStyleDef { id: ID; name: string; props: CharacterStyleProps }

/* ------------------------------------------------------------------------- */
/* Elements                                                                   */
/* ------------------------------------------------------------------------- */

export type ElementType =
  | 'text' | 'image' | 'shape' | 'rule' | 'path' | 'svg'
  | 'gradient' | 'pattern' | 'drawing' | 'logo' | 'barcode';

/**
 * Print finishing. Foils, emboss/deboss and spot UV render in 3D and are separated onto named
 * spot plates in the PDF. `white-base` is an opaque white underprint: on bare aluminium, clear
 * film or glass it makes the item opaque instead of a transparent ink.
 */
export type Finish =
  | 'none' | 'gold-foil' | 'silver-foil' | 'copper-foil' | 'holo-foil'
  | 'emboss' | 'blind-deboss' | 'spot-gloss' | 'white-base';

export interface ElementBase {
  id: ID;
  type: ElementType;
  name: string;
  x: number; y: number; w: number; h: number; // pt
  rotation: number;  // degrees, about the box centre
  opacity: number;   // 0–1
  blend: BlendMode;
  locked: boolean;
  hidden: boolean;
  flipX?: boolean;
  flipY?: boolean;
  finish?: Finish;
  /** Panel of the surface this item is anchored to (x / y are relative to that panel). */
  anchor?: string | null;
  /** Unused here (no threads); kept so shared text tooling stays compatible. */
  spreadAbove?: boolean;
}

export interface TextElement extends ElementBase {
  type: 'text';
  text: string;
  style: TextStyle;
  columns: number;
  columnGap: number;
  inset: number;
  verticalAlign: 'top' | 'middle' | 'bottom';
  /** Text threads are not used in Branding Studio; always null. */
  flowNext: ID | null;
  fill: string | null;
  paraStyle?: ID | null;
  /** Shrink the type to fit the frame (one line headlines, can wordmarks). */
  autoFit?: boolean;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  assetId: ID | null;
  fit: 'cover' | 'contain' | 'fill';
  offsetX: number;
  offsetY: number;
  zoom: number;
  grayscale: boolean;
  duotone: [string, string] | null;
  placeholder?: boolean;
}

export interface GradientStopDef { offset: number; color: string }

/** A linear or radial gradient fill for shapes and paths. Angle in degrees (0 = left → right). */
export interface GradientFill {
  kind: 'linear' | 'radial';
  angle: number;
  stops: GradientStopDef[];
}

export type ShapeKind = 'rect' | 'ellipse' | 'polygon' | 'star' | 'triangle' | 'arc' | 'pill' | 'burst' | 'arch';

export interface StrokeStyle {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  dash: number[];
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
}

export interface ShapeElement extends ElementBase, StrokeStyle {
  type: 'shape';
  shape: ShapeKind;
  radius: number;
  sides: number;
  innerRatio: number;
  /** Gradient fill (overrides `fill`). */
  gradient?: GradientFill | null;
}

export type RuleKind = 'single' | 'double' | 'scotch' | 'dotted' | 'wave' | 'zigzag' | 'greek-key' | 'chain';

export interface RuleElement extends ElementBase {
  type: 'rule';
  kind: RuleKind;
  stroke: string;
  strokeWidth: number;
  dash: number[];
  cap: 'butt' | 'round' | 'square';
}

export interface PathElement extends ElementBase, StrokeStyle {
  type: 'path';
  d: string;
  vw: number;
  vh: number;
  fillRule: 'nonzero' | 'evenodd';
  gradient?: GradientFill | null;
}

export interface SvgElement extends ElementBase {
  type: 'svg';
  assetId: ID | null;
  fillOverride: string | null;
  strokeOverride: string | null;
}

/** Soft tonal mesh gradient (after Koichi Sato). */
export interface GradientPoint { x: number; y: number; color: string; radius: number }
export interface GradientElement extends ElementBase {
  type: 'gradient';
  base: string;
  points: GradientPoint[];
  softness: number;
  grain: number;
  glow: boolean;
}

export type PatternKind =
  | 'stripes' | 'pinstripe' | 'dots' | 'checker' | 'gingham' | 'chevron' | 'waves' | 'scales'
  | 'triangles' | 'halftone' | 'terrazzo' | 'confetti' | 'grid' | 'diamonds' | 'sunburst' | 'type-repeat';

/** Repeat pattern for packaging grounds. `scale` is the repeat size in pt. */
export interface PatternElement extends ElementBase {
  type: 'pattern';
  kind: PatternKind;
  color: string;
  color2: string;
  background: string | null;
  scale: number;
  angle: number;
  /** Mark size relative to the repeat, 0–1. */
  density: number;
  seed: number;
  text: string;
  fontFamily: string;
}

export type BrushType =
  | 'pencil' | 'graphite' | 'charcoal' | 'crayon' | 'pastel' | 'marker'
  | 'highlighter' | 'fineliner' | 'ink' | 'calligraphy' | 'watercolor'
  | 'gouache' | 'airbrush' | 'stipple' | 'gold-leaf' | 'eraser';

export interface BrushStroke {
  id: ID;
  brush: BrushType;
  color: string;
  size: number;
  opacity: number;
  flow: number;
  hardness: number;
  grain: number;
  wetness: number;
  angle: number;
  seed: number;
  points: number[];
}

export interface DrawingElement extends ElementBase {
  type: 'drawing';
  strokes: BrushStroke[];
  paperGrain: number;
}

export type LogoVariant = 'lockup' | 'stacked' | 'wordmark' | 'mark' | 'badge' | 'monogram';

/** The brand's logo, drawn from the brand kit (uploaded artwork or the generated mark + wordmark). */
export interface LogoElement extends ElementBase {
  type: 'logo';
  variant: LogoVariant;
  /** null = brand primary / ink colour. */
  color: string | null;
  /** Mark / badge accent; null = brand accent. */
  color2: string | null;
  /** Override the wordmark text (defaults to the brand name). */
  text: string | null;
}

export interface BarcodeElement extends ElementBase {
  type: 'barcode';
  symbology: 'ean13' | 'upca';
  /** Digits without the check digit (it is computed). */
  code: string;
  color: string;
  background: string | null;
  showText: boolean;
}

export type Element =
  | TextElement | ImageElement | ShapeElement | RuleElement | PathElement | SvgElement
  | GradientElement | PatternElement | DrawingElement | LogoElement | BarcodeElement;

/* ------------------------------------------------------------------------- */
/* Brand kit                                                                  */
/* ------------------------------------------------------------------------- */

export type LogoMark = 'circle' | 'leaf' | 'wave' | 'star' | 'drop' | 'bolt' | 'sun' | 'diamond' | 'arch' | 'none';

export interface BrandKit {
  name: string;
  tagline: string;
  palette: Swatch[];
  fonts: { headline: string; body: string; accent: string };
  logo: {
    /** Uploaded logo artwork (SVG or bitmap); overrides the generated logo. */
    assetId: ID | null;
    mark: LogoMark;
    monogram: string;
    weight: number;
    /** Letter spacing of the wordmark, thousandths of an em. */
    tracking: number;
    uppercase: boolean;
  };
  /** Editing a kit colour or typeface updates every design that uses it. */
  propagate: boolean;
}

/* ------------------------------------------------------------------------- */
/* Products                                                                   */
/* ------------------------------------------------------------------------- */

export type OptionValue = number | string | boolean;

export interface SurfaceArt {
  elements: Element[];
  /** Ground colour printed under the artwork (null = the substrate shows: board, metal, fabric …). */
  background: string | null;
}

export interface Product {
  id: ID;
  name: string;
  /** Template id (see src/products). */
  template: string;
  /** Template options: dimensions in pt, choices, colours, toggles. */
  options: Record<string, OptionValue>;
  /** Artwork keyed by the template's surface id. */
  surfaces: Record<string, SurfaceArt>;
}

export interface Asset {
  id: ID;
  kind: 'image' | 'svg';
  name: string;
  mime: string;
  src: string;
  width: number;
  height: number;
}

export interface UploadedFontMeta {
  id: ID;
  family: string;
  fileName: string;
  weight: number;
  italic: boolean;
}

/** User-placed ruler guides on one surface, in that surface's coordinates. */
export interface Guides { x: number[]; y: number[] }

export interface Project {
  version: 1;
  app: 'branding-studio';
  id: ID;
  name: string;
  unit: Unit;
  brand: BrandKit;
  products: Product[];
  assets: Record<ID, Asset>;
  fonts: UploadedFontMeta[];
  paragraphStyles?: ParagraphStyleDef[];
  characterStyles?: CharacterStyleDef[];
  /** Ruler guides keyed by surface (`<productId>/<surfaceId>`). */
  guides?: Record<SurfaceKey, Guides>;
  guidesHidden?: boolean;
  guidesLocked?: boolean;
}

/** `<productId>/<surfaceId>` */
export type SurfaceKey = string;
