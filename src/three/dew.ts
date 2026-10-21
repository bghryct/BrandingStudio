/**
 * Condensation for cold drinks. A dew map is unwrapped around the product (mostly tiny droplets,
 * a few larger merged ones, a light cold haze between them and running drips that wipe clean
 * streaks) and injected into the product's own materials:
 *  - the water is a clear, glossy clearcoat layer: the droplets' normals go on the clearcoat, so
 *    each drop catches a small bright highlight and a Fresnel edge without recolouring itself;
 *  - under a drop the print is lensed (slightly magnified) and darkened towards the rim, where
 *    total internal reflection sends less light back;
 *  - between the drops the surface goes a little matte and pale (frost haze).
 * The path tracer cannot run the injected shader, so for photos the larger drops become real
 * water geometry (`photoDrops`).
 */
import {
  BufferGeometry, DataTexture, RGBAFormat, RepeatWrapping, Float32BufferAttribute, LinearFilter, Mesh, MeshPhysicalMaterial, NoColorSpace, Object3D,
  Quaternion, SphereGeometry, Vector3, Matrix4, type Material, type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../lib/random';

export interface DewOptions {
  /** 0 … 1: how much of the surface is beaded with droplets. */
  amount: number;
  /** Droplet size multiplier (0.5 … 2). */
  size: number;
  drips: boolean;
  /** 0 … 1: the matte cold haze between the drops. */
  frost: number;
}

export const DEW_OFF: DewOptions = { amount: 0, size: 1, drips: false, frost: 0 };

/** What a model offers for dew: its outer profile (revolved about y, pt) and the materials to wet. */
export interface DewTarget {
  /** [y, r] from bottom to top (pt). */
  profile: [number, number][];
  /** Height band that gets wet (pt). */
  y0: number;
  y1: number;
  materials: MeshPhysicalMaterial[];
  /** Offset of photo drops above the surface (labels on glass stand proud of it). */
  lift?: number;
}

const radiusAt = (p: [number, number][], y: number) => {
  for (let i = 0; i < p.length - 1; i++) {
    const [y0, r0] = p[i], [y1, r1] = p[i + 1];
    if (y >= y0 && y <= y1) return y1 - y0 < 1e-6 ? Math.max(r0, r1) : r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return y < p[0][0] ? p[0][1] : p[p.length - 1][1];
};

/** A drop in map pixels: centre and radius. */
interface Drop { x: number; y: number; r: number }

interface DewMap { data: Uint8Array; W: number; H: number; drops: Drop[]; k: number }

/**
 * The dew map, unwrapped: u = angle around the axis (0 at the back, ½ at the front), v = height
 * from y0 to y1, at an even density so drops stay round. RG = droplet normal (around, up), B =
 * water cover, A = frost (1 = hazy, 0 = wiped clear by a drop or a drip).
 */
function dewMap(t: DewTarget, o: DewOptions, seed: number): DewMap {
  const R = Math.max(...t.profile.filter(([y]) => y >= t.y0 && y <= t.y1).map(([, r]) => r), t.profile[0][1]);
  const C = 2 * Math.PI * R, H = t.y1 - t.y0;
  const k = Math.min(6, 4096 / Math.max(C, H)); // px per pt
  const W = Math.max(64, Math.round(C * k)), Hp = Math.max(64, Math.round(H * k));
  const h = new Float32Array(W * Hp);
  const frost = new Float32Array(W * Hp).fill(1);
  const r = rng(seed);
  const mmPx = 2.8346 * k;
  const drops: Drop[] = [];
  const stamp = (cx: number, cy: number, rad: number, height: number, clear: number) => {
    const rr = Math.ceil(rad * clear) + 1;
    const yc = Math.round(cy), xc = Math.round(cx);
    for (let dy = -rr; dy <= rr; dy++) {
      const y = yc + dy;
      if (y < 0 || y >= Hp) continue;
      for (let dx = -rr; dx <= rr; dx++) {
        const x = (((xc + dx) % W) + W) % W;
        const d = Math.hypot(dx + xc - cx, dy + yc - cy) / rad;
        const i = y * W + x;
        // A sessile drop: a flattened cap (height ∝ radius) with a fairly sharp contact edge.
        if (d < 1) h[i] = Math.max(h[i], height * Math.pow(1 - d * d, 0.6));
        if (d < clear) frost[i] = Math.min(frost[i], Math.max(0, (d - 1) / (clear - 1 + 1e-6)));
      }
    }
  };
  const area = W * Hp;
  const s = o.size;
  // Mostly fine beads (0.1–0.35 mm), some medium drops and a few larger merged ones.
  const nFine = Math.round(o.amount * area / (mmPx * mmPx * 0.9));
  for (let j = 0; j < nFine; j++) {
    const rad = mmPx * s * (0.05 + Math.pow(r(), 2) * 0.13);
    stamp(r() * W, r() * Hp, Math.max(0.7, rad), rad / mmPx, 1.25);
  }
  const nMed = Math.round(o.amount * area / (mmPx * mmPx * 14));
  for (let j = 0; j < nMed; j++) {
    const rad = mmPx * s * (0.25 + Math.pow(r(), 1.5) * 0.4);
    const x = r() * W, y = r() * Hp;
    stamp(x, y, rad, rad / mmPx, 1.5);
    drops.push({ x, y, r: rad });
  }
  const nBig = Math.round(o.amount * area / (mmPx * mmPx * 220));
  for (let j = 0; j < nBig; j++) {
    // Merged drops: two to four overlapping caps, a little elongated downwards.
    const x = r() * W, y = r() * Hp, n = 2 + Math.floor(r() * 3);
    const base = mmPx * s * (0.6 + r() * 0.6);
    for (let q = 0; q < n; q++) {
      const ox = (r() - 0.5) * base * 1.1, oy = r() * base * 0.9;
      const rad = base * (0.6 + r() * 0.4);
      stamp(x + ox, y + oy, rad, rad / mmPx, 1.8);
      drops.push({ x: x + ox, y: y + oy, r: rad });
    }
  }
  // Running drips: a channel wiped clean, a thin water film, a fat drop at the end.
  if (o.drips && o.amount > 0) {
    const nd = Math.max(2, Math.round(2 + o.amount * 4));
    for (let j = 0; j < nd; j++) {
      let x = r() * W;
      const y = r() * Hp * 0.4;
      const len = Hp * (0.25 + r() * 0.45);
      const w = mmPx * (0.45 + r() * 0.3) * s;
      for (let sy = 0; sy < len; sy += 1) {
        x += (r() - 0.5) * 0.5;
        const yy = y + sy;
        if (yy >= Hp) break;
        stamp(x, yy, w, 0.06, 2.2);
      }
      const ey = Math.min(Hp - 2, y + len), er = w * 2.2;
      stamp(x, ey, er, er / mmPx, 1.6);
      drops.push({ x, y: ey, r: er });
    }
  }
  // Raw bytes (a canvas would premultiply by the frost alpha and lose the drops' normals).
  const d = new Uint8Array(W * Hp * 4);
  // Heights are in mm: scale the per-pixel slope so a drop's edge tilts its normal steeply.
  const slope = mmPx * 0.9;
  for (let y = 0; y < Hp; y++) {
    const row = Hp - 1 - y; // texture rows run bottom-up
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const hx = h[y * W + ((x + 1) % W)] - h[y * W + ((x - 1 + W) % W)];
      const hy = h[Math.min(Hp - 1, y + 1) * W + x] - h[Math.max(0, y - 1) * W + x];
      let nx = -hx * slope, ny = hy * slope; // ny: up (y runs down here)
      const l = Math.hypot(nx, ny, 1);
      nx /= l; ny /= l;
      const o4 = (row * W + x) * 4;
      d[o4] = (nx * 0.5 + 0.5) * 255;
      d[o4 + 1] = (ny * 0.5 + 0.5) * 255;
      d[o4 + 2] = h[i] > 0.004 ? Math.min(1, 0.55 + h[i] * 4) * 255 : 0;
      d[o4 + 3] = frost[i] * 255;
    }
  }
  return { data: d, W, H: Hp, drops, k };
}

const STATE = new WeakMap<Material, { prev: Material['onBeforeCompile']; prevKey: () => string }>();

export interface DewHandle {
  /** Remove the dew (and free its map and photo drops). */
  undo(): void;
  /** Real water drops for the path tracer (the injected shader does not run there). */
  photoDrops(): Mesh | null;
  /** World directions toward the key and rim lights (each drop glints with them). */
  setLights(key: Vector3, rim: Vector3): void;
}

/** Wet a model's materials. */
export function applyDew(parent: Object3D, t: DewTarget, o: DewOptions, seed = 11): DewHandle | null {
  if (o.amount <= 0 && o.frost <= 0) return null;
  const { data, W, H, drops, k } = dewMap(t, o, seed);
  const map = new DataTexture(data, W, H, RGBAFormat);
  map.colorSpace = NoColorSpace;
  map.minFilter = LinearFilter;
  map.magFilter = LinearFilter;
  map.wrapS = RepeatWrapping;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  const uniforms = {
    dewMap: { value: map },
    dewY: { value: [t.y0, t.y1] },
    dewFrost: { value: o.frost },
    dewKeyDir: { value: new Vector3(-0.6, 0.6, 0.5).normalize() },
    dewRimDir: { value: new Vector3(0.6, 0.5, -0.6).normalize() },
  };
  for (const m of t.materials) inject(m, uniforms);
  let photo: Mesh | null = null;
  return {
    undo() {
      for (const m of t.materials) eject(m);
      map.dispose();
      if (photo) { photo.removeFromParent(); photo.geometry.dispose(); (photo.material as Material).dispose(); photo = null; }
    },
    setLights(key: Vector3, rim: Vector3) {
      uniforms.dewKeyDir.value.copy(key).normalize();
      uniforms.dewRimDir.value.copy(rim).normalize();
    },
    photoDrops() {
      if (photo) return photo;
      const geo = dropsGeometry(t, drops, W, H, k);
      if (!geo) return null;
      const mat = new MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, ior: 1.333, roughness: 0.02, metalness: 0, thickness: 1 });
      photo = new Mesh(geo, mat);
      photo.name = 'dew-photo-drops';
      photo.castShadow = false;
      photo.visible = false;
      parent.add(photo);
      return photo;
    },
  };
}

