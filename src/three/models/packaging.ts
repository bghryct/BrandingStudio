/**
 * Pillow box, paper tube, stand-up pouch and jar.
 */
import { CanvasTexture, CircleGeometry, Color, CylinderGeometry, DoubleSide, FrontSide, Group, MeshPhysicalMaterial, MeshStandardMaterial, NoColorSpace, Vector2, type BufferGeometry, type Texture } from 'three';
import { createCanvas, context2d } from '../texutil';
import { tiledNormal } from '../assets';
import { pillowGeometry, boardOf } from '../../products/cartons';
import { tubeGeometry, pouchGeometry, jarGeometry, POUCH_FILMS } from '../../products/packaging';
import { mm } from '../../products/geom';
import { num, str } from '../../products/types';
import { fbm } from '../../lib/random';
import { grid, revolve, printMaterial, surfaceUV, bleedBox, glassMaterial, metalMaterial, CAP_COLORS } from '../build';
import { compose, applyComposite, installDetailBump, detailUniforms, type Composite } from '../finishing';
import { Bag, type ModelInput, type ProductModel } from './common';
import { labelPatch, labelMeshes, stockLook } from './bottle';
import type { SurfaceTexture } from '../types';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function flipIfInward(g: BufferGeometry, wantY: number | null, wantZ: number | null) {
  const n = g.getAttribute('normal');
  const mid = Math.floor(n.count / 2);
  const dot = (wantY ?? 0) * n.getY(mid) + (wantZ ?? 0) * n.getZ(mid);
  if (dot < 0) {
    const idx = g.getIndex()!;
    const a = idx.array as Uint32Array | Uint16Array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    idx.needsUpdate = true;
    g.computeVertexNormals();
  }
}

function printed(bag: Bag, key: string, mat: MeshPhysicalMaterial, t: SurfaceTexture | undefined, box: { w: number }, base: string, rough: number, cc: number, anisotropy: number, mode: 'opaque' | 'metal' = 'opaque'): Composite {
  const c = compose({ art: t?.art ?? null, masks: t?.masks ?? {}, base, roughness: rough, metalness: mode === 'metal' ? 1 : 0, clearcoat: cc, mode, widthPt: box.w, anisotropy });
  bag.setComposite(key, c);
  applyComposite(mat, c);
  return c;
}

/* -------------------------------------------------------------------------- */
/* Pillow box                                                                   */
/* -------------------------------------------------------------------------- */

export function buildPillow(input: ModelInput): ProductModel {
  const o = input.options;
  const { L, W, T, e } = pillowGeometry(o);
  const board = boardOf(o);
  const s = input.dieline.surfaces[0];
  const box = bleedBox(s);
  const pf = s.panels.find((p) => p.id === 'front')!, pb = s.panels.find((p) => p.id === 'back')!;
  const bag = new Bag();
  const group = new Group();
  const mat = printMaterial({ side: DoubleSide, bumpScale: 0.8 });
  mat.normalMap = bag.texture(tiledNormal(board.value === 'kraft' ? 'kraft' : 'paper', box.w / mm(22), box.h / mm(22)));
  mat.normalScale = new Vector2(0.3, 0.3);
  bag.add(mat);
  let meshes: { front: BufferGeometry; back: BufferGeometry } | null = null;
  const build = (thick: number) => {
    const t = (u: number, v: number) => {
      const d = (e * Math.sin(Math.PI * v)) / L;
      const taper = d > 0 ? sstep(0, d * 1.6 + 1e-4, Math.min(u, 1 - u)) : 0;
      return (thick / 2) * Math.pow(Math.sin(Math.PI * v), 0.75) * taper;
    };
    const front = grid(L, W, 80, 40, (u, v) => ({ x: (u - 0.5) * L, y: T / 2 + t(u, v), z: (v - 0.5) * W * 0.97, uv: surfaceUV(box, pf.x + u * L, pf.y + v * W) }));
    const back = grid(L, W, 80, 40, (u, v) => ({ x: (u - 0.5) * L, y: T / 2 - t(u, v), z: (0.5 - v) * W * 0.97, uv: surfaceUV(box, pb.x + u * L, pb.y + v * W) }));
    flipIfInward(front, 1, null);
    flipIfInward(back, -1, null);
    return { front, back };
  };
  const fm = bag.mesh(build(T).front, mat, group);
  const bm = bag.mesh(build(T).back, mat, group);
  let lastFold = 1;
  return {
    group,
    info: { lying: true, hasFold: true },
    pose({ fold }) {
      if (Math.abs(fold - lastFold) < 1e-4) return;
      lastFold = fold;
      meshes = build(T * Math.max(0.001, fold));
      fm.geometry.dispose(); bm.geometry.dispose();
      fm.geometry = meshes.front; bm.geometry = meshes.back;
      fm.position.y = bm.position.y = -(T / 2) * (1 - fold);
    },
    applyTextures(tex) {
      const co = str(o, 'finish', 'matte');
      printed(bag, 'pillow', mat, tex[s.id], box, board.outside, co === 'gloss' ? 0.3 : 0.7, co === 'gloss' ? 1 : 0, input.anisotropy);
    },
    dispose: () => bag.dispose(),
  };
}

