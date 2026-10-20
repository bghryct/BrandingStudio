import { create } from 'zustand';
import type { AnimationMode, LightingPreset, LightingOptions, BackdropPreset } from '../three/types';

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
}

const DEFAULTS: SceneSettings = {
  mode: 'turntable', loop: true, speed: 1,
  lighting: 'studio', light: {}, backdrop: 'studio-sweep', color: '#dcd7cf', color2: '#b9b2a6', ground: true,
  fov: 30, panel: true, lineup: false,
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
