/**
 * Textiles: tote bag, t-shirt, hoodie and cap. Each garment side is a canvas the size of the
 * panel with its prints placed where the dieline's print areas sit, composed for the print
 * method (screen ink on top, DTG soaked into the fibres, raised embroidery), and draped on an
 * inflated silhouette (an SDF of the garment outline) with a woven / knitted micro-relief.
 */
import {
  CatmullRomCurve3, Color, DoubleSide, BackSide, FrontSide, ExtrudeGeometry, Group, MeshBasicMaterial, MeshPhysicalMaterial, Shape, ShapeGeometry, SphereGeometry, TubeGeometry, Vector3, type Texture,
} from 'three';
import { toteGeometry, garmentShape, garmentPrints, sleeveFrame, fabricColor, capPrints } from '../../products/apparel';
import { mm } from '../../products/geom';
import { str } from '../../products/types';
import type { P2 } from '../../products/types';
import { fbm } from '../../lib/random';
import { mix } from '../../lib/color';
import { grid, printMaterial } from '../build';
import { compose, applyComposite, installDetailBump, detailUniforms, dataTexture, type DetailKind } from '../finishing';
import { createCanvas, context2d } from '../texutil';
import { Bag, type ModelInput, type ProductModel } from './common';
import { assetMeshes, tiledNormal, type DetailMap } from '../assets';
import { Vector2, type BufferGeometry, type Mesh } from 'three';
import type { FinishKey, SurfaceTexture, SurfaceTextures } from '../types';

type Method = 'screen' | 'dtg' | 'embroidery';

interface Placement { id: string; x: number; y: number; w: number; h: number; /** Optional frame: x axis, y axis (unit vectors), centre — for rotated sleeve prints. */ frame?: { vx: P2; vy: P2; c: P2 } }

/** Draw the prints into a panel-sized art canvas and finish masks (panel units = mm, k px per mm). */
function panelArt(tex: SurfaceTextures, places: Placement[], W: number, H: number, x0: number, y0: number, k: number, mirror = false) {
  const art = createCanvas(W * k, H * k);
  const masks: Partial<Record<FinishKey, HTMLCanvasElement>> = {};
  const draw = (ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, p: Placement, box: SurfaceTexture['box']) => {
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.translate(-x0, -y0);
    // Back prints are laid out as seen from behind: mirror them into front-view coordinates.
    if (mirror) ctx.scale(-1, 1);
    if (p.frame) {
      const { vx, vy, c } = p.frame;
      ctx.transform(vx.x, vx.y, vy.x, vy.y, c.x, c.y);
      ctx.translate(-p.w / 2, -p.h / 2);
    } else ctx.translate(p.x, p.y);
    // Surface pt → mm; the texture covers the surface's bleed box.
    const u = mm(1);
    ctx.drawImage(src, box.x / u, box.y / u, box.w / u, box.h / u);
    ctx.restore();
  };
  const actx = context2d(art);
  for (const p of places) {
    const t = tex[p.id];
    if (!t) continue;
    draw(actx, t.art, p, t.box);
    for (const [key, m] of Object.entries(t.masks) as [FinishKey, HTMLCanvasElement][]) {
      if (!masks[key]) masks[key] = createCanvas(W * k, H * k);
      draw(context2d(masks[key]!), m, p, t.box);
    }
  }
  return { art, masks };
}

function fabricMaterial(color: string, sheen: number): MeshPhysicalMaterial {
  const m = printMaterial({ side: FrontSide, sheen, sheenColor: mix(color, '#ffffff', 0.5), bumpScale: 1.2 });
  return m;
}

function detail(bag: Bag, mat: MeshPhysicalMaterial, kind: DetailKind, rx: number, ry: number, scale: number, anisotropy: number, key: string) {
  const owned: Texture[] = [];
  installDetailBump(mat, detailUniforms(kind, rx, ry, scale, anisotropy, owned), key);
  owned.forEach((t) => bag.texture(t));
}