/* -------------------------------------------------------------------------- */
/* Paper tube                                                                   */
/* -------------------------------------------------------------------------- */

export function buildTube(input: ModelInput): ProductModel {
  const o = input.options;
  const g = tubeGeometry(o);
  const bag = new Bag();
  const group = new Group();
  const material = str(o, 'material', 'kraft');
  const paper = material === 'kraft' ? '#b48a5b' : material === 'black' ? '#1f1e20' : '#f7f5f0';
  const inner = new MeshStandardMaterial({ color: new Color(material === 'black' ? '#2a2826' : '#b08a62'), roughness: 0.95, side: DoubleSide });
  bag.add(inner);
  const bodyS = input.dieline.surfaces.find((s) => s.id === 'body')!;
  const lidS = input.dieline.surfaces.find((s) => s.id === 'lid')!;
  const topS = input.dieline.surfaces.find((s) => s.id === 'top');
  const R = g.D / 2, Rl = g.Dl / 2;
  const bodyMat = printMaterial({ side: FrontSide, bumpScale: 0.6 });
  const bb = bleedBox(bodyS);
  const fibre = material === 'white' ? 'paper' : 'kraft';
  bodyMat.normalMap = bag.texture(tiledNormal(fibre, bb.w / mm(22), bb.h / mm(22)));
  bodyMat.normalScale = new Vector2(0.35, 0.35);
  const C = Math.PI * g.D;
  bag.mesh(revolve([[0, R], [g.Hb, R]], 120, (f, _j, y) => surfaceUV(bb, f * C, g.roll + (g.Hb - y))), bodyMat, group);
  bag.mesh(revolve([[0, R - g.wall], [g.Hb, R - g.wall]], 64, undefined, -Math.PI, Math.PI, true), inner, group);
  bag.mesh(new CircleGeometry(R, 64).rotateX(Math.PI / 2).translate(0, mm(0.3), 0), inner, group);
  // Neck tube that the lid slides over.
  const neck = new Group();
  bag.mesh(new CylinderGeometry(R - g.wall * 0.6, R - g.wall * 0.6, g.Hl - mm(4), 64, 1, true).translate(0, g.Hb + (g.Hl - mm(4)) / 2 - mm(2), 0), new MeshStandardMaterial({ color: new Color(paper), roughness: 0.9, side: DoubleSide }), neck);
  group.add(neck);
  // Lid.
  const lid = new Group();
  const lidMat = printMaterial({ side: FrontSide, bumpScale: 0.6 });
  const lb = bleedBox(lidS);
  lidMat.normalMap = bag.texture(tiledNormal(fibre, lb.w / mm(22), lb.h / mm(22)));
  lidMat.normalScale = new Vector2(0.35, 0.35);
  const Cl = Math.PI * g.Dl;
  bag.mesh(revolve([[0, Rl], [g.Hl, Rl]], 120, (f, _j, y) => surfaceUV(lb, f * Cl, g.Hl - y)), lidMat, lid);
  bag.mesh(revolve([[0, Rl - g.wall], [g.Hl, Rl - g.wall]], 64, undefined, -Math.PI, Math.PI, true), inner, lid);
  bag.mesh(new CylinderGeometry(Rl, Rl - g.wall, mm(0.01), 64, 1, true).translate(0, 0, 0), inner, lid);
  const topMat = printMaterial({ side: FrontSide, bumpScale: 0.6 });
  const topGeo = new CircleGeometry(Rl, 72);
  if (topS) {
    const tb = bleedBox(topS);
    const d = topS.w;
    const uv = topGeo.getAttribute('uv'), pos = topGeo.getAttribute('position');
    for (let i = 0; i < uv.count; i++) {
      const [u, v] = surfaceUV(tb, d / 2 + pos.getX(i) * (d / 2) / Rl, d / 2 - pos.getY(i) * (d / 2) / Rl);
      uv.setXY(i, u, v);
    }
  }
  topGeo.rotateX(-Math.PI / 2).translate(0, g.Hl, 0);
  bag.mesh(topGeo, topMat, lid);
  lid.position.y = g.Hb + mm(0.3);
  group.add(lid);
  return {
    group,
    info: { hasOpen: true, rollRadius: Rl },
    pose({ open }) {
      const k = sstep(0, 1, open);
      lid.position.set(k * R * 0.9, g.Hb + mm(0.3) + k * g.Hl * 1.25, 0);
      lid.rotation.z = -k * 0.42;
    },
    applyTextures(tex) {
      const co = str(o, 'finish', 'matte');
      const rough = co === 'gloss' ? 0.28 : co === 'soft-touch' ? 0.92 : 0.7;
      const cc = co === 'gloss' ? 1 : 0;
      printed(bag, 'body', bodyMat, tex.body, bb, paper, rough, cc, input.anisotropy);
      printed(bag, 'lid', lidMat, tex.lid, lb, paper, rough, cc, input.anisotropy);
      if (topS && tex.top) printed(bag, 'top', topMat, tex.top, bleedBox(topS), paper, rough, cc, input.anisotropy);
      else { topMat.map = null; topMat.color.set(paper); topMat.roughness = 0.8; topMat.metalness = 0; topMat.needsUpdate = true; }
    },
    dispose: () => bag.dispose(),
  };
}

