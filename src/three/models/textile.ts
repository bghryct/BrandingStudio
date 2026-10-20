/**
 * Textiles: tote bag, t-shirt, hoodie and cap. Each garment side is a canvas the size of the
 * panel with its prints placed where the dieline's print areas sit, composed for the print
 * method (screen ink on top, DTG soaked into the fibres, raised embroidery), and draped on an
 * inflated silhouette (an SDF of the garment outline) with a woven / knitted micro-relief.
 */
import {
  CatmullRomCurve3, Color, DoubleSide, BackSide, FrontSide, ExtrudeGeometry, Group, MeshPhysicalMaterial, Shape, SphereGeometry, Vector3, type Texture,
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
  for (const side of ['front', 'back'] as const) {
    const sign = side === 'front' ? 1 : -1;
    const geo = grid(g.W, g.H, 64, 72, (u, v) => ({ x: sign * (u - 0.5) * g.W, y: (1 - v) * g.H, z: (sign * drape(u, v)), uv: [u, 1 - v] }));
    if (side === 'back') { const idx = geo.getIndex()!.array as Uint16Array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } geo.computeVertexNormals(); }
    const mat = fabricMaterial(fabric, weave === 'cotton' ? 0.6 : 0.3);
    mat.side = DoubleSide;
    detail(bag, mat, weave === 'jute' ? 'jute' : weave === 'canvas' ? 'canvas' : 'weave', Wm / 6, Hm / 6, 1.1, input.anisotropy, `tote-${weave}`);
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
      const k = Math.min(4, 2048 / Math.max(Wm, Hm));
      for (const side of ['front', 'back'] as const) {
        const { art, masks } = panelArt(tex, [{ id: side, x: px, y: top, w: pw, h: ph }], Wm, Hm, 0, 0, k);
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
  for (const side of ['front', 'back'] as const) {
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
      const k = Math.min(3, 1800 / Math.max(W, H));
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
        const c = compose({ art, masks, base: fabric, roughness: 0.95, metalness: 0, clearcoat: 0, mode: method, widthPt: mm(W), anisotropy: input.anisotropy, maxPx: 2048 });
        res.setComposite(s.id, c);
        const alpha = s.mat.alphaMap;
        applyComposite(s.mat, c);
        s.mat.alphaMap = alpha; s.mat.alphaTest = 0.5; s.mat.transparent = false;
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
  detail(bag, crownMat, 'canvas', 30, 12, 0.9, input.anisotropy, 'cap-twill');
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
  detail(bag, brimMat as MeshPhysicalMaterial, 'canvas', 18, 6, 0.6, input.anisotropy, 'cap-brim');
  brimMat.bumpMap = null;
  bag.mesh(brimGeo, brimMat, group);
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
