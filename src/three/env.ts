/**
 * Image-based lighting: studio HDRIs baked in Blender (tools/blender/studio_hdri.py → public/env)
 * — a soft studio with big softboxes and rim strips, a dramatic strip-light set and a daylight
 * room — prefiltered with PMREM, plus the procedural RoomEnvironment as a fallback. Loaded once
 * per renderer and shared.
 */
import { EquirectangularReflectionMapping, PMREMGenerator, type Texture, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type EnvPreset = 'studio-soft' | 'studio-strip' | 'daylight' | 'room';

export const ENV_PRESETS: { id: EnvPreset; label: string }[] = [
  { id: 'studio-soft', label: 'Soft studio' },
  { id: 'studio-strip', label: 'Strip lights' },
  { id: 'daylight', label: 'Daylight' },
  { id: 'room', label: 'Plain room' },
];

/** Per environment: where its key light sits (azimuth / elevation, degrees, as the light rig counts them) and a level. */
export const ENV_INFO: Record<EnvPreset, { keyAz: number; keyEl: number; intensity: number }> = {
  // Key softbox / window at d = (-0.60, 0.56, 0.58): azimuth atan2(x, z) ≈ −46°, elevation ≈ 34°.
  'studio-soft': { keyAz: -46, keyEl: 34, intensity: 0.85 },
  'studio-strip': { keyAz: -115, keyEl: 13, intensity: 1.6 },
  daylight: { keyAz: -46, keyEl: 34, intensity: 0.7 },
  room: { keyAz: -46, keyEl: 34, intensity: 0.6 },
};

/** Which environment a lighting preset uses when the environment is left on "Auto". */
export function autoEnv(lighting: string): EnvPreset {
  if (lighting === 'dramatic' || lighting === 'night') return 'studio-strip';
  if (lighting === 'window' || lighting === 'golden-hour') return 'daylight';
  return 'studio-soft';
}

const base = () => (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || './';

interface Cache { pmrem: PMREMGenerator; targets: Map<EnvPreset, Promise<WebGLRenderTarget | null>>; equirects: Map<EnvPreset, Texture> }
const caches = new WeakMap<WebGLRenderer, Cache>();

function cacheFor(r: WebGLRenderer): Cache {
  let c = caches.get(r);
  if (!c) { c = { pmrem: new PMREMGenerator(r), targets: new Map(), equirects: new Map() }; caches.set(r, c); }
  return c;
}

/** The prefiltered environment for a preset (null if the HDRI cannot be loaded: callers keep the room). */
export function loadEnvironment(renderer: WebGLRenderer, preset: EnvPreset): Promise<WebGLRenderTarget | null> {
  const c = cacheFor(renderer);
  let p = c.targets.get(preset);
  if (!p) {
    if (preset === 'room') {
      const room = new RoomEnvironment();
      const rt = c.pmrem.fromScene(room, 0.04);
      room.dispose();
      p = Promise.resolve(rt);
    } else {
      p = new HDRLoader().loadAsync(`${base()}env/${preset}.hdr`).then((tex: Texture) => {
        tex.mapping = EquirectangularReflectionMapping;
        const rt = c.pmrem.fromEquirectangular(tex);
        // Kept for the path tracer, which samples the equirect directly.
        c.equirects.set(preset, tex);
        return rt;
      }).catch((e: unknown) => { console.warn(`Environment ${preset} unavailable`, e); return null; });
    }
    c.targets.set(preset, p);
  }
  return p;
}

/** The equirect HDR of an environment, for the path tracer ('room' has none: the soft studio stands in). */
export async function environmentEquirect(renderer: WebGLRenderer, preset: EnvPreset): Promise<Texture | null> {
  const p = preset === 'room' ? 'studio-soft' : preset;
  await loadEnvironment(renderer, p);
  return cacheFor(renderer).equirects.get(p) ?? null;
}

/** Free a renderer's environments (when the scene is disposed). */
export async function disposeEnvironments(renderer: WebGLRenderer): Promise<void> {
  const c = caches.get(renderer);
  if (!c) return;
  caches.delete(renderer);
  for (const p of c.targets.values()) (await p)?.dispose();
  for (const t of c.equirects.values()) t.dispose();
  c.pmrem.dispose();
}