/** Woven / knitted relief from a Blender-baked tileable normal map, `tile` mm per repeat over a W × H mm UV square. */
function weaveNormal(bag: Bag, mat: MeshPhysicalMaterial, map: DetailMap, Wmm: number, Hmm: number, tile: number, strength: number) {
  const t = bag.texture(tiledNormal(map, Wmm / tile, Hmm / tile));
  mat.normalMap = t;
  mat.normalScale = new Vector2(strength, strength);
  mat.needsUpdate = true;
}

/**
 * The cloth-simulated asset's layers (tools/blender/cloth.py), re-mapped for this size: positions
 * in mm scaled by (kx, ky) and converted to pt; UVs, which hold the rest pattern position in the
 * size-M panel box, mapped into this size's panel box (y flipped for the canvas textures).
 */
function clothLayers(asset: 'tee' | 'hoodie' | 'tote', box: { X0: number; Y0: number; W: number; H: number }, to: { x0: number; y0: number; W: number; H: number }, kx: number, ky: number): { front: BufferGeometry; back: BufferGeometry } | null {
  const meshes = assetMeshes(asset, 'garment');
  const find = (name: string) => meshes.find((m) => (Array.isArray(m.material) ? m.material[0] : m.material).name === name);
  const f = find('front'), b = find('back');
  if (!f || !b) return null;
  const remap = (m: Mesh) => {
    const g = m.geometry.clone();
    const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
    const kz = (kx + ky) / 2;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, mm(pos.getX(i) * kx), mm(pos.getY(i) * ky), mm(pos.getZ(i) * kz));
    for (let i = 0; i < uv.count; i++) {
      const gx = (box.X0 + uv.getX(i) * box.W) * kx, gy = (box.Y0 + uv.getY(i) * box.H) * ky;
      uv.setXY(i, (gx - to.x0) / to.W, 1 - (gy - to.y0) / to.H);
    }
    g.computeVertexNormals();
    return g;
  };
  return { front: remap(f), back: remap(b) };
}

/**
 * A ghost-mannequin garment is an open tube: the key light and the contact shadow fall straight
 * through its hem and leave a bright hole in the floor shadow. A cap across the hem that only casts
 * shadows (it draws nothing, and the path tracer skips it) closes the shadow like a body would.
 */
function hemShadowCap(res: Bag, parent: Group, geos: BufferGeometry[], floorY: number): void {
  const pts: [number, number][] = [];
  for (const g of geos) {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < floorY + mm(30)) pts.push([pos.getX(i), pos.getZ(i)]);
  }
  if (pts.length < 3) return;
  // Convex hull (monotone chain) of the hem in plan.
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]) => {
    const h: [number, number][] = [];
    for (const p of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); }
    h.pop();
    return h;
  };
  const hull = [...half(pts), ...half([...pts].reverse())];
  if (hull.length < 3) return;
  // Slightly inside the hem so its edge never peeks out of the shadow.
  const cx = hull.reduce((t, p) => t + p[0], 0) / hull.length, cz = hull.reduce((t, p) => t + p[1], 0) / hull.length;
  const shape = new Shape(hull.map(([x, z]) => new Vector2(cx + (x - cx) * 0.94, cz + (z - cz) * 0.94)));
  const geo = new ShapeGeometry(shape).rotateX(Math.PI / 2);
  const mat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: DoubleSide });
  const cap = res.mesh(geo, mat, parent);
  cap.position.y = floorY + mm(20);
  cap.castShadow = true;
  cap.receiveShadow = false;
  cap.userData.shadowOnly = true;
}

/** Panel box of the size-M patterns the cloth assets were simulated from (tools/blender/data/*.uvbox.json). */
const CLOTH_BOX = {
  tee: { X0: -409.3498597120673, Y0: -6, W: 818.6997194241346, H: 746 },
  hoodie: { X0: -497.5419858454801, Y0: -241, W: 995.0839716909602, H: 941 },
  tote: { X0: -190, Y0: 0, W: 380, H: 420 },
};

/** Art density of the incoming textures, px per mm (the panel canvas follows it, within a budget). */
function artDensity(tex: SurfaceTextures, ids: string[]): number {
  let k = 0;
  for (const id of ids) { const t = tex[id]; if (t) k = Math.max(k, t.art.width / (t.box.w / mm(1))); }
  return k;
}

