/**
 * Glass bottles: revolved glass (transmission, IOR, tint) split at the fill level so the lower
 * part carries the liquid's colour as attenuation; front and back labels wrap the body, the neck
 * label follows the taper (its flat shape is the dieline's arc); capsule, crown, screw cap or cork.
 */
import { CylinderGeometry, Group, MeshPhysicalMaterial, CircleGeometry, Color, DoubleSide, type BufferGeometry } from 'three';
import { bottleClosure, bottleLabels, labelStock, radiusAt } from '../../products/bottles';
import { makeWrap, mm, wrapToFlat } from '../../products/geom';
import { bool, num, str } from '../../products/types';
import type { DielineSurface } from '../../products/types';
import { revolve, profileBetween, glassMaterial, liquidGlassMaterial, printMaterial, metalMaterial, surfaceUV, bleedBox, type GlassKind } from '../build';
import { compose, applyComposite, dataTexture, type Composite } from '../finishing';
import { createCanvas, context2d } from '../texutil';
import { Bag, type ModelInput, type ProductModel } from './common';
import type { SurfaceTexture } from '../types';

/** White-inside-the-cut alpha mask for a die-cut label (texture box layout). */
export function cutMaskCanvas(s: DielineSurface, px = 512): HTMLCanvasElement {
  const box = bleedBox(s);
  const k = px / Math.max(box.w, box.h);
  const c = createCanvas(box.w * k, box.h * k);
  const ctx = context2d(c);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  ctx.setTransform(k, 0, 0, k, -box.x * k, -box.y * k);
  for (const poly of s.cut) {
    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

/** Label mode and base colour from the stock. */
export function stockLook(stock: string): { mode: 'opaque' | 'clear'; base: string; rough: number; metal: number } {
  switch (stock) {
    case 'clear': return { mode: 'clear', base: '#ffffff', rough: 0.25, metal: 0 };
    case 'metallic': return { mode: 'opaque', base: '#c9cdd2', rough: 0.3, metal: 0.9 };
    case 'kraft': return { mode: 'opaque', base: '#b48a5a', rough: 0.9, metal: 0 };
    case 'black': return { mode: 'opaque', base: '#1d1c1c', rough: 0.8, metal: 0 };
    case 'cream': return { mode: 'opaque', base: '#eee4cc', rough: 0.88, metal: 0 };
    default: return { mode: 'opaque', base: '#f6f4ef', rough: 0.82, metal: 0 };
  }
}

/** Apply a label texture (with its die shape as alpha) to a material. */
export function applyLabel(bag: Bag, key: string, mat: MeshPhysicalMaterial, t: SurfaceTexture | undefined, s: DielineSurface, stock: ReturnType<typeof stockLook>, anisotropy: number, die: boolean) {
  const box = bleedBox(s);
  const c: Composite = compose({ art: t?.art ?? null, masks: t?.masks ?? {}, base: stock.base, roughness: stock.rough, metalness: stock.metal, clearcoat: 0, mode: stock.mode, widthPt: box.w, anisotropy });
  bag.setComposite(key, c);
  applyComposite(mat, c);
  if (die && stock.mode !== 'clear') {
    const tex = bag.texture(dataTexture(cutMaskCanvas(s), anisotropy));
    mat.alphaMap = tex;
    mat.alphaTest = 0.5;
    mat.transparent = false;
  }
  mat.needsUpdate = true;
}

/** A label wrapped on a revolved body: centred on angle `center`, from height y0 (bottom) up. */
export function labelPatch(prof: [number, number][], w: number, y0: number, h: number, center: number, s: DielineSurface, offset = mm(0.25)): BufferGeometry {
  const box = bleedBox(s);
  const r0 = radiusAt(prof, y0 + h / 2) + offset;
  const span = w / r0;
  const pts = profileBetween((y) => radiusAt(prof, y) + offset, y0, y0 + h, Math.max(6, Math.round(h / mm(3))));
  return revolve(pts, Math.max(24, Math.round(span * 40)), (f, _j, y) => surfaceUV(box, f * w, y0 + h - y), center - span / 2, center + span / 2);
}

export function buildBottle(input: ModelInput): ProductModel {
  const o = input.options;
  const L = bottleLabels(o);
  const { def, prof } = L;
  const bag = new Bag();
  const group = new Group();
  const H = prof[prof.length - 1][0];
  const glassKind = str(o, 'glass', 'green') as GlassKind;
  const closure = bottleClosure(o);
  const closureLen = mm(def.closureLen);
  const wall = mm(3);

  // Outer glass with a punt-raised base and a closed lip.
  const full: [number, number][] = [[mm(3), 0], ...prof, [H, 0]];
  const liquid = bool(o, 'liquid', true);
  const neckTop = H - (closure === 'capsule' ? mm(8) : mm(14));
  const yL = mm(5) + num(o, 'fill', 0.82) * (neckTop - mm(5));
  if (liquid) {
    const lower = full.filter(([y]) => y <= yL);
    lower.push([yL, radiusAt(prof, yL)]);
    const upper: [number, number][] = [[yL, radiusAt(prof, yL)], ...full.filter(([y]) => y > yL)];
    const lm = liquidGlassMaterial(glassKind, str(o, 'liquidColor', '#5b0f1c'), 2 * L.R, input.scale, 1);
    bag.mesh(revolve(lower, 96), lm, group);
    bag.mesh(revolve(upper, 96), glassMaterial(glassKind, wall, input.scale), group);
    const cap = new CircleGeometry(Math.max(1, radiusAt(prof, yL) - wall * 0.9), 64).rotateX(-Math.PI / 2).translate(0, yL, 0);
    const capMat = lm.clone();
    capMat.side = DoubleSide;
    bag.mesh(cap, capMat, group);
  } else {
    bag.mesh(revolve(full, 96), glassMaterial(glassKind, wall, input.scale), group);
  }

  // Labels.
  const stock = stockLook(str(o, 'stock', 'white'));
  const labels: { key: string; mat: MeshPhysicalMaterial; s: DielineSurface; die: boolean }[] = [];
  const addLabel = (sid: string, geo: BufferGeometry, die: boolean) => {
    const s = input.dieline.surfaces.find((x) => x.id === sid);
    if (!s) return;
    const mat = printMaterial({ side: DoubleSide, bumpScale: 0.8 });
    bag.mesh(geo, mat, group);
    labels.push({ key: sid, mat, s, die });
  };
  const front = input.dieline.surfaces.find((s) => s.id === 'front');
  if (front) addLabel('front', labelPatch(prof, L.front.w, L.front.y, L.front.h, 0, front), front.cutKind === 'die');
  const back = input.dieline.surfaces.find((s) => s.id === 'back');
  if (back) addLabel('back', labelPatch(prof, L.back.w, L.back.y, L.back.h, Math.PI, back), false);
  const neck = input.dieline.surfaces.find((s) => s.id === 'neck');
  if (neck) {
    const n = L.neck;
    const wrap = makeWrap(n.rBottom, n.rTop, n.y1 - n.y0, mm(5));
    const box = bleedBox(neck);
    const pts = profileBetween((y) => n.rBottom + ((n.rTop - n.rBottom) * (y - n.y0)) / (n.y1 - n.y0) + mm(0.35), n.y0, n.y1, 8);
    const geo = revolve(pts, 96, (f, _j, y) => {
      const p = wrapToFlat(wrap, (y - n.y0) / (n.y1 - n.y0), f);
      return surfaceUV(box, p.x, p.y);
    }, Math.PI, 3 * Math.PI);
    addLabel('neck', geo, false);
  }

  // Closure.
  const lipR = radiusAt(prof, H - mm(4));
  const cc = str(o, 'closureColor', '#2b2b2e');
  const finish = str(o, 'closureFinish', 'metallic');
  if (closure === 'capsule') {
    const capProf = profileBetween((y) => radiusAt(prof, y) + mm(0.5), H - closureLen, H, 40);
    capProf.push([H + mm(0.5), lipR * 0.6], [H + mm(0.6), 0]);
    const mat = finish === 'metallic' ? metalMaterial(cc, 0.32, 0.85) : new MeshPhysicalMaterial({ color: new Color(cc), roughness: finish === 'gloss' ? 0.18 : 0.6, clearcoat: finish === 'gloss' ? 1 : 0 });
    bag.mesh(revolve(capProf, 96), mat, group);
  } else if (closure === 'crown') {
    const geo = new CylinderGeometry(lipR + mm(1.4), lipR + mm(1.4), mm(6.5), 84, 2, false);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      const a = Math.atan2(x, z), r = Math.hypot(x, z);
      if (r > 0.01) {
        const k = 1 + (y < 0 ? 0.045 : 0.02) * Math.cos(a * 21);
        pos.setX(i, x * k); pos.setZ(i, z * k);
      }
    }
    geo.computeVertexNormals();
    geo.translate(0, H - mm(2.2), 0);
    bag.mesh(geo, metalMaterial(cc, 0.3, finish === 'metallic' ? 0.9 : 0.2), group);
  } else if (closure === 'screw') {
    const geo = new CylinderGeometry(lipR + mm(1.6), lipR + mm(1.6), mm(16), 120, 1, false);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const a = Math.atan2(x, z), r = Math.hypot(x, z);
      if (r > lipR) { const k = 1 + 0.012 * Math.cos(a * 60); pos.setX(i, x * k); pos.setZ(i, z * k); }
    }
    geo.computeVertexNormals();
    geo.translate(0, H - mm(7), 0);
    bag.mesh(geo, metalMaterial(cc, 0.34, finish === 'metallic' ? 0.9 : 0.15), group);
  } else {
    // Cork: a shank in the neck (seen through the glass) and a head.
    const shank = new CylinderGeometry(lipR - mm(3), lipR - mm(3.6), mm(26), 32).translate(0, H - mm(12), 0);
    const cork = new MeshPhysicalMaterial({ color: new Color('#c49a6c'), roughness: 0.9 });
    bag.mesh(shank, cork, group);
    const spirits = def.id === 'spirits';
    const headR = spirits ? lipR + mm(5) : lipR + mm(1.2);
    const headH = spirits ? mm(15) : mm(13);
    const head = new CylinderGeometry(spirits ? headR : headR, spirits ? headR : lipR - mm(1.5), headH, 48).translate(0, H + headH / 2, 0);
    const headMat = spirits ? new MeshPhysicalMaterial({ color: new Color(cc === '#2b2b2e' ? '#5b3a22' : cc), roughness: 0.5, clearcoat: 0.6 }) : cork;
    bag.mesh(head, headMat, group);
  }

  return {
    group,
    info: { rollRadius: L.R },
    pose: () => undefined,
    applyTextures(tex) {
      for (const l of labels) applyLabel(bag, l.key, l.mat, tex[l.key], l.s, stock, input.anisotropy, l.die);
    },
    dispose: () => bag.dispose(),
  };
}

export { labelStock };