/* -------------------------------------------------------------------------- */
/* Stand-up pouch                                                               */
/* -------------------------------------------------------------------------- */

export function buildPouch(input: ModelInput): ProductModel {
  const o = input.options;
  const g = pouchGeometry(o);
  const film = POUCH_FILMS.find((f) => f.value === str(o, 'film')) ?? POUCH_FILMS[0];
  const bag = new Bag();
  const group = new Group();
  const Hv = g.H - g.G * 0.5;
  const visible = g.H - g.G;
  // Seal fins stay flat; the body between them puffs up like a filled pouch, fullest low down
  // where the gusset opens, with soft creases running into the seals.
  const sealU = g.side / g.W, sealV = g.top / Hv;
  const depth = (u: number, v: number) => {
    const ue = clamp01((u - sealU) / (1 - 2 * sealU));
    const ve = clamp01(v / (1 - sealV));
    const across = Math.pow(Math.sin(Math.PI * ue), 0.5);
    const body = g.G * 0.95 * Math.pow(1 - ve, 1.5) + g.W * 0.21 * Math.sin(Math.PI * Math.min(1, ve / 0.9)) * Math.pow(1 - ve * 0.85, 0.35);
    const shoulder = 1 - sstep(0.82, 1, ve);
    const crease = (fbm(u * 6, v * 8, 3, 4) - 0.5) * mm(2.6) * Math.sin(Math.PI * ue) * (0.4 + ve);
    return Math.max(0, (body * across + crease * across) * shoulder);
  };
  const xAt = (u: number, v: number) => (u - 0.5) * g.W * (1 - 0.06 * Math.sin(Math.PI * Math.min(1, v / 0.88)) * (1 - v));
  const surfaces = ['front', 'back'] as const;
  const mats: Record<string, MeshPhysicalMaterial> = {};
  const finish = new Map<string, { normal: Texture; cut: Texture | null }>();
  for (const sid of surfaces) {
    const s = input.dieline.surfaces.find((x) => x.id === sid)!;
    const box = bleedBox(s);
    const sign = sid === 'front' ? 1 : -1;
    const geo = grid(g.W, Hv, 64, 96, (u, v) => ({
      // The two webs' fins sit a hair apart, so the sealed fins never share a plane.
      x: sign * xAt(u, v), y: v * Hv, z: sign * (depth(u, v) / 2 + mm(0.12)),
      uv: surfaceUV(box, u * g.W, (1 - v) * visible),
    }));
    flipIfInward(geo, null, sign);
    const mat = printMaterial({ side: DoubleSide, bumpScale: 0.6 });
    mats[sid] = mat;
    bag.mesh(geo, mat, group);
    finish.set(sid, pouchFinish(bag, s, box, g));
  }
  // Bottom gusset footprint.
  const foot = new CircleGeometry(1, 48);
  foot.scale(g.W * 0.47, g.G * 0.46, 1).rotateX(Math.PI / 2).translate(0, mm(0.2), 0);
  bag.mesh(foot, new MeshStandardMaterial({ color: new Color(film.color), roughness: 0.6, side: DoubleSide }), group);
  return {
    group,
    info: {},
    pose: () => undefined,
    applyTextures(tex) {
      for (const sid of surfaces) {
        const s = input.dieline.surfaces.find((x) => x.id === sid)!;
        const metal = film.value === 'metallised';
        printed(bag, sid, mats[sid], tex[sid], bleedBox(s), film.color, film.value === 'gloss' ? 0.22 : film.value === 'kraft' ? 0.88 : metal ? 0.22 : 0.55, film.value === 'gloss' ? 1 : 0, input.anisotropy, metal ? 'metal' : 'opaque');
        const f = finish.get(sid)!;
        // Crimped seals, the zipper bead and the tear notches.
        mats[sid].normalMap = f.normal;
        mats[sid].normalScale = new Vector2(0.9, 0.9);
        if (f.cut) { mats[sid].alphaMap = f.cut; mats[sid].alphaTest = 0.5; mats[sid].transparent = false; }
        if (metal) { mats[sid].anisotropy = 0.4; }
        if (film.value === 'kraft') {
          const owned: Texture[] = [];
          installDetailBump(mats[sid], detailUniforms('tooth', 18, 26, 0.5, input.anisotropy, owned), 'pouch-kraft');
          owned.forEach((t) => bag.texture(t));
        }
        mats[sid].needsUpdate = true;
      }
    },
    dispose: () => bag.dispose(),
  };
}

