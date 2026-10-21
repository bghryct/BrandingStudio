import { Group, Mesh, type Material, type Object3D, type Texture } from 'three';
import type { Dieline, Opts } from '../../products/types';
import type { SurfaceTextures } from '../types';
import type { Composite } from '../finishing';
import type { DewTarget } from '../dew';
import type { PourSource } from '../pour';

export interface PoseParams {
  /** 0 = flat sheet … 1 = assembled (cartons, pillow). */
  fold: number;
  /** 0 = closed … 1 = open / pulled out (tube lid, sleeve tray). */
  open: number;
  /** Rotation of a rolling product about its own axis (rad). */
  roll: number;
  /** Pour progress (0 = not pouring … 1): bottles drop their closure and empty. */
  pour?: number;
}

export interface ModelInput {
  template: string;
  options: Opts;
  dieline: Dieline;
  /** Scene units per pt (thickness and attenuation distances in physical units). */
  scale: number;
  anisotropy: number;
}

export interface ProductModel {
  readonly group: Group;
  pose(p: PoseParams): void;
  applyTextures(tex: SurfaceTextures): void;
  dispose(): void;
  info: {
    /** Lies on the ground rather than standing (cards, letterhead, pillow). */
    lying?: boolean;
    /** Radius of a cylinder that can roll on its side (cans). */
    rollRadius?: number;
    hasFold?: boolean;
    hasOpen?: boolean;
    /** Revolved outer surface and materials that take condensation. */
    dew?: DewTarget;
    /** Where it pours from (cans and bottles). */
    pour?: PourSource;
  };
}

/** Owns GPU resources of a model so dispose() frees them all. */
export class Bag {
  private readonly items = new Set<{ dispose(): void }>();
  composites = new Map<string, Composite>();
  add<T extends { dispose(): void }>(x: T): T { this.items.add(x); return x; }
  mesh(geometry: Mesh['geometry'], material: Material | Material[], parent?: Object3D, shadow = true): Mesh {
    const m = new Mesh(geometry, material);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    this.add(geometry);
    for (const mat of Array.isArray(material) ? material : [material]) this.add(mat);
    parent?.add(m);
    return m;
  }
  texture(t: Texture): Texture { this.items.add(t); return t; }
  setComposite(key: string, c: Composite) { this.composites.get(key)?.dispose(); this.composites.set(key, c); }
  dispose() {
    for (const x of this.items) x.dispose();
    this.items.clear();
    for (const c of this.composites.values()) c.dispose();
    this.composites.clear();
  }
}
