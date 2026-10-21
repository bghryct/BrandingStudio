/**
 * Glass bottles: revolved glass (transmission, IOR, tint) split at the fill level so the lower
 * part carries the liquid's colour as attenuation; front and back labels wrap the body, the neck
 * label follows the taper (its flat shape is the dieline's arc); capsule, crown, screw cap or cork.
 */
import { CylinderGeometry, Group, MeshPhysicalMaterial, MeshStandardMaterial, Color, DoubleSide, FrontSide, BackSide, Vector2, type BufferGeometry, type Mesh } from 'three';
import { bottleClosure, bottleLabels, labelStock, radiusAt } from '../../products/bottles';
import { makeWrap, mm, wrapToFlat } from '../../products/geom';
import { bool, num, str } from '../../products/types';
import type { DielineSurface } from '../../products/types';
import { revolve, profileBetween, glassMaterial, liquidGlassMaterial, printMaterial, metalMaterial, surfaceUV, bleedBox, type GlassKind } from '../build';
import { compose, applyComposite, dataTexture, type Composite } from '../finishing';
import { createCanvas, context2d } from '../texutil';
import { Bag, type ModelInput, type ProductModel } from './common';
import type { SurfaceTexture } from '../types';
import { tiledNormal } from '../assets';
import { Vector3 } from 'three';

/** Colour of a label stock's unprinted back (what shows through clear glass). */
const BACKING: Record<string, string> = { white: '#ece9e1', cream: '#e6dcc4', kraft: '#a98153', black: '#2a2928', metallic: '#d8dadc' };

/**
 * A paper label: printed face outward, the plain paper back inward (seen through the glass, the
 * back of a label is blank paper, not mirrored artwork). Clear film stays one double-sided sheet.
 */