/* -------------------------------------------------------------------------- */
/* Signed distance to a polygon (mm)                                           */
/* -------------------------------------------------------------------------- */

function inside(poly: P2[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function edgeDist(poly: P2[], x: number, y: number): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
  }
  return d;
}

function maskCanvas(polys: P2[][], x0: number, y0: number, W: number, H: number, k: number, holes: P2[][] = []) {
  const c = createCanvas(W * k, H * k);
  const ctx = context2d(c);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  ctx.fillStyle = '#fff';
  for (const p of polys) { ctx.beginPath(); p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fill(); }
  ctx.fillStyle = '#000';
  for (const p of holes) { ctx.beginPath(); p.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fill(); }
  return c;
}

/* -------------------------------------------------------------------------- */
/* Tote bag                                                                     */
/* -------------------------------------------------------------------------- */

export function buildTote(input: ModelInput): ProductModel {
  const o = input.options;
  const g = toteGeometry(o);
  const bag = new Bag();
  const group = new Group();
  const fabric = fabricColor(o);
  const weave = str(o, 'weave', 'cotton');
  const method = str(o, 'method', 'screen') as Method;
  const Wm = g.W / mm(1), Hm = g.H / mm(1);
  const fs = input.dieline.surfaces.find((s) => s.id === 'front')!;
  const pw = fs.w / mm(1), ph = fs.h / mm(1);
  const top = Math.min(60, Hm - ph - 20);
  const px = (Wm - pw) / 2;
  const depth = g.G > 0 ? g.G / 2 : mm(16);
  const drape = (u: number, v: number) => depth * Math.pow(Math.sin(Math.PI * u), 0.6) * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * v)), 0.75)
    + mm(3.5) * Math.sin(u * Math.PI * 4 + fbm(u * 3, v * 2, 2, 9) * 3) * Math.pow(v, 1.6) * Math.sin(Math.PI * u)
    + (fbm(u * 6, v * 6, 3, 21) - 0.5) * mm(4) * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
  const mats: Record<string, MeshPhysicalMaterial> = {};
  // Cloth-simulated bag (hangs from its handles with drape folds), or the procedural drape.
  const cloth = clothLayers('tote', CLOTH_BOX.tote, { x0: 0, y0: 0, W: Wm, H: Hm }, Wm / 380, Hm / 420);
  if (cloth) {
    // Its UVs run across the bag in front-view coordinates (x0 = −W/2): shift to the canvas.
    for (const geo of [cloth.front, cloth.back]) {
      const uv = geo.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) + 0.5);
    }
  }
  for (const side of ['front', 'back'] as const) {
    const sign = side === 'front' ? 1 : -1;
    let geo: BufferGeometry;
    if (cloth) geo = cloth[side];
    else {
      geo = grid(g.W, g.H, 64, 72, (u, v) => ({ x: sign * (u - 0.5) * g.W, y: (1 - v) * g.H, z: (sign * drape(u, v)), uv: [u, 1 - v] }));
      if (side === 'back') { const idx = geo.getIndex()!.array as Uint16Array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } geo.computeVertexNormals(); }
    }
    const mat = fabricMaterial(fabric, weave === 'cotton' ? 0.6 : 0.3);
    mat.side = DoubleSide;
    if (weave === 'jute') detail(bag, mat, 'jute', Wm / 6, Hm / 6, 1.1, input.anisotropy, `tote-${weave}`);
    else weaveNormal(bag, mat, 'canvas', Wm, Hm, weave === 'canvas' ? 9 : 6, weave === 'canvas' ? 0.9 : 0.6);
    mats[side] = mat;
    bag.mesh(geo, mat, group);
  }
  // Handles: flat straps sewn inside the top hem, one per side.
  const strapShape = new Shape();
  strapShape.moveTo(-g.handleW / 2, -mm(1));
  strapShape.lineTo(g.handleW / 2, -mm(1));
  strapShape.lineTo(g.handleW / 2, mm(1));
  strapShape.lineTo(-g.handleW / 2, mm(1));
  strapShape.closePath();
  const drop = Math.min(g.handleL / 2 - mm(40), mm(330));
  const strapMat = fabricMaterial(fabric, 0.5);
  strapMat.color.set(mix(fabric, '#000000', 0.04));
  strapMat.roughness = 0.9; strapMat.metalness = 0;
  detail(bag, strapMat, 'canvas', 2, 40, 0.8, input.anisotropy, 'tote-strap');
  for (const sign of [1, -1]) {
    const z = sign * mm(3);
    const x1 = -g.W * 0.25, x2 = g.W * 0.25;
    const curve = new CatmullRomCurve3([
      new Vector3(x1, g.H - mm(35), z), new Vector3(x1 - mm(6), g.H + drop * 0.35, z + sign * mm(8)), new Vector3(x1 * 0.55, g.H + drop * 0.85, z + sign * mm(14)),
      new Vector3(0, g.H + drop, z + sign * mm(16)), new Vector3(x2 * 0.55, g.H + drop * 0.85, z + sign * mm(14)), new Vector3(x2 + mm(6), g.H + drop * 0.35, z + sign * mm(8)), new Vector3(x2, g.H - mm(35), z),
    ]);
    const geo = new ExtrudeGeometry(strapShape, { steps: 120, extrudePath: curve, bevelEnabled: false });
    bag.mesh(geo, strapMat, group);
  }
  return {
    group,
    info: {},
    pose: () => undefined,
    applyTextures(tex) {
      // As sharp as the art that came in, within ~16 MP per side.
      const k = Math.max(1, Math.min(artDensity(tex, ['front', 'back']) || 4, Math.sqrt(16e6 / (Wm * Hm))));
      for (const side of ['front', 'back'] as const) {
        // The cloth asset maps the back in front-view coordinates: mirror its artwork.
        const { art, masks } = panelArt(tex, [{ id: side, x: px, y: top, w: pw, h: ph }], Wm, Hm, 0, 0, k, !!cloth && side === 'back');
        const c = compose({ art, masks, base: fabric, roughness: 0.92, metalness: 0, clearcoat: 0, mode: method, widthPt: g.W, anisotropy: input.anisotropy });
        bag.setComposite(side, c);
        applyComposite(mats[side], c);
        mats[side].transparent = false; mats[side].alphaMap = null;
      }
    },
    dispose: () => bag.dispose(),
  };
}

