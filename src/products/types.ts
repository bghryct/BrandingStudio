/**
 * Dieline model shared by the templates, the flat editor, the PDF writer and the 3D builders.
 * Every coordinate is in pt, in the surface's own space (origin = top-left of the cut's bounding
 * box, y down). Polygons are closed implicitly.
 */
import type { OptionValue } from '../model/types';

export interface P2 { x: number; y: number }

export type PanelRole = 'face' | 'side' | 'lid' | 'tuck' | 'dust' | 'glue' | 'gusset' | 'band' | 'zone';

export interface DielinePanel {
  id: string;
  label: string;
  /** Bounding rectangle of the panel (anchoring origin = x, y). */
  x: number; y: number; w: number; h: number;
  /** Exact outline when the panel is not a rectangle. */
  poly?: P2[];
  role: PanelRole;
  /** Safe-area inset from the panel edges, pt (0 = none drawn). */
  safe: number;
  /** Clockwise rotation (deg) to apply to artwork so it reads upright on the folded product. */
  read?: 0 | 90 | 180 | 270;
}

export type FoldKind = 'fold' | 'reverse' | 'perf' | 'crease';

export interface FoldLine {
  /** Polyline (two points for a straight fold). */
  pts: P2[];
  kind: FoldKind;
}

export type ZoneKind = 'glue' | 'distortion' | 'seam' | 'seal' | 'nonprint' | 'print-area' | 'window' | 'barcode' | 'info';

export interface Zone {
  kind: ZoneKind;
  label: string;
  poly: P2[];
}

export interface Dimension {
  a: P2;
  b: P2;
  /** Offset of the dimension line from the measured edge, pt (sign = side). */
  offset: number;
  label?: string;
}

export interface DielineSurface {
  id: string;
  label: string;
  /** Bounding box of the cut outline. */
  w: number;
  h: number;
  bleed: number;
  /** Pieces of material: their union is the die-cut shape (one polygon for simple surfaces). */
  cut: P2[][];
  /** Windows and holes cut out of the material. */
  holes?: P2[][];
  /** Cut line shape kind: 'rect' surfaces get crop marks; 'die' needs a die (CutContour). */
  cutKind: 'rect' | 'die' | 'none';
  folds: FoldLine[];
  panels: DielinePanel[];
  zones: Zone[];
  dims: Dimension[];
  /** Substrate colour shown under the art when the surface has no ground colour. */
  substrate: string;
  /** Default printed ground for new products (null = substrate shows). */
  defaultGround: string | null;
  /** The surface is a print area on a garment / object, shown with that object as context. */
  context?: { d: string; fill: string; stroke: string; label?: string };
  notes?: string[];
  /** Folding carton: the hinge tree the 3D view folds (net coordinates). */
  net?: NetNode[];
}

/** One panel of a folding net: its outline, the hinge it turns about, and when it folds. */
export interface NetNode {
  id: string;
  poly: P2[];
  parent: string | null;
  /** Hinge edge shared with the parent (net coordinates). */
  hinge: [P2, P2] | null;
  /** Folded angle, degrees (90 = square fold away from the printed side). */
  angle: number;
  /** Fraction of the fold-up animation during which this hinge turns. */
  stage: [number, number];
}

export interface Dieline {
  surfaces: DielineSurface[];
  /** Key facts for the inspector (capacity, flat size, board …). */
  specs: { label: string; value: string }[];
}

/* -------------------------------------------------------------------------- */
/* Template definitions                                                        */
/* -------------------------------------------------------------------------- */

export type OptionKind = 'length' | 'number' | 'select' | 'color' | 'toggle' | 'slider';

export interface OptionSpec {
  key: string;
  label: string;
  group: 'Size' | 'Construction' | 'Material' | 'Print' | 'Contents' | 'Closure';
  kind: OptionKind;
  default: OptionValue;
  min?: number;
  max?: number;
  step?: number;
  choices?: { value: string; label: string }[];
  hint?: string;
  /** Show only when this returns true. */
  when?: (o: Record<string, OptionValue>) => boolean;
  /** Format a slider value. */
  format?: (v: number) => string;
}

export type TemplateCategory = 'Cans' | 'Bottles' | 'Perfume' | 'Boxes' | 'Packaging' | 'Bags' | 'Apparel' | 'Drinkware' | 'Stationery';

export interface ProductTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  options: OptionSpec[];
  dieline: (o: Record<string, OptionValue>) => Dieline;
  /** Options that follow when one option changes (e.g. label sizes when the bottle changes). */
  adjust?: (key: string, o: Record<string, OptionValue>) => Record<string, OptionValue>;
  /** Animations that make sense for this product, first = default. */
  animations: string[];
}

export type Opts = Record<string, OptionValue>;

export const num = (o: Opts, k: string, d = 0): number => (typeof o[k] === 'number' ? (o[k] as number) : d);
export const str = (o: Opts, k: string, d = ''): string => (typeof o[k] === 'string' ? (o[k] as string) : d);
export const bool = (o: Opts, k: string, d = false): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d);
