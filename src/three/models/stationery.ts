/**
 * Stationery: a pair of business cards (front up, and a second one turned to show its back) with
 * real thickness and painted edges, and a letterhead sheet with a gentle curl.
 */
import { Color, ExtrudeGeometry, Group, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Shape, FrontSide, DoubleSide } from 'three';
import { cardGeometry, CARD_STOCKS } from '../../products/stationery';
import { mm } from '../../products/geom';
import { str } from '../../products/types';
import { flatShape, grid, printMaterial, surfaceUV, bleedBox } from '../build';
import { compose, applyComposite, installDetailBump, detailUniforms } from '../finishing';
import { Bag, type ModelInput, type ProductModel } from './common';
import type { Texture } from 'three';

const FINISH: Record<string, { rough: number; cc: number; sheen: number }> = {
  uncoated: { rough: 0.9, cc: 0, sheen: 0 }, matte: { rough: 0.7, cc: 0, sheen: 0 }, 'soft-touch': { rough: 0.92, cc: 0, sheen: 0.35 }, gloss: { rough: 0.3, cc: 1, sheen: 0 },
};

export function buildCard(input: ModelInput): ProductModel {
  const o = input.options;
  const g = cardGeometry(o);
  const bag = new Bag();
  const group = new Group();
  const front = input.dieline.surfaces.find((s) => s.id === 'front')!;
  const back = input.dieline.surfaces.find((s) => s.id === 'back')!;
  const stock = CARD_STOCKS.find((s) => s.value === str(o, 'stock')) ?? CARD_STOCKS[0];
  const fin = FINISH[str(o, 'finish', 'uncoated')] ?? FINISH.uncoated;
  const edgePaint = str(o, 'edge', '#00000000');
  const edgeColor = /^#[0-9a-f]{6}00$/i.test(edgePaint) ? stock.color : edgePaint.slice(0, 7);
  const cut = front.cut[0];
  const T = g.thickness;
  const fm = printMaterial({ side: FrontSide, sheen: fin.sheen, bumpScale: 0.7 });
  const bm = printMaterial({ side: FrontSide, sheen: fin.sheen, bumpScale: 0.7 });
  const edge = new MeshStandardMaterial({ color: new Color(edgeColor), roughness: 0.85 });
  const hidden = new MeshStandardMaterial({ visible: false });
  bag.add(fm); bag.add(bm); bag.add(edge); bag.add(hidden);
  const owned: Texture[] = [];
  if (str(o, 'stock') === 'cotton' || str(o, 'stock') === 'cream') {
    installDetailBump(fm, detailUniforms('tooth', g.w / mm(6), g.h / mm(6), 0.5, input.anisotropy, owned), 'card-tooth');
    installDetailBump(bm, detailUniforms('tooth', g.w / mm(6), g.h / mm(6), 0.5, input.anisotropy, owned), 'card-tooth');
  }
  owned.forEach((t) => bag.texture(t));
  const fb = bleedBox(front), bb = bleedBox(back);
  const makeCard = () => {
    const card = new Object3D();
    // Built in the XY plane (y up = towards the top of the art), centred, then laid flat.
    const centred = cut.map((p) => ({ x: p.x - g.w / 2, y: p.y - g.h / 2 }));
    const top = flatShape(centred, (p) => surfaceUV(fb, p.x + g.w / 2, p.y + g.h / 2), T / 2);
    const bot = flatShape(centred, (p) => surfaceUV(bb, g.w / 2 - p.x, p.y + g.h / 2), -T / 2, true);
    const shape = new Shape(centred.map((p) => ({ x: p.x, y: -p.y })) as never);
    const side = new ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 12 });
    side.translate(0, 0, -T / 2);
    bag.mesh(top, fm, card);
    bag.mesh(bot, bm, card);
    bag.mesh(side, [hidden, edge], card);
    card.rotation.x = -Math.PI / 2;
    return card;
  };
  const a = new Group(), b = new Group();
  a.add(makeCard());
  const bc = makeCard();
  bc.rotation.y = Math.PI; // turned over: its back faces up
  b.add(bc);
  a.position.set(-g.w * 0.28, T / 2, g.h * 0.12);
  a.rotation.y = 0.18;
  b.position.set(g.w * 0.42, T / 2, -g.h * 0.32);
  b.rotation.y = -0.22;
  group.add(a, b);
  return {
    group,
    info: { lying: true, hasOpen: true },
    pose({ open }) {
      // "Spin": the front card lifts and flips over its long axis.
      const t = Math.max(0, Math.min(1, open));
      a.position.y = T / 2 + Math.sin(Math.PI * t) * g.h * 0.55;
      a.rotation.z = t * Math.PI * 2;
    },
    applyTextures(tex) {
      for (const [key, s, m] of [['front', front, fm], ['back', back, bm]] as const) {
        const c = compose({ art: tex[key]?.art ?? null, masks: tex[key]?.masks ?? {}, base: stock.color, roughness: fin.rough, metalness: 0, clearcoat: fin.cc, mode: 'opaque', widthPt: bleedBox(s).w, anisotropy: input.anisotropy });
        bag.setComposite(key, c);
        applyComposite(m, c);
      }
    },
    dispose: () => bag.dispose(),
  };
}

export function buildLetterhead(input: ModelInput): ProductModel {
  const o = input.options;
  const s = input.dieline.surfaces[0];
  const box = bleedBox(s);
  const stock = CARD_STOCKS.find((x) => x.value === str(o, 'stock')) ?? CARD_STOCKS[0];
  const bag = new Bag();
  const group = new Group();
  const W = s.w, H = s.h;
  const geo = grid(W, H, 40, 56, (u, v) => {
    const curl = Math.pow(Math.max(0, u + v - 1.35) / 0.65, 2) * mm(14);
    return { x: (u - 0.5) * W, y: (0.5 - v) * H, z: curl + Math.sin(u * Math.PI) * mm(1.5), uv: surfaceUV(box, u * W, v * H) };
  });
  const mat = printMaterial({ side: DoubleSide, bumpScale: 0.4 });
  const owned: Texture[] = [];
  installDetailBump(mat, detailUniforms('tooth', W / mm(8), H / mm(8), 0.35, input.anisotropy, owned), 'sheet-tooth');
  owned.forEach((t) => bag.texture(t));
  const sheet = bag.mesh(geo, mat, group);
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.y = mm(0.2);
  return {
    group,
    info: { lying: true },
    pose: () => undefined,
    applyTextures(tex) {
      const c = compose({ art: tex[s.id]?.art ?? null, masks: tex[s.id]?.masks ?? {}, base: stock.color, roughness: 0.88, metalness: 0, clearcoat: 0, mode: 'opaque', widthPt: box.w, anisotropy: input.anisotropy });
      bag.setComposite('sheet', c);
      applyComposite(mat, c);
    },
    dispose: () => bag.dispose(),
  };
}

export { MeshPhysicalMaterial };