/* -------------------------------------------------------------------------- */
/* T-shirt & hoodie                                                             */
/* -------------------------------------------------------------------------- */

export function buildGarment(input: ModelInput, kind: 'tee' | 'hoodie'): ProductModel {
  const o = input.options;
  const gs = garmentShape(kind, str(o, 'size', 'M'));
  const prints = garmentPrints(kind, o);
  const fabric = fabricColor(o);
  const method = str(o, 'method', 'screen') as Method;
  const bag = new Group();
  const res = new Bag();
  // Panel bounds (mm, garment coordinates).
  const all = [...gs.front, ...(gs.hood ?? [])];
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const x0 = Math.min(...xs) - 6, x1 = Math.max(...xs) + 6, y0 = Math.min(...ys) - 6, y1 = Math.max(...ys) + 6;
  const W = x1 - x0, H = y1 - y0;
  const lift = 70; // hem above the ground, mm
  const baseY = mm(gs.length + lift);
  const depth = gs.chest * 0.24;
  const sdfDepth = (poly: P2[][], x: number, y: number) => {
    let inAny = false, d = Infinity;
    for (const p of poly) { if (inside(p, x, y)) inAny = true; d = Math.min(d, edgeDist(p, x, y)); }
    return inAny ? d : -d;
  };
  const sides: { id: 'front' | 'back'; polys: P2[][]; holes: P2[][]; mat: MeshPhysicalMaterial }[] = [];
  const knit = kind === 'hoodie' ? 'weave' : 'knit';
  // Cloth-simulated garment (ghost mannequin with drape folds), scaled from size M.
  const gm = garmentShape(kind, 'M');
  const cloth = clothLayers(kind, CLOTH_BOX[kind], { x0, y0, W, H }, gs.chest / gm.chest, gs.length / gm.length);
  if (cloth) {
    // Hem a little above the floor, like the procedural garment.
    let minY = Infinity;
    for (const geo of [cloth.front, cloth.back]) { geo.computeBoundingBox(); minY = Math.min(minY, geo.boundingBox!.min.y); }
    for (const side of ['front', 'back'] as const) {
      const geo = cloth[side];
      geo.translate(0, mm(lift) - minY, 0);
      const mat = fabricMaterial(fabric, kind === 'hoodie' ? 0.85 : 0.7);
      weaveNormal(res, mat, kind === 'hoodie' ? 'fleece' : 'jersey', W, H, kind === 'hoodie' ? 14 : 8, kind === 'hoodie' ? 0.7 : 0.55);
      res.mesh(geo, mat, bag);
      // Inside of the garment (through the neck, hem and cuffs).
      const innerMat = new MeshPhysicalMaterial({ color: new Color(mix(fabric, '#000000', 0.25)), roughness: 0.95, side: BackSide, sheen: 0.4 });
      res.mesh(geo, innerMat, bag, false);
      sides.push({ id: side, polys: [], holes: [], mat });
    }
    hemShadowCap(res, bag, [cloth.front, cloth.back], mm(lift));
  }
  for (const side of (cloth ? [] : ['front', 'back']) as ('front' | 'back')[]) {
    const sign = side === 'front' ? 1 : -1;
    const polys = side === 'front' ? [gs.front] : [gs.back, ...(gs.hood ? [gs.hood] : [])];
    const keep: boolean[] = [];
    const geo = grid(mm(W), mm(H), 120, 140, (u, v) => {
      const gx = x0 + u * W, gy = y0 + v * H;
      const d = sdfDepth(polys, gx, gy);
      keep.push(d > -6);
      const inflate = d > 0 ? Math.pow(Math.min(1, d / 95), 0.45) : 0;
      const wr = (fbm(u * 4, v * 5, 3, side === 'front' ? 3 : 8) - 0.5) * 9 * inflate + Math.sin(gy / 38 + Math.sin(gx / 60) * 1.5) * 2.2 * inflate;
      const hoodPuff = kind === 'hoodie' && side === 'back' && gy < 0 ? 0.42 : 1;
      return { x: mm(gx), y: baseY - mm(gy), z: sign * mm(depth * inflate * hoodPuff + wr), uv: [u, 1 - v] };
    });
    // Drop the triangles outside the silhouette (no rectangular shadows), and face the back outward.
    const src = Array.from(geo.getIndex()!.array);
    const kept: number[] = [];
    for (let i = 0; i < src.length; i += 3) {
      const [a, b, c] = [src[i], src[i + 1], src[i + 2]];
      if (!(keep[a] || keep[b] || keep[c])) continue;
      if (side === 'back') kept.push(a, c, b); else kept.push(a, b, c);
    }
    geo.setIndex(kept);
    geo.computeVertexNormals();
    const mat = fabricMaterial(fabric, 0.7);
    detail(res, mat, knit, W / 8, H / 8, 1.0, input.anisotropy, `garment-${knit}`);
    const alpha = res.texture(dataTexture(maskCanvas(polys, x0, y0, W, H, 2), input.anisotropy));
    mat.alphaMap = alpha;
    mat.alphaTest = 0.5;
    res.mesh(geo, mat, bag);
    // Inside of the garment (seen through the neck opening).
    const innerMat = new MeshPhysicalMaterial({ color: new Color(mix(fabric, '#000000', 0.25)), roughness: 0.95, side: BackSide, alphaMap: alpha, alphaTest: 0.5, sheen: 0.4 });
    res.mesh(geo, innerMat, bag, false);
    sides.push({ id: side, polys, holes: [], mat });
  }
  return {
    group: bag,
    info: {},
    pose: () => undefined,
    applyTextures(tex) {
      const k = Math.max(1, Math.min(artDensity(tex, prints.map((p) => p.id)) || 3, Math.sqrt(16e6 / (W * H))));
      for (const s of sides) {
        const places: Placement[] = [];
        for (const p of prints) {
          if (p.view === s.id) places.push({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h });
          if (p.view === 'sleeve' && s.id === 'front') {
            const f = sleeveFrame(gs, p.h);
            places.push({ id: p.id, x: 0, y: 0, w: p.w, h: p.h, frame: { vx: f.v, vy: f.u, c: f.centre } });
          }
        }
        // Back prints are laid out as seen from behind: mirror into front-view coordinates.
        const { art, masks } = panelArt(tex, places, W, H, x0, y0, k, s.id === 'back');
        // Ribbing, pocket and hood details drawn onto the art.
        const ctx = context2d(art);
        ctx.save();
        ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
        ctx.strokeStyle = mix(fabric, '#000000', 0.22);
        ctx.lineWidth = 1.4;
        if (gs.rib) {
          ctx.globalAlpha = 0.6;
          ctx.beginPath(); ctx.moveTo(-gs.chest, gs.length - gs.rib); ctx.lineTo(gs.chest, gs.length - gs.rib); ctx.stroke();
        } else {
          ctx.globalAlpha = 0.45;
          ctx.beginPath(); ctx.moveTo(-gs.chest, gs.length - 22); ctx.lineTo(gs.chest, gs.length - 22); ctx.stroke();
        }
        if (s.id === 'front' && gs.pocket) {
          ctx.globalAlpha = 0.7;
          ctx.beginPath(); gs.pocket.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.stroke();
        }
        ctx.restore();
        const c = compose({ art, masks, base: fabric, roughness: 0.95, metalness: 0, clearcoat: 0, mode: method, widthPt: mm(W), anisotropy: input.anisotropy });
        res.setComposite(s.id, c);
        const alpha = s.mat.alphaMap;
        applyComposite(s.mat, c);
        s.mat.alphaMap = alpha; s.mat.alphaTest = alpha ? 0.5 : 0; s.mat.transparent = false;
        s.mat.needsUpdate = true;
      }
    },
    dispose: () => res.dispose(),
  };
}