/** Flattened water caps on the surface for the medium and large drops (merged, path-tracer friendly). */
function dropsGeometry(t: DewTarget, drops: Drop[], W: number, Hp: number, k: number): BufferGeometry | null {
  if (!drops.length) return null;
  const unit = new SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const H = t.y1 - t.y0;
  const up = new Vector3(0, 1, 0), nrm = new Vector3(), pos = new Vector3(), scl = new Vector3(), q = new Quaternion(), m4 = new Matrix4();
  const parts: BufferGeometry[] = [];
  for (const dp of drops.slice(0, 2500)) {
    const ang = (dp.x / W - 0.5) * Math.PI * 2;
    const y = t.y1 - (dp.y / Hp) * H;
    const r = radiusAt(t.profile, y) + (t.lift ?? 0) + 0.01;
    const dr = radiusAt(t.profile, y + 1) - radiusAt(t.profile, y - 1);
    nrm.set(Math.sin(ang), -dr / 2, Math.cos(ang)).normalize();
    pos.set(Math.sin(ang) * r, y, Math.cos(ang) * r);
    const rad = dp.r / k;
    q.setFromUnitVectors(up, nrm);
    scl.set(rad, rad * 0.45, rad);
    m4.compose(pos, q, scl);
    const g = unit.clone();
    g.applyMatrix4(m4);
    parts.push(g);
  }
  unit.dispose();
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (merged && !merged.getAttribute('uv')) merged.setAttribute('uv', new Float32BufferAttribute(new Float32Array(merged.getAttribute('position').count * 2), 2));
  return merged;
}

