import { create } from 'zustand';
import type { AnimationMode, LightingPreset, LightingOptions, BackdropPreset, ToneMappingId } from '../three/types';
import type { EnvPreset } from '../three/env';
import type { LiquidKind } from '../three/pour';

/** 3D scene settings, remembered per browser (kept apart from the viewer so the shell can toggle the panel without loading three.js). */
interface SceneSettings {
  mode: AnimationMode;
  loop: boolean;
  speed: number;
  lighting: LightingPreset;
  light: Partial<LightingOptions>;
  backdrop: BackdropPreset;
  color: string;
  color2: string;
  ground: boolean;
  fov: number;
  panel: boolean;
  /** Show the brand's other products around the hero product. */
  lineup: boolean;
  /** Reflections and bounce light: a studio HDRI, or 'auto' (follows the lighting preset). */
  env: 'auto' | EnvPreset;
  tone: ToneMappingId;
  /** Refreshing: condensation on cans, bottles and cups. */
  dew: number;
  dewSize: number;
  drips: boolean;
  frost: number;
  /** Ice cubes on the floor, crushed-ice bed, a glass on set and its drink. */
  ice: number;
  iceBed: boolean;
  glass: boolean;
  liquid: LiquidKind;
  liquidColor: string | null;
  glassIce: number;
}

const DEFAULTS: SceneSettings = {
  mode: 'turntable', loop: true, speed: 1,
  lighting: 'studio', light: {}, backdrop: 'studio-sweep', color: '#d8d8d6', color2: '#b4b3b0', ground: true,
  fov: 30, panel: true, lineup: false,
  env: 'auto', tone: 'neutral',
  dew: 0, dewSize: 1, drips: true, frost: 0.4, ice: 0, iceBed: false, glass: false, liquid: 'cola', liquidColor: null, glassIce: 2,
};

function load(): SceneSettings {
  try {
    const raw = localStorage.getItem('brs.scene3d');
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export const useScene3D = create<SceneSettings & { set: (p: Partial<SceneSettings>) => void }>((set, get) => ({
  ...load(),
  set: (p) => {
    set(p);
    try { const { set: _s, ...rest } = { ...get(), ...p }; void _s; localStorage.setItem('brs.scene3d', JSON.stringify(rest)); } catch { /* storage unavailable */ }
  },
}));
