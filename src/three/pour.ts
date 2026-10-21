/**
 * The pour: a drinking glass beside the product, which the can or bottle tilts over and fills —
 * an animated liquid stream (a tapering tube along the ballistic arc with a scrolling flow
 * normal map), the level rising with a meniscus, carbonation bubbles, a foam head for beer-type
 * drinks, a splash where the stream lands, and ice in the glass. Everything is a pure function of
 * the pour progress and the time, so the timeline, scrubbing and video export agree frame by frame.
 */
import {
  CanvasTexture, CatmullRomCurve3, Color, CylinderGeometry, DoubleSide, DynamicDrawUsage, FrontSide, Group, InstancedMesh, LatheGeometry, Matrix4, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, NoColorSpace, Quaternion, RepeatWrapping, SphereGeometry, TubeGeometry, Vector2, Vector3,
  type BufferGeometry,
} from 'three';
import { rng, fbm } from '../lib/random';
import { mm } from '../model/units';
import { createCanvas, context2d } from './texutil';
import { ShaderChunk } from 'three';
import { glassMaterial } from './build';
import { iceInGlass, refractiveEdges } from './ice';

export type LiquidKind = 'cola' | 'lager' | 'juice' | 'water' | 'sparkling';

/**
 * Drinks. `color` is the colour light takes on through the drink (attenuation) and `distance` how
 * far (scene cm) it travels to reach that colour: cola is near-black through the glass but amber at
 * its thin edges and in the stream; lager golden; juice cloudy.
 */
export const LIQUIDS: Record<LiquidKind, { label: string; color: string; distance: number; bubbles: number; foam: number; foamColor: string; cloudy: number }> = {
  cola: { label: 'Cola', color: '#7a3510', distance: 0.75, bubbles: 0.7, foam: 2.5, foamColor: '#eadcc3', cloudy: 0 },
  lager: { label: 'Lager', color: '#f0b23a', distance: 3.2, bubbles: 1, foam: 20, foamColor: '#f8f2e4', cloudy: 0.04 },
  juice: { label: 'Juice', color: '#f69420', distance: 0.6, bubbles: 0, foam: 0, foamColor: '#ffd9a0', cloudy: 0.6 },
  water: { label: 'Water', color: '#eef8f8', distance: 300, bubbles: 0, foam: 0, foamColor: '#ffffff', cloudy: 0 },
  sparkling: { label: 'Sparkling', color: '#f2faf5', distance: 300, bubbles: 1.5, foam: 1, foamColor: '#ffffff', cloudy: 0 },
};

/**
 * Screen-space transmission uses one thickness for the whole object; scale it with how squarely
 * the surface faces the viewer, so a drink is thin (and lighter) at its edges and thick in the
 * middle, as real light paths are.
 */
function thinEdges(m: MeshPhysicalMaterial): void {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <transmission_fragment>', ShaderChunk.transmission_fragment.replace(
      'material.thickness = thickness;',
      'material.thickness = thickness * clamp( abs( dot( normalize( normal ), normalize( vViewPosition ) ) ), 0.06, 1.0 );',
    ));
  };
  m.customProgramCacheKey = () => 'thin-edges';
}