/* -------------------------------------------------------------------------- */
/* Cap                                                                          */
/* -------------------------------------------------------------------------- */

export function buildCap(input: ModelInput): ProductModel {
  const o = input.options;
  const bag = new Bag();
  const group = new Group();
  const fabric = fabricColor(o);
  const brimColor = str(o, 'brim', fabric);
  const method = str(o, 'method', 'embroidery') as Method;
  const Rc = mm(92), theta = 1.66, sy = 0.86;
  const yb = mm(25);
  // Crown: a sphere cap, UVs as longitude (u) × arc length from the bottom (v).
  const crownGeo = new SphereGeometry(Rc, 96, 48, 0, Math.PI * 2, 0, theta);
  crownGeo.scale(1, sy, 1.06);
  const pos = crownGeo.getAttribute('position'), uv = crownGeo.getAttribute('uv');
  const yBottom = Math.min(...Array.from({ length: pos.count }, (_, i) => pos.getY(i)));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const lon = Math.atan2(x, z); // 0 = front
    const lat = Math.asin(Math.max(-1, Math.min(1, (y / sy - 0) / Rc)));
    const arc = (lat - Math.asin(Math.max(-1, Math.min(1, yBottom / sy / Rc)))) / theta;
    uv.setXY(i, 0.5 + lon / (2 * Math.PI), Math.max(0, Math.min(1, arc)));
  }
  crownGeo.translate(0, yb - yBottom, 0);
  const crownMat = fabricMaterial(fabric, 0.5);
  crownMat.side = DoubleSide;
  weaveNormal(bag, crownMat, 'canvas', (2 * Math.PI * Rc) / mm(1), (Rc * theta) / mm(1), 5, 0.65);
  bag.mesh(crownGeo, crownMat, group);
  // Button on top.
  crownGeo.computeBoundingBox();
  const top = crownGeo.boundingBox!.max.y;
  const btnMat = new MeshPhysicalMaterial({ color: new Color(mix(fabric, '#000000', 0.06)), roughness: 0.9, sheen: 0.4 });
  bag.mesh(new SphereGeometry(mm(6), 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1).translate(0, top - mm(0.6), 0), btnMat, group);
  // Brim.
  const lmax = (75 * Math.PI) / 180, Lb = mm(72);
  const brimGeo = grid(1, 1, 48, 12, (s, t) => {
    const lam = (s - 0.5) * 2 * lmax;
    const len = Lb * Math.pow(Math.cos(lam * 0.92), 0.8);
    const bx = Rc * Math.sin(lam), bz = Rc * 1.06 * Math.cos(lam);
    const dx = Math.sin(lam), dz = Math.cos(lam);
    const droop = mm(12) * Math.pow(Math.abs(lam) / lmax, 2) * t + mm(7) * t * t;
    return { x: bx + dx * len * t, y: yb - droop, z: bz + dz * len * t, uv: [s, t] };
  });
  const brimMat = new MeshPhysicalMaterial({ color: new Color(brimColor), roughness: 0.85, sheen: 0.4, sheenColor: new Color(mix(brimColor, '#ffffff', 0.5)), side: DoubleSide });
  weaveNormal(bag, brimMat, 'canvas', 180, 80, 4, 0.6);
  bag.mesh(brimGeo, brimMat, group);
  // The brim has a stiffened core: a second skin underneath and a rolled, stitched edge.
  const brimUnder = brimGeo.clone();
  brimUnder.translate(0, -mm(2.6), 0);
  bag.mesh(brimUnder, brimMat, group);
  const edgePts: Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const lam = (i / 48 - 0.5) * 2 * lmax;
    const len = Lb * Math.pow(Math.cos(lam * 0.92), 0.8);
    const droop = mm(12) * Math.pow(Math.abs(lam) / lmax, 2) + mm(7);
    edgePts.push(new Vector3(Rc * Math.sin(lam) + Math.sin(lam) * len, yb - droop - mm(1.3), Rc * 1.06 * Math.cos(lam) + Math.cos(lam) * len));
  }
  bag.mesh(new TubeGeometry(new CatmullRomCurve3(edgePts), 96, mm(1.4), 8, false), brimMat, group);
  const prints = capPrints(o);
  return {
    group,
    info: {},
    pose: () => undefined,
    applyTextures(tex) {
      // Crown canvas: longitude × arc (mm). Circumference at the bottom ≈ 2πR.
      const Wm = (2 * Math.PI * Rc) / mm(1), Hm = (Rc * theta) / mm(1);
      const k = Math.min(4, 2048 / Wm);
      const places: Placement[] = [
        { id: 'front', x: Wm / 2 - prints.front.w / mm(1) / 2, y: Hm - 18 - prints.front.h / mm(1), w: prints.front.w / mm(1), h: prints.front.h / mm(1) },
        { id: 'side', x: Wm * 0.75 - prints.side.w / mm(1) / 2, y: Hm - 24 - prints.side.h / mm(1), w: prints.side.w / mm(1), h: prints.side.h / mm(1) },
        { id: 'back', x: -prints.back.w / mm(1) / 2, y: Hm - 48 - prints.back.h / mm(1), w: prints.back.w / mm(1), h: prints.back.h / mm(1) },
      ];
      // The back print straddles the seam at the back (longitude ±180°): draw it at both ends.
      places.push({ ...places[2], x: Wm - prints.back.w / mm(1) / 2 });
      const { art, masks } = panelArt(tex, places, Wm, Hm, 0, 0, k);
      // Seams and eyelets.
      const ctx = context2d(art);
      ctx.save();
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.strokeStyle = mix(fabric, '#000000', 0.3);
      ctx.lineWidth = 1.2;
      for (let s = 0; s < 6; s++) { const x = (s / 6) * Wm; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, Hm); ctx.stroke(); }
      ctx.fillStyle = mix(fabric, '#000000', 0.35);
      for (let s = 0; s < 6; s++) { ctx.beginPath(); ctx.arc(((s + 0.5) / 6) * Wm, 26, 2.2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      const c = compose({ art, masks, base: fabric, roughness: 0.9, metalness: 0, clearcoat: 0, mode: method, widthPt: mm(Wm), anisotropy: input.anisotropy });
      bag.setComposite('crown', c);
      applyComposite(crownMat, c);
      crownMat.transparent = false; crownMat.alphaMap = null;
    },
    dispose: () => bag.dispose(),
  };
}
