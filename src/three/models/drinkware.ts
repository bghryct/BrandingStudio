/**
 * Paper coffee cup (conical wrap mapped through the dieline's arc development, rolled rim,
 * snap-on lid, optional kraft sleeve) and a ceramic mug (glazed body, sublimation wrap that stops
 * short of the handle, coloured interior and handle).
 */
import { CatmullRomCurve3, Color, DoubleSide, FrontSide, Group, MeshPhysicalMaterial, TubeGeometry, Vector3 } from 'three';
import { cupGeometry, mugGeometry } from '../../products/drinkware';
import { mm, wrapToFlat } from '../../products/geom';
import { bool, str } from '../../products/types';
import { revolve, profileBetween, printMaterial, plasticMaterial, surfaceUV, bleedBox } from '../build';
import { compose, applyComposite } from '../finishing';
import { Bag, type ModelInput, type ProductModel } from './common';
import { tiledNormal } from '../assets';
import { Vector2 } from 'three';

export function buildCup(input: ModelInput): ProductModel {
  const o = input.options;
  const g = cupGeometry(o);
  const bag = new Bag();
  const group = new Group();
  const s = input.dieline.surfaces[0];
  const box = bleedBox(s);
  const paper = str(o, 'paper', 'white');
  const base = paper === 'kraft' ? '#b38858' : paper === 'black' ? '#1d1c1e' : '#fbfaf7';
  const innerColor = paper === 'black' ? '#262426' : paper === 'kraft' ? '#c19a6c' : '#f4f2ee';
  // Printed band (the wrap) and plain paper below / above it.
  const band = profileBetween(g.rAt, g.y0, g.y1, 24);
  const bandMat = printMaterial({ side: FrontSide, bumpScale: 0.6 });
  bandMat.normalMap = bag.texture(tiledNormal(paper === 'kraft' ? 'kraft' : 'paper', box.w / mm(20), box.h / mm(20)));
  bandMat.normalScale = new Vector2(0.28, 0.28);
  bag.mesh(revolve(band, 128, (f, _j, y) => { const p = wrapToFlat(g.wrap, (y - g.y0) / (g.y1 - g.y0), f); return surfaceUV(box, p.x, p.y); }), bandMat, group);
  const plain = new MeshPhysicalMaterial({ color: new Color(base), roughness: 0.75 });
  const dewProfile = profileBetween(g.rAt, mm(0.6), g.H - mm(2), 24);
  bag.mesh(revolve([[mm(1.2), g.rBottom - mm(1)], [0, g.rBottom - mm(0.4)], [mm(0.6), g.rBottom], ...profileBetween(g.rAt, mm(0.6), g.y0, 3)], 96), plain, group);
  // Rolled rim.
  const rimProf: [number, number][] = [[g.y1, g.rAt(g.y1)]];
  const rc = g.rim / 2;
  for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + (i / 16) * Math.PI * 1.6; rimProf.push([g.H - rc + rc * Math.sin(a), g.rTop + rc * 0.2 + rc * Math.cos(a)]); }
  bag.mesh(revolve(rimProf, 96), plain, group);
  // Inside.
  const inner = new MeshPhysicalMaterial({ color: new Color(innerColor), roughness: 0.82, side: DoubleSide });
  bag.mesh(revolve(profileBetween((y) => g.rAt(y) - mm(0.4), g.foot, g.H - mm(0.5), 12), 96, undefined, -Math.PI, Math.PI, true), inner, group);
  // Lid.
  const lidKind = str(o, 'lid', 'white');
  if (lidKind !== 'none') {
    const r = g.rTop, H = g.H;
    const lp: [number, number][] = [[H - mm(5), r + mm(1.6)], [H + mm(1.5), r + mm(2.4)], [H + mm(4.5), r + mm(1.8)], [H + mm(5.2), r - mm(1.5)], [H + mm(7), r - mm(4)], [H + mm(13), r - mm(8)], [H + mm(15.5), r * 0.62], [H + mm(16), r * 0.3], [H + mm(16), 0]];
    const lm = plasticMaterial(lidKind === 'black' ? '#1b1b1d' : '#f2f1ee', 0.35);
    lm.side = DoubleSide;
    bag.mesh(revolve(lp, 96), lm, group);
    // Sip hole recess.
    const hole = new TubeGeometry(new CatmullRomCurve3([new Vector3(-mm(6), H + mm(13.2), r - mm(9)), new Vector3(0, H + mm(13.6), r - mm(8.4)), new Vector3(mm(6), H + mm(13.2), r - mm(9))]), 12, mm(1.4), 8, false);
    bag.mesh(hole, plasticMaterial(lidKind === 'black' ? '#0e0e10' : '#d9d7d2', 0.5), group);
  }
  if (bool(o, 'sleeve')) {
    const sl = profileBetween((y) => g.rAt(y) + mm(1.2), g.H * 0.3, g.H * 0.64, 6);
    bag.mesh(revolve(sl, 96), new MeshPhysicalMaterial({ color: new Color('#a87d4f'), roughness: 0.92 }), group);
  }
  return {
    group,
    info: { rollRadius: g.rTop, dew: { profile: dewProfile, y0: mm(1), y1: g.H - mm(4), materials: [bandMat, plain] } },
    pose: () => undefined,
    applyTextures(tex) {
      const c = compose({ art: tex[s.id]?.art ?? null, masks: tex[s.id]?.masks ?? {}, base, roughness: 0.62, metalness: 0, clearcoat: 0, mode: 'opaque', widthPt: box.w, anisotropy: input.anisotropy });
      bag.setComposite('wrap', c);
      applyComposite(bandMat, c);
    },
    dispose: () => bag.dispose(),
  };
}