/** A tileable foam texture: packed small bubbles (normals) for a head of foam. */
function foamNormal(): CanvasTexture {
  const S = 256;
  const c = createCanvas(S, S);
  const ctx = context2d(c);
  const h = new Float32Array(S * S);
  const r = rng(77);
  for (let k = 0; k < 900; k++) {
    const cx = r() * S, cy = r() * S, rad = 2 + Math.pow(r(), 2) * 9;
    for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
      const d = Math.hypot(dx, dy) / rad;
      if (d >= 1) continue;
      const x = ((Math.floor(cx) + dx) % S + S) % S, y = ((Math.floor(cy) + dy) % S + S) % S;
      h[y * S + x] = Math.max(h[y * S + x], Math.sqrt(1 - d * d) * rad / 9);
    }
  }
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h[y * S + (x + 1) % S] - h[y * S + (x - 1 + S) % S], dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
    const nx = -dx * 3, ny = dy * 3, l = Math.hypot(nx, ny, 1);
    const o = 4 * (y * S + x);
    img.data[o] = (nx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export interface PourOptions {
  liquid: LiquidKind;
  /** Overrides the drink's own colour. */
  color?: string | null;
  /** Ice cubes in the glass. */
  ice: number;
}

/** What the pouring product offers: its mouth (local, pt) and radius. */
export interface PourSource {
  mouth: Vector3;
  radius: number;
  height: number;
  /** Stream radius at the mouth (pt). */
  stream: number;
}

const smooth = (t: number) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A tileable flow-noise normal map, stretched along the stream. */
function flowNormal(): CanvasTexture {
  const W = 128, H = 128;
  const c = createCanvas(W, H);
  const ctx = context2d(c);
  const img = ctx.createImageData(W, H);
  const h = (x: number, y: number) => fbm((x / W) * 4, (y / H) * 4, 3, 5);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = h((x + 1) % W, y) - h((x - 1 + W) % W, y), dy = h(x, (y + 1) % H) - h(x, (y - 1 + H) % H);
    const nx = -dx * 3, ny = -dy * 3, l = Math.hypot(nx, ny, 1);
    const o = 4 * (y * W + x);
    img.data[o] = (nx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export class PourRig {
  readonly group = new Group();
  /** Where the glass stands (pt, set coordinates). */
  readonly glassPos = new Vector3();
  private readonly owned: { dispose(): void }[] = [];
  private readonly liquidMat: MeshPhysicalMaterial;
  private readonly liquidMesh: Mesh;
  private readonly surfaceMesh: Mesh;
  private readonly foam: Mesh;
  private readonly foamTop: Mesh;
  private readonly streamMesh: Mesh;
  private readonly streamMat: MeshPhysicalMaterial;
  private readonly bubbles: InstancedMesh;
  private readonly splash: InstancedMesh;
  private readonly ice: ReturnType<typeof iceInGlass>;
  private readonly bubbleSeeds: { a: number; r: number; v: number; ph: number; s: number }[] = [];
  private readonly splashSeeds: { a: number; v: number; up: number; ph: number; s: number }[] = [];
  /** Glass shape (pt): inner radius at a height, inner floor, rim height, outer radius. */
  readonly rIn: (y: number) => number;
  readonly floor: number;
  readonly top: number;
  readonly radius: number;
  private readonly kind: (typeof LIQUIDS)[LiquidKind];
  private lastLevel = -1;

  constructor(private readonly src: PourSource, readonly opts: PourOptions) {
    const kind = LIQUIDS[opts.liquid] ?? LIQUIDS.cola;
    this.kind = kind;
    const pint = opts.liquid === 'lager';
    // Glass: a tumbler, or a tapered pint for beer.
    const Rb = mm(pint ? 30 : 33), Rt = mm(pint ? 43 : 40), Hg = mm(pint ? 150 : 108), wall = mm(pint ? 3 : 2.6), base = mm(pint ? 9 : 11);
    this.top = Hg; this.floor = base; this.radius = Rt;
    const rOut = (y: number) => Rb + ((Rt - Rb) * y) / Hg;
    this.rIn = (y: number) => rOut(y) - wall;
    // Solid shell: outer wall, rounded rim, inner wall, inner floor.
    const prof: [number, number][] = [[mm(1.2), 0], [0, Rb * 0.7], [0, Rb - mm(2)], [mm(1.5), Rb - mm(0.2)], [mm(4), rOut(mm(4))], [Hg - mm(1), rOut(Hg - mm(1))]];
    for (let i = 1; i <= 6; i++) { const a = (i / 6) * Math.PI; prof.push([Hg - mm(1) + Math.sin(a) * wall * 0.55, rOut(Hg) - wall / 2 + Math.cos(a) * wall / 2]); }
    prof.push([Hg - mm(2), this.rIn(Hg - mm(2))], [base + mm(2), this.rIn(base + mm(2))], [base, this.rIn(base) - mm(2)], [base - mm(0.6), 0]);
    const shell = new LatheGeometry(prof.map(([y, r]) => new Vector2(Math.max(0.001, r), y)), 96);
    // Front faces only: as a double-sided transmissive object, the glass's inner wall would be
    // drawn into the transmission buffer in front of the drink and hide it.
    const glass = glassMaterial('flint', wall, 1 / mm(10), FrontSide);
    glass.thickness = wall * 2;
    refractiveEdges(glass, 0.3);
    const shellMesh = new Mesh(shell, glass);
    shellMesh.castShadow = false;
    shellMesh.receiveShadow = true;
    this.group.add(shellMesh);
    this.owned.push(shell, glass);

    // Liquid body (rebuilt as the level rises) and its surface with a meniscus.
    const col = new Color(opts.color || kind.color);
    this.liquidMat = new MeshPhysicalMaterial({
      color: kind.cloudy > 0.3 ? col.clone() : new Color(0xffffff), transmission: 1 - kind.cloudy * 0.8, ior: 1.333, roughness: 0.02, metalness: 0,
      thickness: Rt * 2, attenuationColor: col, attenuationDistance: kind.distance, side: DoubleSide, specularIntensity: 1,
    });
    thinEdges(this.liquidMat);
    this.liquidMesh = new Mesh(new CylinderGeometry(1, 1, 1, 8), this.liquidMat);
    this.surfaceMesh = new Mesh(this.meniscus(1), this.liquidMat);
    this.liquidMesh.castShadow = this.surfaceMesh.castShadow = false;
    this.group.add(this.liquidMesh, this.surfaceMesh);
    this.owned.push(this.liquidMat);

    // Foam head: a layer of small bubbles (a thin light-tan fizz on cola, a creamy head on lager).
    const foamTex = foamNormal();
    foamTex.repeat.set(6, kind.foam > 8 ? 2 : 0.6);
    const foamMat = new MeshPhysicalMaterial({ color: new Color(kind.foamColor), roughness: 0.55, sheen: 0.6, sheenColor: new Color('#ffffff'), sheenRoughness: 0.5, normalMap: foamTex, normalScale: new Vector2(0.9, 0.9), clearcoat: 0.4, clearcoatRoughness: 0.3 });
    this.owned.push(foamTex);
    const foamGeo = new CylinderGeometry(1, 1, 1, 64, 1, true);
    foamGeo.translate(0, 0.5, 0);
    this.foam = new Mesh(foamGeo, foamMat);
    const topGeo = new LatheGeometry([0, 0.3, 0.6, 0.85, 1].map((r, i) => new Vector2(Math.max(0.001, r), [1.12, 1.1, 1.06, 0.98, 0.85][i] - 0.85)), 64);
    this.foamTop = new Mesh(topGeo, foamMat);
    this.group.add(this.foam, this.foamTop);
    this.owned.push(foamGeo, topGeo, foamMat);

    // Stream.
    const flow = flowNormal();
    this.streamMat = new MeshPhysicalMaterial({
      color: kind.cloudy > 0.3 ? col.clone() : new Color(0xffffff), transmission: 1 - kind.cloudy * 0.7, ior: 1.333, roughness: 0.01, thickness: src.stream * 2,
      attenuationColor: col, attenuationDistance: kind.distance * 0.5, side: DoubleSide, normalMap: flow, normalScale: new Vector2(0.45, 0.45), specularIntensity: 1,
      clearcoat: 1, clearcoatRoughness: 0.02,
    });
    thinEdges(this.streamMat);
    flow.repeat.set(3, 1);
    this.streamMesh = new Mesh(new CylinderGeometry(1, 1, 1, 8), this.streamMat);
    this.streamMesh.castShadow = false;
    this.streamMesh.frustumCulled = false;
    this.group.add(this.streamMesh);
    this.owned.push(flow, this.streamMat);

    // Bubbles: bright specks rising (opaque, so they read through the glass), part of them in
    // nucleation trains from the floor of the glass.
    const r = rng(29);
    const nb = Math.round(320 * kind.bubbles);
    const bubbleMat = new MeshStandardMaterial({ color: new Color('#ffffff'), roughness: 0.05, metalness: 0, emissive: new Color('#fff8ec'), emissiveIntensity: 0.55 });
    const bubbleGeo = new SphereGeometry(1, 8, 6);
    this.bubbles = new InstancedMesh(bubbleGeo, bubbleMat, Math.max(1, nb));
    this.bubbles.count = nb;
    this.bubbles.instanceMatrix.setUsage(DynamicDrawUsage);
    this.bubbles.castShadow = false;
    this.bubbles.frustumCulled = false;
    // Most bubbles rise in columns from a dozen nucleation points on the floor and walls; the
    // rest drift up on their own. All fine (0.1–0.3 mm), growing a little as they rise.
    const columns = Array.from({ length: 12 }, () => ({ a: r() * Math.PI * 2, rr: 0.15 + r() * 0.8 }));
    for (let i = 0; i < nb; i++) {
      const col2 = i < nb * 0.85 ? columns[i % columns.length] : null;
      this.bubbleSeeds.push({
        a: col2 ? col2.a + (r() - 0.5) * 0.03 : r() * Math.PI * 2,
        r: col2 ? col2.rr : Math.sqrt(r()) * 0.9,
        v: mm(col2 ? 30 + r() * 10 : 14 + r() * 26), ph: col2 ? (i / nb + r() * 0.02) % 1 : r(), s: mm(0.1 + Math.pow(r(), 2) * 0.2),
      });
    }
    this.group.add(this.bubbles);
    this.owned.push(bubbleGeo, bubbleMat);

    // Splash droplets.
    const splashMat = new MeshPhysicalMaterial({ color: kind.cloudy > 0.3 ? col.clone() : new Color(col).lerp(new Color('#ffffff'), 0.4), roughness: 0.05, transmission: 0.6 - kind.cloudy * 0.4, ior: 1.333, thickness: mm(1), attenuationColor: col, attenuationDistance: 2 });
    const splashGeo = new SphereGeometry(1, 8, 6);
    this.splash = new InstancedMesh(splashGeo, splashMat, 40);
    this.splash.instanceMatrix.setUsage(DynamicDrawUsage);
    this.splash.castShadow = false;
    this.splash.frustumCulled = false;
    for (let i = 0; i < 40; i++) this.splashSeeds.push({ a: r() * Math.PI * 2, v: mm(60 + r() * 140), up: mm(260 + r() * 420), ph: r(), s: mm(0.5 + r() * 1.1) });
    this.group.add(this.splash);
    this.owned.push(splashGeo, splashMat);

    // Ice in the glass.
    this.ice = iceInGlass(Math.min(5, Math.max(0, Math.round(opts.ice))), this.rIn(Hg * 0.5), mm(1), 3, { color: col, distance: kind.distance });
    if (this.ice) { this.group.add(this.ice.group); this.owned.push(this.ice); }
  }

  /** Liquid surface: flat, rising into a meniscus against the glass (unit radius, y at 0). */
  private meniscus(r: number): BufferGeometry {
    const pts = [0, 0.5, 0.8, 0.92, 0.97, 1].map((t, i) => new Vector2(Math.max(0.001, t * r), [0, 0, 0.02, 0.06, 0.12, 0.22][i] * mm(4)));
    return new LatheGeometry(pts, 64);
  }

  /** Place the glass beside a product of radius `r` standing at the origin. */
  place(productRadius: number): void {
    this.glassPos.set(productRadius + this.radius + mm(30), 0, mm(12));
    this.group.position.copy(this.glassPos);
  }

  /** Mouth position for the pour at progress p (set coordinates) and the product's tilt. */
  productPose(p: number): { position: Vector3; tilt: number; pouring: number } {
    // Swing in from above (0–0.14), pour, tilting further as it empties (0.14–0.72), lift off
    // (0.72–0.79), then turn upright and set down (0.79–0.9); the glass stays full after that.
    const inK = smooth(p / 0.14), up = smooth((p - 0.72) / 0.07), outK = smooth((p - 0.79) / 0.11);
    const pourK = clamp01((p - 0.14) / 0.58);
    const theta = inK * (1 - outK) * (1.62 + 0.42 * pourK);
    const lift = inK * (1 - outK);
    const m = this.src.mouth;
    // The mouth just above the rim, a little inside it — and well above it whenever the product
    // is turning, so it never sweeps through the glass.
    const clear = this.src.height * 0.35 * Math.max(1 - inK, up);
    const target = new Vector3(this.glassPos.x - this.radius * 0.38, this.top + mm(22) + mm(10) * (1 - pourK) + clear, this.glassPos.z);
    const c = Math.cos(-theta), s = Math.sin(-theta);
    const rotated = new Vector3(m.x * c - m.y * s, m.x * s + m.y * c, m.z);
    const posePour = target.clone().sub(rotated);
    // Up first, then across (and back across before coming down), so the path clears the glass.
    const ky = inK < 1 ? smooth(inK / 0.55) : 1 - smooth((outK - 0.45) / 0.55);
    const kx = inK < 1 ? smooth((inK - 0.35) / 0.65) : 1 - smooth(outK / 0.6);
    const position = new Vector3(posePour.x * kx, posePour.y * ky, posePour.z * Math.max(kx, ky));
    void lift;
    const pouring = clamp01((p - 0.16) / 0.04) * (1 - clamp01((p - 0.68) / 0.05));
    return { position, tilt: theta, pouring };
  }

  /** Pose everything for pour progress p (0 … 1) at time t (s); `mouthWorld` = the mouth in set coordinates. */
  update(p: number, t: number, mouthWorld: Vector3 | null, tilt: number): void {
    const kind = this.kind;
    const pourK = clamp01((p - 0.16) / 0.56);
    const fillTo = this.floor + (this.top - this.floor) * 0.86;
    const level = this.floor + (fillTo - this.floor) * smooth(pourK) * (p <= 0 ? 0 : 1);
    const depth = level - this.floor;
    // Liquid body as a lathe up the inner wall.
    if (Math.abs(level - this.lastLevel) > 1e-3) {
      this.lastLevel = level;
      this.liquidMesh.geometry.dispose();
      if (depth > mm(0.5)) {
        const pts: Vector2[] = [new Vector2(0.001, this.floor + mm(0.05)), new Vector2(this.rIn(this.floor) - mm(2.3), this.floor + mm(0.05))];
        for (let i = 0; i <= 6; i++) { const y = this.floor + mm(1.5) + ((level - this.floor - mm(1.5)) * i) / 6; pts.push(new Vector2(this.rIn(y) - mm(0.15), y)); }
        pts.push(new Vector2(0.001, level));
        this.liquidMesh.geometry = new LatheGeometry(pts, 64);
        this.liquidMesh.visible = true;
      } else { this.liquidMesh.geometry = new CylinderGeometry(1, 1, 1, 8); this.liquidMesh.visible = false; }
    }
    const rl = this.rIn(level) - mm(0.15);
    this.surfaceMesh.visible = depth > mm(0.5);
    this.surfaceMesh.geometry.dispose();
    this.surfaceMesh.geometry = this.meniscus(rl);
    this.surfaceMesh.position.y = level;
    // Foam: builds during the pour, settles a little after.
    const foamH = mm(kind.foam) * smooth(pourK * 1.3) * (1 - 0.25 * clamp01((p - 0.75) / 0.25)) * (depth > mm(5) ? 1 : 0);
    this.foam.visible = this.foamTop.visible = foamH > mm(0.4);
    if (this.foam.visible) {
      const rf = this.rIn(level + foamH / 2) - mm(0.2);
      this.foam.scale.set(rf, foamH, rf);
      this.foam.position.y = level;
      this.foamTop.scale.set(rf, Math.max(mm(2), foamH * 0.4), rf);
      this.foamTop.position.y = level + foamH;
      this.surfaceMesh.visible = false;
    }
    // Bubbles rise through the liquid (and cling to the walls), more while it is poured.
    const m4 = new Matrix4(), q = new Quaternion(), pos = new Vector3(), scl = new Vector3();
    const live = depth > mm(4);
    const fizz = 0.55 + 0.45 * Math.sin(t * 0.7);
    for (let i = 0; i < this.bubbleSeeds.length; i++) {
      const b = this.bubbleSeeds[i];
      if (!live || (i % 3 === 2 && fizz < 0.5)) { m4.makeScale(0, 0, 0); this.bubbles.setMatrixAt(i, m4); continue; }
      const f = (b.ph + (t * b.v) / Math.max(mm(10), depth)) % 1;
      const y = this.floor + mm(1) + f * (depth - mm(1.5));
      const rr = b.r * (this.rIn(y) - mm(1));
      pos.set(Math.sin(b.a + f * 0.3) * rr, y, Math.cos(b.a + f * 0.3) * rr);
      const s = b.s * (0.7 + f * 0.6);
      scl.set(s, s, s);
      m4.compose(pos, q, scl);
      this.bubbles.setMatrixAt(i, m4);
    }
    this.bubbles.instanceMatrix.needsUpdate = true;
    // Stream along the ballistic arc from the mouth to the surface.
    const pouring = clamp01((p - 0.16) / 0.04) * (1 - clamp01((p - 0.68) / 0.05));
    this.streamMesh.visible = pouring > 0.01 && !!mouthWorld;
    let impact: Vector3 | null = null;
    if (this.streamMesh.visible && mouthWorld) {
      const local = mouthWorld.clone().sub(this.group.position);
      const g = mm(9810);
      const dir = new Vector3(Math.sin(tilt), Math.cos(tilt), 0).normalize();
      const v0 = dir.multiplyScalar(mm(220));
      v0.y = Math.min(v0.y, 0);
      const surfaceY = Math.max(level, this.floor) + (this.foam.visible ? foamH * 0.5 : 0);
      // Time to fall to the surface.
      const a = 0.5 * g, b = -v0.y, c = surfaceY - local.y;
      const tLand = (b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
      const pts: Vector3[] = [];
      const N = 18;
      for (let i = 0; i <= N; i++) {
        const tt = (tLand * i) / N;
        pts.push(new Vector3(local.x + v0.x * tt, local.y + v0.y * tt - 0.5 * g * tt * tt, local.z + v0.z * tt));
      }
      impact = pts[N];
      const curve = new CatmullRomCurve3(pts);
      const segs = 48, radial = 14;
      const geo = new TubeGeometry(curve, segs, 1, radial, false);
      // Taper: the stream narrows as it speeds up; thinner at the start and end of the pour.
      const P = geo.getAttribute('position');
      const r0 = this.src.stream * (0.35 + 0.65 * pouring);
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const c0 = curve.getPointAt(u);
        const speed = Math.hypot(v0.x, v0.y - g * tLand * u, v0.z);
        const k0 = r0 * Math.sqrt(mm(220) / Math.max(mm(220), speed)) * (1 + 0.06 * Math.sin(u * 40 - t * 30));
        for (let j = 0; j <= radial; j++) {
          const idx = i * (radial + 1) + j;
          // Rope: a slow three-lobed twist travelling down the stream.
          const k = k0 * (1 + 0.11 * Math.sin((3 * 2 * Math.PI * j) / radial + u * 26 - t * 16));
          P.setXYZ(idx, c0.x + (P.getX(idx) - c0.x) * k, c0.y + (P.getY(idx) - c0.y) * k, c0.z + (P.getZ(idx) - c0.z) * k);
        }
      }
      geo.computeVertexNormals();
      this.streamMesh.geometry.dispose();
      this.streamMesh.geometry = geo;
      this.streamMesh.position.set(0, 0, 0);
      // Flowing: scroll the flow normals down the stream.
      if (this.streamMat.normalMap) this.streamMat.normalMap.offset.set(-t * 2.4, 0);
    }
    // Splash where it lands.
    const sp = this.streamMesh.visible && impact ? pouring : 0;
    for (let i = 0; i < this.splashSeeds.length; i++) {
      const d = this.splashSeeds[i];
      if (!sp || !impact) { m4.makeScale(0, 0, 0); this.splash.setMatrixAt(i, m4); continue; }
      const tau = ((t * 2.6 + d.ph) % 1) * 0.12;
      const x = impact.x + Math.cos(d.a) * d.v * tau, z = impact.z + Math.sin(d.a) * d.v * tau;
      const y = impact.y + d.up * tau * 0.18 - 0.5 * mm(9810) * tau * tau;
      const s = d.s * sp * (y < impact.y - mm(0.5) ? 0 : 1);
      // Keep the splash inside the glass.
      const rr = Math.hypot(x, z), lim = this.rIn(Math.max(this.floor, y)) - mm(1.5);
      const kx = rr > lim ? lim / rr : 1;
      pos.set(x * kx, y, z * kx);
      scl.set(s, s * 1.3, s);
      m4.compose(pos, q, scl);
      this.splash.setMatrixAt(i, m4);
    }
    this.splash.instanceMatrix.needsUpdate = true;
    this.ice?.setLevel(level, this.floor);
  }

  dispose(): void {
    this.liquidMesh.geometry.dispose();
    this.surfaceMesh.geometry.dispose();
    this.streamMesh.geometry.dispose();
    this.bubbles.dispose();
    this.splash.dispose();
    for (const o of this.owned) o.dispose();
  }
}