export function labelMeshes(bag: Bag, geo: BufferGeometry, parent: Group, stock: string, s: DielineSurface): { mat: MeshPhysicalMaterial; back: MeshStandardMaterial | null } {
  const clear = stock === 'clear';
  const mat = printMaterial({ side: clear ? DoubleSide : FrontSide, bumpScale: 0.8 });
  // Paper tooth at ~16 mm per tile of the fibre map.
  const n = bag.texture(tiledNormal('paper', s.w / mm(16), s.h / mm(16)));
  mat.normalMap = n;
  mat.normalScale = new Vector2(0.22, 0.22);
  bag.mesh(geo, mat, parent);
  if (clear) return { mat, back: null };
  const back = new MeshStandardMaterial({ color: new Color(BACKING[stock] ?? BACKING.white), roughness: 0.92, side: BackSide });
  const m = bag.mesh(geo, back, parent);
  m.castShadow = false;
  return { mat, back };
}

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

  // Outer glass: a punt pushed up into the base (deep for wine), a thick glass bottom, the body
  // and shoulder, and a closed lip.
  const wine = def.id === 'bordeaux' || def.id === 'burgundy';
  const punt = mm(wine ? 28 : def.id === 'spirits' ? 9 : 4);
  const heelR = prof[0][1];
  const puntProf: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    // A rounded cone from the punt's top down to the resting ring.
    puntProf.push([punt * (1 - Math.pow(t, 1.6)) + mm(1.2) * Math.pow(t, 3), heelR * (0.08 + 0.78 * Math.sin((t * Math.PI) / 2))]);
  }
  const full: [number, number][] = [...puntProf, ...prof, [H, 0]];
  const liquid = bool(o, 'liquid', true);
  const neckTop = H - (closure === 'capsule' ? mm(8) : mm(14));
  const yb = mm(wine ? 6 : 4.5); // glass bottom thickness at the side
  const yL = Math.max(yb + mm(4), mm(5) + num(o, 'fill', 0.82) * (neckTop - mm(5)));
  const glass = glassMaterial(glassKind, wall, input.scale);
  const wet: MeshPhysicalMaterial[] = [glass];
  let band: Mesh | null = null;
  let menMesh: Mesh | null = null;
  if (liquid) {
    const at = (y: number): [number, number] => [y, radiusAt(prof, y)];
    const bottom: [number, number][] = [...puntProf, ...prof.filter(([y]) => y < yb), at(yb)];
    const bandProf: [number, number][] = [at(yb), ...prof.filter(([y]) => y > yb && y < yL), at(yL)];
    const upper: [number, number][] = [at(yL), ...prof.filter(([y]) => y > yL), [H, 0]];
    const lm = liquidGlassMaterial(glassKind, str(o, 'liquidColor', '#5b0f1c'), 2 * L.R, input.scale, 1);
    const thick = glassMaterial(glassKind, mm(9), input.scale);
    bag.mesh(revolve(bottom, 96), thick, group);
    band = bag.mesh(revolve(bandProf, 96), lm, group);
    band.userData.liquid = lm;
    bag.mesh(revolve(upper, 96), glass, group);
    wet.push(thick, lm);
    // Liquid surface with a meniscus climbing the glass.
    const rIn = Math.max(mm(1), radiusAt(prof, yL) - wall * 0.9);
    const men: [number, number][] = [[yL, 0], [yL, rIn * 0.55], [yL + mm(0.15), rIn * 0.8], [yL + mm(0.6), rIn * 0.93], [yL + mm(1.6), rIn]];
    const capMat = lm.clone();
    capMat.side = DoubleSide;
    menMesh = bag.mesh(revolve(men, 72), capMat, group);
  } else {
    bag.mesh(revolve(full, 96), glass, group);
  }

  // Labels.
  const stockId = str(o, 'stock', 'white');
  const stock = stockLook(stockId);
  const labels: { key: string; mat: MeshPhysicalMaterial; back: MeshStandardMaterial | null; s: DielineSurface; die: boolean }[] = [];
  const addLabel = (sid: string, geo: BufferGeometry, die: boolean) => {
    const s = input.dieline.surfaces.find((x) => x.id === sid);
    if (!s) return;
    const { mat, back } = labelMeshes(bag, geo, group, stockId, s);
    labels.push({ key: sid, mat, back, s, die });
    wet.push(mat);
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

  // Closure (lifted off for a pour).
  const closureGroup = new Group();
  group.add(closureGroup);
  const lipR = radiusAt(prof, H - mm(4));
  const cc = str(o, 'closureColor', '#2b2b2e');
  const finish = str(o, 'closureFinish', 'metallic');
  if (closure === 'capsule') {
    const capProf = profileBetween((y) => radiusAt(prof, y) + mm(0.5), H - closureLen, H, 40);
    capProf.push([H + mm(0.5), lipR * 0.6], [H + mm(0.6), 0]);
    const mat = finish === 'metallic' ? metalMaterial(cc, 0.32, 0.85) : new MeshPhysicalMaterial({ color: new Color(cc), roughness: finish === 'gloss' ? 0.18 : 0.6, clearcoat: finish === 'gloss' ? 1 : 0 });
    bag.mesh(revolve(capProf, 96), mat, closureGroup);
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
    bag.mesh(geo, metalMaterial(cc, 0.3, finish === 'metallic' ? 0.9 : 0.2), closureGroup);
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
    bag.mesh(geo, metalMaterial(cc, 0.34, finish === 'metallic' ? 0.9 : 0.15), closureGroup);
  } else {
    // Cork: a shank in the neck (seen through the glass) and a head.
    const shank = new CylinderGeometry(lipR - mm(3), lipR - mm(3.6), mm(26), 32).translate(0, H - mm(12), 0);
    const cork = new MeshPhysicalMaterial({ color: new Color('#c49a6c'), roughness: 0.9 });
    bag.mesh(shank, cork, closureGroup);
    const spirits = def.id === 'spirits';
    const headR = spirits ? lipR + mm(5) : lipR + mm(1.2);
    const headH = spirits ? mm(15) : mm(13);
    const head = new CylinderGeometry(spirits ? headR : headR, spirits ? headR : lipR - mm(1.5), headH, 48).translate(0, H + headH / 2, 0);
    const headMat = spirits ? new MeshPhysicalMaterial({ color: new Color(cc === '#2b2b2e' ? '#5b3a22' : cc), roughness: 0.5, clearcoat: 0.6 }) : cork;
    bag.mesh(head, headMat, closureGroup);
  }

  const capTop = closure === 'capsule' ? H - closureLen : H;
  return {
    group,
    info: {
      rollRadius: L.R,
      dew: { profile: prof, y0: mm(3), y1: capTop - mm(2), materials: wet, lift: mm(0.35) },
      pour: { mouth: new Vector3(0, H + mm(1), 0), radius: L.R, height: H, stream: mm(4.2) },
    },
    pose({ pour }) {
      const p = pour ?? 0;
      closureGroup.visible = p <= 0;
      // The bottle empties as it pours (its liquid is part of the glass): fade the fill out.
      if (band) band.material = p > 0.25 ? glass : (band.userData.liquid ?? band.material);
      if (menMesh) menMesh.visible = p <= 0.25;
    },
    applyTextures(tex) {
      for (const l of labels) {
        applyLabel(bag, l.key, l.mat, tex[l.key], l.s, stock, input.anisotropy, l.die);
        // The paper back takes the same die shape.
        if (l.back) { l.back.alphaMap = l.mat.alphaMap; l.back.alphaTest = l.mat.alphaMap ? 0.5 : 0; l.back.needsUpdate = true; }
      }
    },
    dispose: () => bag.dispose(),
  };
}

export { labelStock };
