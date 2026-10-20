/**
 * Perfume flacons: thick-walled glass lofted from a rounded-rectangle, round (pillow-edged) or
 * octagonal footprint, split at the fill level so the fragrance tints the lower volume; a metal
 * collar, pump and dip tube; a cube / cylinder / sphere / column / gem cap; and the decoration as
 * a paper label, a screen print on the glass or a frosted etch.
 */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, LatheGeometry, MeshPhysicalMaterial, PlaneGeometry, SphereGeometry, Vector2,
} from 'three';
import { flaconGeometry } from '../../products/perfume';
import { mm } from '../../products/geom';
import { num, str } from '../../products/types';
import { glassMaterial, liquidGlassMaterial, metalMaterial, printMaterial, revolve, surfaceUV, bleedBox, CAP_COLORS, type GlassKind } from '../build';
import { compose, applyComposite } from '../finishing';
import { Bag, type ModelInput, type ProductModel } from './common';
import { labelPatch } from './bottle';

type Footprint = (inset: number) => [number, number][];

function roundedRectFootprint(W: number, D: number, rc: number): Footprint {
  return (inset) => {
    const w = W / 2 - inset, d = D / 2 - inset, r = Math.max(0.01, Math.min(rc - inset, w, d));
    const pts: [number, number][] = [];
    const corner = (cx: number, cz: number, a0: number) => { for (let i = 0; i <= 8; i++) { const a = a0 + (i / 8) * (Math.PI / 2); pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); } };
    corner(w - r, d - r, 0); corner(-w + r, d - r, Math.PI / 2); corner(-w + r, -d + r, Math.PI); corner(w - r, -d + r, 1.5 * Math.PI);
    return pts;
  };
}

function octagonFootprint(W: number): Footprint {
  return (inset) => {
    const R = (W / 2 - inset) / Math.cos(Math.PI / 8);
    const pts: [number, number][] = [];
    for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + (k * Math.PI) / 4; pts.push([R * Math.sin(a), R * Math.cos(a)]); }
    return pts;
  };
}

/** Loft a footprint over rows [y, inset], capped at both ends; normals face outward. */
function loft(fp: Footprint, rowsIn: [number, number][], flat: boolean): BufferGeometry {
  const rings = rowsIn.map(([y, inset]) => fp(inset).map(([x, z]) => [x, y, z] as [number, number, number]));
  const n = rings[0].length;
  const pos: number[] = [];
  for (const ring of rings) for (const p of ring) pos.push(...p);
  const cb = pos.length / 3; pos.push(0, rings[0][0][1], 0);
  const ct = pos.length / 3; pos.push(0, rings[rings.length - 1][0][1], 0);
  // Footprints run counter-clockwise seen from above (+y): outward quads are (a, d, c), (a, c, b).
  const idx: number[] = [];
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = j * n + ((i + 1) % n), c = (j + 1) * n + ((i + 1) % n), d = (j + 1) * n + i;
    idx.push(a, c, b, a, d, c);
  }
  const last = (rings.length - 1) * n;
  for (let i = 0; i < n; i++) { idx.push(cb, i, (i + 1) % n); idx.push(ct, last + ((i + 1) % n), last + i); }
  let g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Check orientation on the first side vertex; flip the winding if the normals point inward.
  const p0 = g.getAttribute('position'), n0 = g.getAttribute('normal');
  const k = n; // a vertex of the second ring
  if (p0.getX(k) * n0.getX(k) + p0.getZ(k) * n0.getZ(k) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx);
  }
  if (flat) g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

/** Rows for a part from y0 to y1, rounding the bottom and/or top edge with radius r. */
function rows(y0: number, y1: number, r: number, roundBottom: boolean, roundTop: boolean): [number, number][] {
  const out: [number, number][] = [];
  const N = 6;
  if (roundBottom) for (let i = 0; i <= N; i++) { const a = (i / N) * (Math.PI / 2); out.push([y0 + r * (1 - Math.cos(a)), r * (1 - Math.sin(a))]); }
  else out.push([y0, 0]);
  if (roundTop) for (let i = 0; i <= N; i++) { const a = (i / N) * (Math.PI / 2); out.push([y1 - r + r * Math.sin(a), r * (1 - Math.cos(a))]); }
  else out.push([y1, 0]);
  return out.filter((v, i, a) => i === 0 || v[0] > a[i - 1][0] + 1e-4);
}

