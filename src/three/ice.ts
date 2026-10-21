/**
 * Ice for refreshing shots, from the Blender asset (tools/blender/ice.py → public/models/ice.glb):
 * rounded, irregular cubes with a cloudy core of bubbles and cracks, scattered on the floor around
 * the product, a bed of crushed ice the product stands in, and cubes floating in a glass.
 */
import { Color, DoubleSide, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Vector2, Vector3, type BufferGeometry } from 'three';
import { rng } from '../lib/random';
import { assetGeometry, tiledNormal } from './assets';

/**
 * Clear ice: fully transmissive at IOR 1.31 with a faint cyan body colour over its thickness, a
 * wet (clearcoated) surface and gentle melt relief, so it reads as water-clear, not frosted
 * plastic. `thickness` (asset mm) sets how far the raster refraction looks through: about half the
 * piece's size.
 */
export function iceMaterial(thickness = 12): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: 0xffffff, transmission: 1, ior: 1.31, thickness, roughness: 0.012, metalness: 0,
    attenuationColor: new Color('#d3f1f8'), attenuationDistance: 9, specularIntensity: 1, envMapIntensity: 1.3,
    clearcoat: 1, clearcoatRoughness: 0.02, side: DoubleSide,
  });
  m.normalMap = tiledNormal('ice', 1.2, 1.2);
  m.normalScale = new Vector2(0.25, 0.25);
  refractiveEdges(m, 0.8, { exponent: 1.6, internal: true });
  return m;
}

/**
 * Screen-space transmission shows only what lies straight behind; real ice and glass go dark and
 * mirror-like towards their silhouettes (total internal reflection), which is what makes them read
 * as clear solids. Darken and cool the transmitted light at grazing angles.
 *
 * `internal`: for double-sided solids. three.js draws their back faces into the transmission
 * buffer first (that pass compiles with FLIP_SIDED); inside faces met beyond the critical angle
 * reflect the dark interior instead of letting light out, so they are darkened there. Seen through
 * the front faces this gives ice its facets, dark refracted edges and depth.
 */
export function refractiveEdges(m: MeshPhysicalMaterial, strength: number, opts: { exponent?: number; internal?: boolean; drink?: { tint: Color; top: { value: number } } } = {}): void {
  const exp = opts.exponent ?? 2.2;
  const drink = opts.drink;
  m.onBeforeCompile = (shader) => {
    if (drink) {
      shader.uniforms.drinkTint = { value: drink.tint };
      shader.uniforms.drinkTop = drink.top;
      shader.fragmentShader = `uniform vec3 drinkTint;\nuniform float drinkTop;\n${shader.fragmentShader}`;
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
  float tirFacing = abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
  float tirEdge = pow( 1.0 - tirFacing, ${exp.toFixed(3)} );
  outgoingLight = mix( outgoingLight, outgoingLight * vec3( 0.42, 0.5, 0.56 ), clamp( tirEdge * ${strength.toFixed(3)}, 0.0, 1.0 ) );
${opts.internal ? `#ifdef FLIP_SIDED
  outgoingLight = mix( outgoingLight, outgoingLight * vec3( 0.12, 0.16, 0.2 ), smoothstep( 0.9, 0.4, tirFacing ) );
#endif` : ''}
${drink ? `  outgoingLight *= mix( vec3( 1.0 ), drinkTint, smoothstep( drinkTop + 0.04, drinkTop - 0.04, vWorldPosition.y ) );` : ''}
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `tir-${strength}-${exp}-${opts.internal ? 1 : 0}-${drink ? 1 : 0}`;
}

/** White internal fractures and bubble clusters (cut out, so they render with the opaque objects and show through the ice). */
export function coreMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color('#f4f9fb'), roughness: 0.45, transparent: false, opacity: 0.55, alphaHash: true, side: DoubleSide });
}

export interface IceSet {
  group: Group;
  dispose(): void;
}

function cube(i: number, mat: MeshPhysicalMaterial, core: MeshStandardMaterial, k: number): Group | null {
  const g = assetGeometry('ice', `ice_cube_${i % 4}`), c = assetGeometry('ice', `ice_core_${i % 4}`);
  if (!g) return null;
  const grp = new Group();
  const m = new Mesh(g, mat);
  m.castShadow = true;
  grp.add(m);
  if (c) { const cm = new Mesh(c, core); cm.castShadow = false; grp.add(cm); }
  grp.scale.setScalar(k);
  return grp;
}

/**
 * Cubes scattered around a product of radius `r` (pt), resting on the floor, plus (optionally) a
 * crushed-ice bed with the product in its middle. `mm` = pt per mm.
 */
