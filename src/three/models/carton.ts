/**
 * Folding cartons from their dieline's hinge tree: every panel is a printed face (net-space UVs)
 * backed by the board's inside colour, hung from a pivot on the hinge it shares with its parent.
 * Folding turns each hinge away from the printed side during its stage of the fold-up, so the
 * same model shows the flat sheet, the box closing, and the finished box (tuck boxes, mailers,
 * sleeves — the sleeve also carries a tray that slides out).
 */
import { BoxGeometry, Color, Group, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Quaternion, Vector3, BackSide, FrontSide } from 'three';
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

const COATING: Record<string, { rough: number; cc: number }> = {
  matte: { rough: 0.62, cc: 0 }, gloss: { rough: 0.3, cc: 1 }, 'soft-touch': { rough: 0.9, cc: 0 }, uncoated: { rough: 0.85, cc: 0 },
};

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
  bag.add(outside); bag.add(inside);
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
      const c = compose({ art: t?.art ?? null, masks: t?.masks ?? {}, base: board.outside, roughness: board.value === 'kraft' || board.value === 'corrugated' ? 0.9 : co.rough, metalness: 0, clearcoat: co.cc, mode: 'opaque', widthPt: box.w, anisotropy: input.anisotropy, maxPx: 3072 });
      bag.setComposite('outside', c);
      applyComposite(outside, c);
      if (str(o, 'finish') === 'soft-touch') { outside.sheen = 0.4; outside.sheenRoughness = 0.8; }
    },
    dispose: () => bag.dispose(),
  };
  model.pose({ fold: 1, open: 0, roll: 0 });
  return model;
}

export { BackSide };