function inject(m: MeshPhysicalMaterial, u: Record<string, { value: unknown }>) {
  if (STATE.has(m)) eject(m);
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  STATE.set(m, { prev, prevKey });
  // The water is a clearcoat layer: keep the layer compiled in (finishing keeps it too).
  m.userData.dewCoat = true;
  if (m.clearcoat <= 0) m.clearcoat = 1e-4;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDewPos;\nvarying vec3 vDewT;\nvarying vec3 vDewB;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  vDewPos = transformed;
  float dewA = atan( transformed.x, transformed.z );
  vDewT = normalize( normalMatrix * vec3( cos( dewA ), 0.0, - sin( dewA ) ) );
  vDewB = normalize( normalMatrix * vec3( 0.0, 1.0, 0.0 ) );`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D dewMap;
uniform vec2 dewY;
uniform float dewFrost;
uniform vec3 dewKeyDir;
uniform vec3 dewRimDir;
varying vec3 vDewPos;
varying vec3 vDewT;
varying vec3 vDewB;
vec4 dewSample() {
  float a = atan( vDewPos.x, vDewPos.z );
  vec2 uv = vec2( a / 6.28318531 + 0.5, ( vDewPos.y - dewY.x ) / ( dewY.y - dewY.x ) );
  if ( uv.y < 0.0 || uv.y > 1.0 ) return vec4( 0.5, 0.5, 0.0, 0.0 );
  return texture2D( dewMap, uv );
}`)
      .replace('#include <map_fragment>', `vec4 dew = dewSample();
vec2 dewN = dew.rg * 2.0 - 1.0;
float dewW = dew.b;
float dewRim = smoothstep( 0.35, 0.92, length( dewN ) ) * dewW;
#ifdef USE_MAP
  // The drop lenses the print under it: sample towards its centre (slight magnification).
  diffuseColor *= texture2D( map, vMapUv - dewN * 0.0045 * dewW );
#endif
  // Less light comes back out near a drop's rim (total internal reflection).
  diffuseColor.rgb *= 1.0 - 0.5 * dewRim;
  // Cold haze between the drops: a faint pale veil, not a tint.
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.93 ), dewFrost * dew.a * ( 1.0 - dewW ) * 0.12 );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix( roughnessFactor, max( roughnessFactor, 0.62 ), dewFrost * dew.a * ( 1.0 - dewW ) );`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  // Water: a clear, near-mirror coat wherever there is a drop or a drip film.
  material.clearcoat = max( material.clearcoat, dewW );
  material.clearcoatRoughness = mix( material.clearcoatRoughness, 0.06, dewW );
#endif`)
      .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
#ifdef USE_CLEARCOAT
  clearcoatNormal = normalize( clearcoatNormal + ( dewN.x * normalize( vDewT ) + dewN.y * normalize( vDewB ) ) * 1.6 * dewW );
#endif`)
      .replace('#include <opaque_fragment>', `#ifdef USE_CLEARCOAT
  // Softbox glints: each drop mirrors the key (and the rim) as a tiny, blown-out highlight, as
  // a studio photo of a cold can shows (the HDRI alone cannot be bright enough for that).
  vec3 dewV = normalize( vViewPosition );
  vec3 dewR = reflect( - dewV, clearcoatNormal );
  vec3 dewK = normalize( ( viewMatrix * vec4( dewKeyDir, 0.0 ) ).xyz );
  vec3 dewQ = normalize( ( viewMatrix * vec4( dewRimDir, 0.0 ) ).xyz );
  float dewG = pow( max( dot( dewR, dewK ), 0.0 ), 220.0 ) * 6.0 + pow( max( dot( dewR, dewQ ), 0.0 ), 140.0 ) * 2.0;
  outgoingLight += vec3( dewG ) * dewW * smoothstep( 0.15, 0.6, length( dewN ) + 0.2 );
#endif
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `${prevKey()}|dew4`;
  m.needsUpdate = true;
}

function eject(m: MeshPhysicalMaterial) {
  const s = STATE.get(m);
  if (!s) return;
  m.onBeforeCompile = s.prev;
  m.customProgramCacheKey = s.prevKey;
  delete m.userData.dewCoat;
  if (m.clearcoat === 1e-4) m.clearcoat = 0;
  STATE.delete(m);
  m.needsUpdate = true;
}