export function buildMug(input: ModelInput): ProductModel {
  const o = input.options;
  const g = mugGeometry(o);
  const bag = new Bag();
  const group = new Group();
  const s = input.dieline.surfaces[0];
  const box = bleedBox(s);
  const R = g.D / 2, H = g.H, wall = mm(4.5);
  const glazeColor = str(o, 'glaze', '#f7f6f2');
  const insideColor = str(o, 'inside', glazeColor);
  const matte = str(o, 'finish', 'gloss') === 'matte';
  const glaze = new MeshPhysicalMaterial({ color: new Color(glazeColor), roughness: matte ? 0.55 : 0.12, clearcoat: matte ? 0 : 1, clearcoatRoughness: 0.04 });
  const insideMat = new MeshPhysicalMaterial({ color: new Color(insideColor), roughness: matte ? 0.5 : 0.1, clearcoat: matte ? 0 : 1, clearcoatRoughness: 0.04, side: DoubleSide });
  // Outer body with a rounded foot and rim; inside.
  const outer: [number, number][] = [[mm(2), 0], [0, R - mm(6)]];
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); outer.push([mm(5) * (1 - Math.cos(a)), R - mm(5) + mm(5) * Math.sin(a)]); }
  outer.push([H - mm(2), R]);
  for (let i = 1; i <= 8; i++) { const a = (i / 8) * Math.PI; outer.push([H - mm(2) + (wall / 2) * Math.sin(a), R - (wall / 2) * (1 - Math.cos(a))]); }
  bag.mesh(revolve(outer, 128), glaze, group);
  const inner: [number, number][] = [[H - mm(2), R - wall], [mm(14), R - wall], [mm(9), R - wall - mm(4)], [mm(8.5), 0]];
  bag.mesh(revolve(inner, 96, undefined, -Math.PI, Math.PI, true), insideMat, group);
  // Sublimation print: wraps from just behind the handle (at +x) round to just in front of it.
  const gap = (g.C - g.pw) / 2 / R;
  const phi0 = Math.PI / 2 + gap, phi1 = Math.PI / 2 + 2 * Math.PI - gap;
  const y0 = (H - g.ph) / 2;
  const printMat = printMaterial({ side: FrontSide, bumpScale: 0.2 });
  bag.mesh(revolve(profileBetween(() => R + mm(0.08), y0, y0 + g.ph, 8), 160, (f, _j, y) => surfaceUV(box, f * g.pw, y0 + g.ph - y), phi0, phi1), printMat, group);
  // Handle.
  const curve = new CatmullRomCurve3([
    new Vector3(R - mm(2), H * 0.8, 0), new Vector3(R + mm(16), H * 0.84, 0), new Vector3(R + mm(29), H * 0.62, 0), new Vector3(R + mm(27), H * 0.36, 0), new Vector3(R + mm(14), H * 0.2, 0), new Vector3(R - mm(2), H * 0.22, 0),
  ]);
  const handle = new TubeGeometry(curve, 64, mm(5.6), 20, false);
  handle.scale(1, 1, 0.82);
  bag.mesh(handle, insideColor === glazeColor ? glaze : insideMat, group);
  return {
    group,
    info: {},
    pose: () => undefined,
    applyTextures(tex) {
      const c = compose({ art: tex[s.id]?.art ?? null, masks: tex[s.id]?.masks ?? {}, base: glazeColor, roughness: matte ? 0.55 : 0.12, metalness: 0, clearcoat: matte ? 0 : 1, mode: 'clear', widthPt: box.w, anisotropy: input.anisotropy });
      bag.setComposite('wrap', c);
      applyComposite(printMat, c, 0.04);
    },
    dispose: () => bag.dispose(),
  };
}
