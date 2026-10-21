/**
 * Folding cartons from their dieline's hinge tree: every panel is a printed face (net-space UVs)
 * backed by the board's inside colour, hung from a pivot on the hinge it shares with its parent.
 * Folding turns each hinge away from the printed side during its stage of the fold-up, so the
 * same model shows the flat sheet, the box closing, and the finished box (tuck boxes, mailers,
 * sleeves — the sleeve also carries a tray that slides out).
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Quaternion, Vector2, Vector3, BackSide, FrontSide } from 'three';
import { tiledNormal } from '../assets';
import { CatmullRomCurve3, ExtrudeGeometry, Shape, TubeGeometry } from 'three';
import type { NetNode, P2 } from '../../products/types';
import { mm } from '../../products/geom';
import { boardOf } from '../../products/cartons';
import { num, str } from '../../products/types';
import { flatShape, printMaterial, surfaceUV, bleedBox } from '../build';
import { compose, applyComposite } from '../finishing';
import { Bag, type ModelInput, type ProductModel } from './common';

interface Hinge { node: NetNode; pivot: Object3D; axis: Vector3; sign: number }

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t: number) => t * t * (3 - 2 * t);

const FLAP = /^(tuck|dust|ear|glue)|^lid-(l|r|tuck)$/;

const COATING: Record<string, { rough: number; cc: number; fibre: number }> = {
  matte: { rough: 0.62, cc: 0, fibre: 0.2 }, gloss: { rough: 0.34, cc: 1, fibre: 0.07 }, 'soft-touch': { rough: 0.92, cc: 0, fibre: 0.12 }, uncoated: { rough: 0.86, cc: 0, fibre: 0.32 },
};

/** The cut edge of a board panel: a band around its outline, one caliper deep. */
function edgeBand(poly: { x: number; y: number }[], z0: number, depth: number): BufferGeometry {
  const n = poly.length;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += -p.y; }
  cx /= n; cy /= n;
  const pos: number[] = [], nrm: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ax = a.x, ay = -a.y, bx = b.x, by = -b.y;
    let nx = by - ay, ny = -(bx - ax);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    if (nx * ((ax + bx) / 2 - cx) + ny * ((ay + by) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const z1 = z0 - depth;
    pos.push(ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z0, bx, by, z1, ax, ay, z1);
    for (let k = 0; k < 6; k++) nrm.push(nx, ny, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  return g;
}

export function buildCarton(input: ModelInput): ProductModel {
  const o = input.options;
  const surface = input.dieline.surfaces[0];
  const net = surface.net ?? [];
  const bag = new Bag();
  const group = new Group();
  const assembly = new Group();
  const board = boardOf(o);
  const caliper = mm(board.caliper);
  const box = bleedBox(surface);
  const outside = printMaterial({ side: FrontSide, bumpScale: 0.8 });
  const inside = new MeshStandardMaterial({ color: new Color(board.inside), roughness: 0.92, side: FrontSide });
  // Cut edges: the board's core shows (lighter fluting on corrugated, a greyish core on GC1).
  const edgeColor = board.value === 'corrugated' ? '#cfae82' : board.value === 'gc1' ? '#bdb9b0' : new Color(board.inside).multiplyScalar(0.9).getStyle();
  const edgeMat = new MeshStandardMaterial({ color: new Color(edgeColor), roughness: 0.95, side: DoubleSide });
  bag.add(outside); bag.add(inside); bag.add(edgeMat);
  // Fibre of the board under the coating.
  const kraftLike = board.value === 'kraft' || board.value === 'corrugated';
  outside.normalMap = bag.texture(tiledNormal(kraftLike ? 'kraft' : 'paper', box.w / mm(22), box.h / mm(22)));
  inside.normalMap = bag.texture(tiledNormal('kraft', box.w / mm(22), box.h / mm(22)));
  inside.normalScale = new Vector2(0.35, 0.35);
  const uv = (p: P2) => surfaceUV(box, p.x, p.y);

  // Build the hinge tree. Net (x, y-down) → 3D (x, −y, 0); printed side faces +z.
  const pivots = new Map<string, Object3D>();
  const origins = new Map<string, P2>();
  const hinges: Hinge[] = [];
  const order = [...net].sort((a, b) => (a.parent === null ? -1 : b.parent === null ? 1 : 0));
  const pending = new Map(order.map((n) => [n.id, n]));
  const place = (n: NetNode) => {
    const pivot = new Object3D();
    const origin = n.hinge ? n.hinge[0] : { x: 0, y: 0 };
    origins.set(n.id, origin);
    const parentOrigin = n.parent ? origins.get(n.parent)! : { x: 0, y: 0 };
    pivot.position.set(origin.x - parentOrigin.x, -(origin.y - parentOrigin.y), 0);
    // Flaps that tuck inside (tucks, dust flaps, ears, glue flaps, lid flaps) hinge a hair inside
    // the parent's edge, so they fold in behind the walls instead of lying on top of them.
    if (n.hinge && n.parent && FLAP.test(n.id)) {
      const par = net.find((x) => x.id === n.parent)!;
      const pcx = par.poly.reduce((acc, p) => acc + p.x, 0) / par.poly.length, pcy = par.poly.reduce((acc, p) => acc + p.y, 0) / par.poly.length;
      const [a, b] = n.hinge;
      const ax = b.x - a.x, ay = b.y - a.y, al = Math.hypot(ax, ay) || 1;
      let nx = -ay / al, ny = ax / al;
      if (nx * (pcx - (a.x + b.x) / 2) + ny * (pcy - (a.y + b.y) / 2) < 0) { nx = -nx; ny = -ny; }
      const inset = caliper * 2 + mm(0.4);
      pivot.position.x += nx * inset;
      pivot.position.y += -ny * inset;
    }
    (n.parent ? pivots.get(n.parent)! : assembly).add(pivot);
    pivots.set(n.id, pivot);
    // Faces in pivot-local coordinates.
    const local = n.poly.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
    // Panels folded back on themselves (double walls) sit one board thickness further in.
    const zOff = n.angle > 150 ? 2 * caliper : 0;
    const front = flatShape(local, (p) => uv({ x: p.x + origin.x, y: p.y + origin.y }), zOff);
    const backFace = flatShape(local, () => [0, 0], zOff - caliper, true);
    // Only the outer faces of the outer panels cast shadows: tucked flaps and the board's inside
    // face sit a fraction of a millimetre behind them and would bleed into the variance shadow map.
    const tucked = FLAP.test(n.id) || /-in$/.test(n.id);
    const fm = bag.mesh(front, outside, pivot);
    fm.castShadow = !tucked;
    const bm = bag.mesh(backFace, inside, pivot);
    bm.castShadow = false;
    // The board's thickness at the cut edges (seen at grazing angles and on corrugated board).
    const em = bag.mesh(edgeBand(local, zOff, caliper), edgeMat, pivot);
    em.castShadow = false;
    // A rounded crease along structural folds: a bead on the hinge line coloured by the artwork
    // under it, so box edges catch a soft highlight instead of meeting at a knife edge.
    if (n.hinge && !tucked && n.angle > 60 && n.angle < 120) {
      const [a, b] = n.hinge;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const r = Math.max(caliper * 0.9, mm(0.35));
      const cyl = new CylinderGeometry(r, r, len, 10, 1, true);
      const uvs = cyl.getAttribute('uv'), cp = cyl.getAttribute('position');
      for (let i = 0; i < cp.count; i++) {
        const t = cp.getY(i) / len + 0.5;
        const [u, v] = uv({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        uvs.setXY(i, u, v);
      }
      // Along the hinge (pivot space: x right, y up) and sunk half a caliper into the board.
      cyl.rotateZ(-Math.atan2(b.x - a.x, -(b.y - a.y)));
      cyl.translate((b.x - a.x) / 2, -(b.y - a.y) / 2, -caliper * 0.5);
      const bead = bag.mesh(cyl, outside, pivot);
      bead.castShadow = false;
    }
    if (n.hinge) {
      const [a, b] = n.hinge;
      const axis = new Vector3(b.x - a.x, -(b.y - a.y), 0).normalize();
      // Fold away from the printed side: the child must lie to the right of the axis.
      const cx = n.poly.reduce((s, p) => s + p.x, 0) / n.poly.length - a.x;
      const cy = -(n.poly.reduce((s, p) => s + p.y, 0) / n.poly.length - a.y);
      const cross = axis.x * cy - axis.y * cx; // z of axis × (centroid − a)
      const sign = cross > 0 ? -1 : 1;
      hinges.push({ node: n, pivot, axis, sign });
    }
  };
  // Parents before children.
  let guard = 0;
  while (pending.size && guard++ < 200) {
    for (const n of [...pending.values()]) {
      if (n.parent === null || pivots.has(n.parent)) { place(n); pending.delete(n.id); }
    }
  }
  group.add(assembly);

  // Paper bag handles: twisted paper rope (or flat tape) glued inside the turn-in of the front
  // and the back, rising over the top edge.
  if (input.template === 'paper-bag' && str(o, 'handles', 'twisted') !== 'none') {
    const flat = str(o, 'handles') === 'flat';
    const hm = new MeshStandardMaterial({ color: new Color(str(o, 'handleColor', '#a47b4f')), roughness: 0.88 });
    hm.normalMap = bag.texture(tiledNormal(flat ? 'kraft' : 'canvas', flat ? 6 : 60, flat ? 1 : 2));
    bag.add(hm);
    for (const id of ['front', 'back']) {
      const nd = net.find((x) => x.id === id), pv = pivots.get(id), org = origins.get(id);
      if (!nd || !pv || !org) continue;
      const xs = nd.poly.map((p) => p.x), ys = nd.poly.map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), top = Math.min(...ys);
      const w = x1 - x0;
      const xa = x0 + w * 0.3, xb = x0 + w * 0.7;
      const rise = Math.min(mm(110), w * 0.42);
      const zIn = -caliper * 3 - mm(2);
      const pts: Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const yNet = top + mm(24) - (mm(24) + rise) * Math.pow(Math.sin(Math.PI * t), 0.8);
        pts.push(new Vector3(xa + (xb - xa) * t - org.x, -(yNet - org.y), zIn - mm(3) * Math.sin(Math.PI * t)));
      }
      const curve = new CatmullRomCurve3(pts);
      let geo;
      if (flat) {
        const sh = new Shape();
        sh.moveTo(-mm(0.5), -mm(7)); sh.lineTo(mm(0.5), -mm(7)); sh.lineTo(mm(0.5), mm(7)); sh.lineTo(-mm(0.5), mm(7)); sh.closePath();
        geo = new ExtrudeGeometry(sh, { steps: 80, extrudePath: curve, bevelEnabled: false });
      } else geo = new TubeGeometry(curve, 80, mm(2.6), 10, false);
      const m = bag.mesh(geo, hm, pv);
      m.castShadow = true;
    }
  }

  // Rest orientation of the finished box.
  const tpl = input.template;
  const L = num(o, 'length'), W = num(o, 'width'), D = num(o, 'depth');
  const root = net.find((n) => n.parent === null);
  const rootBox = root ? root.poly.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), y0: Math.min(b.y0, p.y), y1: Math.max(b.y1, p.y) }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }) : { x0: 0, x1: 0, y0: 0, y1: 0 };
  // Tray for sleeves.
  let tray: Group | null = null;
  if (tpl === 'sleeve') {
    tray = new Group();
    const tc = str(o, 'tray', '#efe9df');
    const tm = new MeshPhysicalMaterial({ color: new Color(tc), roughness: 0.8 });
    const t = caliper * 1.2, tl = L - mm(1.5), tw = W - mm(1.5), td = D - mm(1);
    const parts: [number, number, number, number, number, number][] = [
      [tl, t, td, 0, -tw / 2 + t / 2, 0], [tl, tw, t, 0, 0, -td / 2 + t / 2], [tl, tw, t, 0, 0, td / 2 - t / 2], [t, tw, td, -tl / 2 + t / 2, 0, 0], [t, tw, td, tl / 2 - t / 2, 0, 0],
    ];
    for (const [x, y, z, px, py, pz] of parts) {
      const m = bag.mesh(new BoxGeometry(x, y, z), tm, tray);
      m.position.set(px, py, pz);
    }
    group.add(tray);
  }

  const qa = new Quaternion();
  const restQ = new Quaternion();
  const flatQ = new Quaternion();
  const center = new Vector3();
  const model: ProductModel = {
    group,
    info: { hasFold: true, hasOpen: tpl === 'sleeve' },
    pose({ fold, open }) {
      for (const h of hinges) {
        const [s0, s1] = h.node.stage;
        const t = s1 > s0 ? ease(clamp01((fold - s0) / (s1 - s0))) : fold >= s1 ? 1 : 0;
        qa.setFromAxisAngle(h.axis, h.sign * ((h.node.angle * Math.PI) / 180) * t);
        h.pivot.quaternion.copy(qa);
      }
      assembly.updateMatrixWorld(true);
      // Orientation: the flat sheet faces the camera; the finished box stands (or lies) at rest.
      if (tpl === 'mailer') restQ.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2).premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI));
      else if (tpl === 'sleeve') restQ.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
      else restQ.identity();
      flatQ.identity();
      const k = ease(clamp01((fold - 0.55) / 0.45));
      assembly.quaternion.copy(flatQ).slerp(restQ, k);
      // Centre the assembled box over the origin, resting on the ground.
      assembly.position.set(0, 0, 0);
      group.updateMatrixWorld(true);
      const inv = group.matrixWorld.clone().invert();
      const b = new Vector3(Infinity, Infinity, Infinity), e = new Vector3(-Infinity, -Infinity, -Infinity);
      assembly.traverse((obj) => {
        const mesh = obj as { geometry?: { boundingBox: { min: Vector3; max: Vector3 } | null; computeBoundingBox(): void } };
        if (!mesh.geometry || obj === tray || tray?.children.includes(obj)) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox!;
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
          const p = new Vector3(x, y, z).applyMatrix4(obj.matrixWorld).applyMatrix4(inv);
          b.min(p); e.max(p);
        }
      });
      center.addVectors(b, e).multiplyScalar(0.5);
      const lift = fold < 1 ? mm(20) * (1 - k) : 0;
      assembly.position.set(-center.x, -b.y + lift, -center.z);
      if (tray) {
        tray.position.set(0, (e.y - b.y) / 2, 0);
        const slide = ease(clamp01(open)) * L * 0.62;
        tray.visible = fold > 0.92;
        tray.position.z = slide;
      }
      void rootBox;
    },
    applyTextures(tex) {
      const t = tex[surface.id];
      const co = COATING[str(o, 'finish', 'matte')] ?? COATING.matte;
      const c = compose({ art: t?.art ?? null, masks: t?.masks ?? {}, base: board.outside, roughness: kraftLike ? 0.9 : co.rough, metalness: 0, clearcoat: co.cc, mode: 'opaque', widthPt: box.w, anisotropy: input.anisotropy });
      bag.setComposite('outside', c);
      applyComposite(outside, c, co.cc ? 0.03 : 0.06);
      const fibre = kraftLike ? 0.45 : co.fibre;
      outside.normalScale = new Vector2(fibre, fibre);
      if (str(o, 'finish') === 'soft-touch') { outside.sheen = 0.45; outside.sheenRoughness = 0.85; outside.sheenColor = new Color('#ffffff'); }
    },
    dispose: () => bag.dispose(),
  };
  model.pose({ fold: 1, open: 0, roll: 0 });
  return model;
}

export { BackSide };
