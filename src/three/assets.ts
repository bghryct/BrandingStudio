/**
 * Shared 3D assets built in Blender (tools/blender → public/models, public/textures): cloth-
 * simulated garments and tote, ice cubes and crushed ice, and tileable material normal maps
 * (jersey, canvas, fleece, paper, kraft, brushed metal, ice). Models are built synchronously, so
 * the viewer preloads these; a model whose asset is not in yet falls back to its procedural form
 * and is rebuilt when the asset arrives (`assetVersion`).
 */
import { Mesh, NoColorSpace, RepeatWrapping, TextureLoader, type BufferGeometry, type Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const base = () => (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || './';

export type DetailMap = 'jersey' | 'canvas' | 'fleece' | 'paper' | 'kraft' | 'brushed' | 'ice';

const textures = new Map<DetailMap, Texture>();
const loader = new TextureLoader();

/** A tileable normal map (shared source; clone it to give it its own repeat). */
export function detailNormal(name: DetailMap): Texture {
  let t = textures.get(name);
  if (!t) {
    t = loader.load(`${base()}textures/${name}-normal.png`, () => { assetVersion.value++; });
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = NoColorSpace;
    t.anisotropy = 8;
    textures.set(name, t);
  }
  return t;
}

/** A clone of a detail normal map tiled `rx` × `ry` times over the UV square. */
export function tiledNormal(name: DetailMap, rx: number, ry: number): Texture {
  const t = detailNormal(name).clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

export type ModelAsset = 'tee' | 'hoodie' | 'tote' | 'ice';

const gltfs = new Map<ModelAsset, GLTF | null>();
const pending = new Map<ModelAsset, Promise<GLTF | null>>();

/** Bumps when an asset finishes loading (the viewer rebuilds its models). */
export const assetVersion = { value: 0 };

export function loadModelAsset(name: ModelAsset): Promise<GLTF | null> {
  let p = pending.get(name);
  if (!p) {
    p = new GLTFLoader().loadAsync(`${base()}models/${name}.glb`)
      .then((g) => { gltfs.set(name, g); assetVersion.value++; return g; })
      .catch((e: unknown) => { console.warn(`3D asset ${name} unavailable`, e); gltfs.set(name, null); return null; });
    pending.set(name, p);
  }
  return p;
}

/** The asset if it has loaded (undefined while loading, null if it failed). */
export function modelAsset(name: ModelAsset): GLTF | null | undefined {
  if (!gltfs.has(name)) void loadModelAsset(name);
  return gltfs.get(name);
}

/** A named mesh's geometry from a loaded asset (shared: clone before changing it). */
export function assetGeometry(name: ModelAsset, mesh: string): BufferGeometry | null {
  const g = modelAsset(name);
  if (!g) return null;
  let found: BufferGeometry | null = null;
  g.scene.traverse((o) => { if (!found && (o as Mesh).isMesh && (o.name === mesh || o.parent?.name === mesh)) found = (o as Mesh).geometry; });
  return found;
}

/** The meshes (one per material slot) of an asset's object. */
export function assetMeshes(name: ModelAsset, object: string): Mesh[] {
  const g = modelAsset(name);
  if (!g) return [];
  const out: Mesh[] = [];
  g.scene.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    let p: typeof o | null = o;
    while (p && p.name !== object) p = p.parent;
    if (p) out.push(o as Mesh);
  });
  return out;
}

export function preloadAssets(): Promise<unknown> {
  for (const n of ['jersey', 'canvas', 'fleece', 'paper', 'kraft', 'ice'] as DetailMap[]) detailNormal(n);
  return Promise.all((['tee', 'hoodie', 'tote', 'ice'] as ModelAsset[]).map(loadModelAsset));
}