export function buildPerfume(input: ModelInput): ProductModel {
  const o = input.options;
  const g = flaconGeometry(o);
  const bag = new Bag();
  const group = new Group();
  const glass = str(o, 'glass', 'flint') as GlassKind;
  const base = mm(9); // thick glass base
  const yL = Math.min(g.H - mm(4), base + num(o, 'fill', 0.8) * (g.H - base - mm(6)));
  const liquidColor = str(o, 'liquidColor', '#f2c98a');
  const lm = liquidGlassMaterial(glass, liquidColor, g.D, input.scale, 0.35);
  const gm = glassMaterial(glass, mm(5), input.scale);
  gm.thickness = mm(14);
  const rr = Math.min(g.round, mm(6));

  if (g.shape === 'round') {
    const R = g.W / 2, re = g.round;
    const prof: [number, number][] = [[0, 0], [0, R - re]];
    for (let i = 1; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); prof.push([re * (1 - Math.cos(a)), R - re + re * Math.sin(a)]); }
    prof.push([g.H - re, R]);
    for (let i = 1; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); prof.push([g.H - re + re * Math.sin(a), R - re * (1 - Math.cos(a))]); }
    prof.push([g.H, 0]);
    const rAt = (y: number) => { for (let i = 0; i < prof.length - 1; i++) if (y >= prof[i][0] && y <= prof[i + 1][0] && prof[i + 1][0] > prof[i][0]) return prof[i][1] + ((prof[i + 1][1] - prof[i][1]) * (y - prof[i][0])) / (prof[i + 1][0] - prof[i][0]); return R; };
    const lower = [...prof.filter(([y]) => y < yL), [yL, rAt(yL)] as [number, number], [yL, 0] as [number, number]];
    const upper = [[yL, 0] as [number, number], [yL, rAt(yL)] as [number, number], ...prof.filter(([y]) => y > yL)];
    bag.mesh(revolve(lower, 96), lm, group);
    bag.mesh(revolve(upper, 96), gm, group);
  } else {
    const fp = g.shape === 'faceted' ? octagonFootprint(g.W) : roundedRectFootprint(g.W, g.D, rr);
    const rad = g.shape === 'faceted' ? mm(1.5) : mm(3.5);
    bag.mesh(loft(fp, rows(0, yL, rad, true, false), g.shape === 'faceted'), lm, group);
    bag.mesh(loft(fp, rows(yL, g.H, rad, false, true), g.shape === 'faceted'), gm, group);
  }

  // Collar, pump and dip tube.
  const collar = metalMaterial(str(o, 'capMaterial') === 'silver' ? '#d6d9dd' : '#d8b25a', 0.2);
  bag.mesh(new CylinderGeometry(g.collarD / 2, g.collarD / 2 + mm(0.6), g.collarH, 48).translate(0, g.H + g.collarH / 2, 0), collar, group);
  bag.mesh(new CylinderGeometry(mm(1.6), mm(1.6), mm(6), 16).translate(0, g.H + g.collarH + mm(3), 0), collar.clone(), group);
  bag.mesh(new CylinderGeometry(mm(0.9), mm(0.9), g.H - base - mm(2), 12).translate(0, base + (g.H - base) / 2, 0), new MeshPhysicalMaterial({ color: '#eef1f2', roughness: 0.3, transmission: 0, opacity: 0.9 }), group);

  // Cap.
  const capKind = str(o, 'cap', 'cube');
  const cm = str(o, 'capMaterial', 'gold');
  const look = cm === 'color' ? { color: str(o, 'capColor', '#8e2c48'), metal: 0, rough: 0.18 } : CAP_COLORS[cm] ?? CAP_COLORS.gold;
  const capMat = cm === 'glass' ? glassMaterial('flint', mm(10), input.scale) : new MeshPhysicalMaterial({ color: new Color(look.color), metalness: look.metal, roughness: look.rough, clearcoat: look.metal ? 0 : 0.8, clearcoatRoughness: 0.1 });
  const y0 = g.H + g.collarH - mm(1);
  let capGeo: BufferGeometry;
  const s = Math.min(g.W * 0.55, mm(34));
  switch (capKind) {
    case 'cylinder': capGeo = new CylinderGeometry(g.collarD * 0.95, g.collarD * 0.95, mm(26), 64).translate(0, y0 + mm(13), 0); break;
    case 'sphere': capGeo = new SphereGeometry(mm(17), 64, 48).translate(0, y0 + mm(15), 0); break;
    case 'tall': capGeo = new CylinderGeometry(g.collarD * 0.62, g.collarD * 0.7, mm(50), 48).translate(0, y0 + mm(25), 0); break;
    case 'faceted': {
      const r = mm(16);
      capGeo = new LatheGeometry([new Vector2(0.01, 0), new Vector2(r * 0.75, 0), new Vector2(r, r * 0.45), new Vector2(r * 0.8, r * 1.4), new Vector2(0.01, r * 1.9)], 8).toNonIndexed();
      capGeo.computeVertexNormals();
      capGeo.translate(0, y0, 0);
      break;
    }
    default: capGeo = new BoxGeometry(s, s, s * (g.shape === 'rect' ? Math.min(1, g.D / g.W + 0.25) : 1)).translate(0, y0 + s / 2, 0);
  }
  bag.mesh(capGeo, capMat, group);

  // Decoration.
  const decoKind = str(o, 'deco', 'label');
  const decos: { id: string; mat: MeshPhysicalMaterial }[] = [];
  for (const sid of ['front', 'back']) {
    const s2 = input.dieline.surfaces.find((x) => x.id === sid);
    if (!s2) continue;
    const box = bleedBox(s2);
    const mat = printMaterial({ side: DoubleSide, bumpScale: 0.6 });
    let geo: BufferGeometry;
    if (g.shape === 'round') {
      geo = labelPatch([[0, g.W / 2], [g.H, g.W / 2]], g.decoW, g.decoY, g.decoH, sid === 'front' ? 0 : Math.PI, s2, mm(0.2));
    } else {
      geo = new PlaneGeometry(g.decoW, g.decoH);
      const uv = geo.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        const [u, v] = surfaceUV(box, uv.getX(i) * g.decoW, (1 - uv.getY(i)) * g.decoH);
        uv.setXY(i, u, v);
      }
      const zf = (g.shape === 'faceted' ? g.W / 2 : g.D / 2) + mm(0.25);
      geo.translate(0, g.decoY + g.decoH / 2, zf);
      if (sid === 'back') geo.rotateY(Math.PI);
    }
    bag.mesh(geo, mat, group, decoKind === 'label');
    decos.push({ id: sid, mat });
  }

  return {
    group,
    info: {},
    pose: () => undefined,
    applyTextures(tex) {
      for (const d of decos) {
        const t = tex[d.id];
        const s2 = input.dieline.surfaces.find((x) => x.id === d.id)!;
        const c = compose({
          art: t?.art ?? null, masks: t?.masks ?? {}, base: decoKind === 'etched' ? '#f4f7f8' : '#f5f1e8',
          roughness: decoKind === 'etched' ? 0.55 : decoKind === 'screen' ? 0.32 : 0.78, metalness: 0, clearcoat: 0,
          mode: decoKind === 'label' ? 'opaque' : decoKind === 'etched' ? 'etched' : 'clear', widthPt: bleedBox(s2).w, anisotropy: input.anisotropy,
        });
        bag.setComposite(d.id, c);
        applyComposite(d.mat, c);
        if (decoKind === 'etched') { d.mat.map = null; d.mat.color.set('#eef3f4'); d.mat.opacity = 0.75; d.mat.needsUpdate = true; }
      }
    },
    dispose: () => bag.dispose(),
  };
}
