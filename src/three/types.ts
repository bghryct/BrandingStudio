/** Scene options shared by the 3D mockup, the viewer UI and the video exporter. */

export type LightingPreset = 'studio' | 'soft-box' | 'window' | 'golden-hour' | 'dramatic' | 'top-down' | 'overcast' | 'gallery' | 'night';

export interface LightingOptions {
  preset?: LightingPreset;
  intensity?: number;
  /** Key light around the product, degrees: 0 = front, 90 = right, −90 = left. */
  azimuth?: number;
  elevation?: number;
  warmth?: number;
  exposure?: number;
  shadowSoftness?: number;
  ambient?: number;
}

export type BackdropPreset = 'solid' | 'gradient' | 'studio-sweep' | 'wood' | 'linen' | 'concrete' | 'paper' | 'marble' | 'felt' | 'transparent';

export interface BackdropOptions {
  preset: BackdropPreset;
  color?: string;
  color2?: string;
  showGround?: boolean;
}

export type AnimationMode =
  | 'none' | 'turntable' | 'hero' | 'roll' | 'float' | 'reveal' | 'fold' | 'slide' | 'sway' | 'spin' | 'open' | 'pour' | 'fizz';

export interface AnimationOptions {
  /** Seconds (defaults per mode). */
  duration?: number;
  loop?: boolean;
}

export interface AnimationInfo {
  id: AnimationMode;
  label: string;
  duration: number;
  description: string;
}

export type ToneMappingId = 'neutral' | 'agx' | 'aces';

export interface CameraOptions {
  /** Vertical field of view, degrees 15–75. */
  fov?: number;
}

/** Finish masks the 3D materials understand. */
export type FinishKey = 'gold-foil' | 'silver-foil' | 'copper-foil' | 'holo-foil' | 'blind-deboss' | 'emboss' | 'spot-gloss' | 'white-base';

/** One rendered surface: the artwork canvas covers the bleed box (−bleed … w + bleed). */
export interface SurfaceTexture {
  art: HTMLCanvasElement;
  /** Finish masks, same size and layout as `art`. */
  masks: Partial<Record<FinishKey, HTMLCanvasElement>>;
  /** Surface box the canvas covers (pt): x, y = −bleed. */
  box: { x: number; y: number; w: number; h: number };
  /** Opaque coverage of the art (alpha), same layout — for clear substrates. */
  hasGround: boolean;
}

export type SurfaceTextures = Record<string, SurfaceTexture>;