export function buildIce(opts: { cubes: number; bed: boolean; productRadius: number; mm: number; seed?: number }): IceSet | null {
  const group = new Group();
  // Cubes are ~25 mm, crushed shards a few mm: each looks through about half its size.
  const mat = iceMaterial(12), shardMat = iceMaterial(7), core = coreMaterial();
  const owned: { dispose(): void }[] = [mat, shardMat, core, mat.normalMap!, shardMat.normalMap!];
  const r = rng(opts.seed ?? 7);
  const k = opts.mm; // asset units are mm
  let any = false;
  if (opts.bed) {
    const g = assetGeometry('ice', 'crushed_ice');
    if (g) {
      // The bed's hole (45 mm) fits the product; it spreads proportionally but stays a bed.
      const s = Math.max(0.6, (opts.productRadius / k + 4) / 45);
      const bed = new Mesh(g, shardMat);
      bed.scale.set(s * k, Math.min(1.4, Math.max(0.8, s)) * k, s * k);
      bed.castShadow = true;
      bed.receiveShadow = true;
      group.add(bed);
      // Cleavage planes inside some shards: white fractures in clear ice.
      const fr = assetGeometry('ice', 'crushed_ice_fractures');
      if (fr) { const fm = new Mesh(fr, core); fm.scale.copy(bed.scale); fm.castShadow = false; group.add(fm); }
      any = true;
    }
  }
  const placed: { x: number; z: number; rad: number }[] = [];
  for (let i = 0; i < opts.cubes; i++) {
    const c = cube(i, mat, core, k);
    if (!c) break;
    const rad = 16 * k;
    let x = 0, z = 0;
    for (let tries = 0; tries < 30; tries++) {
      const a = (r() - 0.5) * Math.PI * 1.7 + (i % 2 ? 0.4 : -0.4); // mostly in front and to the sides
      const d = opts.productRadius + rad * (1.3 + r() * 2.4) + (opts.bed ? 60 * k * Math.max(1, opts.productRadius / (45 * k)) * 0.75 : 0);
      x = Math.sin(a) * d; z = Math.cos(a) * d;
      if (!placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.rad + rad * 1.05)) break;
    }
    placed.push({ x, z, rad });
    c.position.set(x, 14 * k * (0.92 + r() * 0.08), z);
    c.rotation.set((r() - 0.5) * 0.35, r() * Math.PI * 2, (r() - 0.5) * 0.35);
    group.add(c);
    any = true;
  }
  if (!any) { for (const o of owned) o.dispose(); return null; }
  return { group, dispose: () => { for (const o of owned) o.dispose(); } };
}

/**
 * Ice cubes floating at a liquid level inside a glass of inner radius `ri` (pt). `drink` tints the
 * submerged part in the live view: screen-space transmission cannot see the drink around a cube
 * (both are transmissive), so the cube would show the backdrop through cola. The path tracer sees
 * the real drink and ignores this.
 */
export function iceInGlass(n: number, ri: number, k: number, seed = 3, drink?: { color: Color; distance: number }): { group: Group; setLevel(y: number, floor: number): void; dispose(): void } | null {
  if (n <= 0 || !assetGeometry('ice', 'ice_cube_0')) return null;
  const group = new Group();
  const mat = iceMaterial(), core = coreMaterial();
  const top = { value: Infinity };
  if (drink) {
    // Roughly the drink a view through a floating cube crosses: a few cm.
    const e = Math.min(8, 2.5 / Math.max(0.05, drink.distance));
    const t = drink.color; // already linear (three colour management)
    const tint = new Color(Math.pow(t.r, e), Math.pow(t.g, e), Math.pow(t.b, e));
    refractiveEdges(mat, 0.8, { exponent: 1.6, internal: true, drink: { tint, top } });
  }
  const r = rng(seed);
  const cubes: { g: Group; off: number; phase: number }[] = [];
  const s = Math.min(1, (ri * 0.62) / (15 * k));
  for (let i = 0; i < n; i++) {
    const c = cube(i + 1, mat, core, k * s)!;
    const a = (i / n) * Math.PI * 2 + r() * 0.6;
    const d = ri * (n > 1 ? 0.42 : 0);
    c.position.set(Math.sin(a) * d, 0, Math.cos(a) * d);
    c.rotation.set((r() - 0.5) * 0.9, r() * Math.PI * 2, (r() - 0.5) * 0.9);
    group.add(c);
    cubes.push({ g: c, off: (i % 2) * 9 * k * s, phase: r() });
  }
  const v = new Vector3();
  return {
    group,
    setLevel(y: number, floor: number) {
      // Floating: ~90 % submerged once the liquid can carry them, resting on the floor before.
      for (const c of cubes) c.g.position.y = Math.max(floor + 14 * k * s, y - 4 * k * s + c.off * 0.3);
      group.updateWorldMatrix(true, false);
      top.value = y > floor + 1e-6 ? v.set(0, y, 0).applyMatrix4(group.matrixWorld).y : -Infinity;
    },
    dispose: () => { mat.normalMap?.dispose(); mat.dispose(); core.dispose(); },
  };
}

export type { BufferGeometry };