/**
 * The pouch web's own relief, in its texture box: a fine crimp pattern pressed into the side and
 * top seals, the zipper bead, and the tear notches cut out of the fins (alpha).
 */
function pouchFinish(bag: Bag, s: { w: number; h: number; holes?: { x: number; y: number }[][] }, box: { x: number; y: number; w: number; h: number }, g: ReturnType<typeof pouchGeometry>): { normal: Texture; cut: Texture | null } {
  const k = Math.min(6, 1600 / Math.max(box.w, box.h)); // px per pt
  const W = Math.round(box.w * k), H = Math.round(box.h * k);
  const c = createCanvas(W, H);
  const ctx = context2d(c);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const period = mm(0.9);
  for (let j = 0; j < H; j++) {
    const y = box.y + j / k;
    for (let i = 0; i < W; i++) {
      const x = box.x + i / k;
      let nx = 0, ny = 0;
      const inSide = (x < g.side || x > s.w - g.side) && y > 0;
      const inTop = y < g.top && y > -mm(1);
      if (inTop) nx = 0.55 * Math.cos((2 * Math.PI * x) / period);
      else if (inSide) ny = 0.55 * Math.cos((2 * Math.PI * y) / period);
      if (g.zip && Math.abs(y - g.zipY) < mm(1.4) && !inSide) { const t = (y - g.zipY) / mm(1.4); ny += 0.7 * t * Math.exp(-t * t * 1.5); }
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const o = 4 * (j * W + i);
      d[o] = (nx * 0.5 + 0.5) * 255; d[o + 1] = (-ny * 0.5 + 0.5) * 255; d[o + 2] = (nz * 0.5 + 0.5) * 255; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const normal = bag.texture(new CanvasTexture(c));
  normal.colorSpace = NoColorSpace;
  let cut: Texture | null = null;
  if (s.holes && s.holes.length) {
    const m = createCanvas(W, H);
    const mc = context2d(m);
    mc.fillStyle = '#fff'; mc.fillRect(0, 0, W, H);
    mc.setTransform(k, 0, 0, k, -box.x * k, -box.y * k);
    mc.fillStyle = '#000';
    for (const h of s.holes) { mc.beginPath(); h.forEach((p, i) => (i ? mc.lineTo(p.x, p.y) : mc.moveTo(p.x, p.y))); mc.closePath(); mc.fill(); }
    cut = bag.texture(new CanvasTexture(m));
    cut.colorSpace = NoColorSpace;
  }
  return { normal, cut };
}

/* -------------------------------------------------------------------------- */
/* Jar                                                                          */
/* -------------------------------------------------------------------------- */

export function buildJar(input: ModelInput): ProductModel {
  const o = input.options;
  const g = jarGeometry(o);
  const bag = new Bag();
  const group = new Group();
  const R = g.D / 2, wall = mm(3.2);
  const neckR = g.lidD / 2 - mm(1.2);
  const prof: [number, number][] = [[mm(2), 0], [0, R - mm(5)]];
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); prof.push([mm(5) * (1 - Math.cos(a)), R - mm(5) + mm(5) * Math.sin(a)]); }
  prof.push([g.H - g.shoulder, R]);
  for (let i = 1; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); prof.push([g.H - g.shoulder + (g.shoulder - mm(3)) * Math.sin(a), R - (R - neckR) * (1 - Math.cos(a))]); }
  prof.push([g.H, neckR], [g.H, neckR - wall]);
  bag.mesh(revolve(prof, 96), glassMaterial('flint', wall, input.scale), group);
  // Contents (opaque, refracted by the glass).
  const fillH = mm(4) + num(o, 'fill', 0.88) * (g.H - g.shoulder - mm(4));
  if (fillH > mm(6)) {
    const cprof: [number, number][] = [[mm(4), 0], [mm(4), R - wall - mm(3)], [mm(7), R - wall], [fillH - mm(2), R - wall], [fillH, R - wall - mm(3)], [fillH + mm(0.5), 0]];
    const contents = new MeshPhysicalMaterial({ color: new Color(str(o, 'contents', '#d9921c')), roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.2 });
    bag.mesh(revolve(cprof, 64), contents, group);
  }
  // Lid with a knurled skirt and a printed top.
  const lidKind = str(o, 'lid', 'gold');
  const lc = CAP_COLORS[lidKind] ?? CAP_COLORS.gold;
  const lidR = g.lidD / 2 + mm(0.8);
  const skirt = new CylinderGeometry(lidR, lidR, g.lidH, 160, 1, false);
  const pos = skirt.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z);
    if (r > lidR * 0.9) { const k = 1 + 0.006 * Math.cos(Math.atan2(x, z) * 80); pos.setX(i, x * k); pos.setZ(i, z * k); }
  }
  skirt.computeVertexNormals();
  skirt.translate(0, g.H - g.lidH * 0.55 + g.lidH / 2, 0);
  const lidMat = lidKind === 'wood' ? new MeshPhysicalMaterial({ color: new Color(lc.color), roughness: 0.65, clearcoat: 0.3 }) : metalMaterial(lc.color, lc.rough + 0.08, lc.metal);
  bag.mesh(skirt, lidMat, group);
  const lidS = input.dieline.surfaces.find((s) => s.id === 'lid');
  const topMat = printMaterial({ side: FrontSide, bumpScale: 0.6 });
  const top = new CircleGeometry(lidR - mm(2.2), 72);
  if (lidS) {
    const tb = bleedBox(lidS);
    const d = lidS.w, r0 = lidR - mm(2.2);
    const uv = top.getAttribute('uv'), p = top.getAttribute('position');
    for (let i = 0; i < uv.count; i++) { const [u, v] = surfaceUV(tb, d / 2 + (p.getX(i) * d) / 2 / r0, d / 2 - (p.getY(i) * d) / 2 / r0); uv.setXY(i, u, v); }
  }
  top.rotateX(-Math.PI / 2).translate(0, g.H + g.lidH * 0.45 + mm(0.15), 0);
  bag.mesh(top, topMat, group);
  // Label.
  const labelS = input.dieline.surfaces.find((s) => s.id === 'label')!;
  const { mat: labelMat } = labelMeshes(bag, labelPatch([[0, R], [g.H, R]], g.lw, g.ly, g.lh, 0, labelS, mm(0.3)), group, str(o, 'stock', 'white'), labelS);
  const stock = stockLook(str(o, 'stock', 'white'));
  return {
    group,
    info: { rollRadius: R },
    pose: () => undefined,
    applyTextures(tex) {
      const c = compose({ art: tex.label?.art ?? null, masks: tex.label?.masks ?? {}, base: stock.base, roughness: stock.rough, metalness: stock.metal, clearcoat: 0, mode: stock.mode, widthPt: bleedBox(labelS).w, anisotropy: input.anisotropy });
      bag.setComposite('label', c);
      applyComposite(labelMat, c);
      if (lidS && tex.lid) {
        const c2 = compose({ art: tex.lid.art, masks: tex.lid.masks, base: stock.mode === 'clear' ? lc.color : stock.base, roughness: stock.rough, metalness: 0, clearcoat: 0, mode: 'opaque', widthPt: bleedBox(lidS).w, anisotropy: input.anisotropy });
        bag.setComposite('lid', c2);
        applyComposite(topMat, c2);
      } else { topMat.map = null; topMat.color.set(lc.color); topMat.metalness = lc.metal; topMat.roughness = lc.rough; topMat.needsUpdate = true; }
    },
    dispose: () => bag.dispose(),
  };
}
