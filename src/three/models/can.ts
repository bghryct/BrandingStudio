/**
 * Aluminium beverage can: revolved body (dome, stand ring, wall, multi-step neck), double seam,
 * countersunk lid with a stay-on tab. The decoration maps around the wall with the splice at the
 * back; white base coat or bare metal with transparent inks; gloss / satin / matte varnish and
 * optional condensation droplets.
 */
import { Color, ExtrudeGeometry, Group, MeshPhysicalMaterial, Shape, DoubleSide, FrontSide, Vector2, type Texture } from 'three';
import { tiledNormal } from '../assets';
import { canGeometry } from '../../products/cans';
import { mm } from '../../products/geom';
import { str, bool } from '../../products/types';
import { revolve, printMaterial, metalMaterial, surfaceUV, bleedBox } from '../build';
import { compose, applyComposite, installDetailBump, detailUniforms } from '../finishing';
import { Bag, type ModelInput, type ProductModel } from './common';
import { Vector3 } from 'three';

const smooth = (t: number) => t * t * (3 - 2 * t);

const LID: Record<string, string> = { silver: '#cdd0d4', black: '#1b1b1d', gold: '#c9a456' };

export function buildCan(input: ModelInput): ProductModel {
  const o = input.options;
  const g = canGeometry(o);
  const bag = new Bag();
  const group = new Group();
  const R = g.D / 2, rFoot = R - mm(7.2), rNeck = g.endD / 2 - mm(2.4), rEnd = g.endD / 2;
  const surface = input.dieline.surfaces[0];
  const box = bleedBox(surface);
  const bare = str(o, 'base') === 'bare';
  const varnish = str(o, 'varnish', 'gloss');

  // Body profile [y, r] from the dome apex out over the stand ring, up the wall and through the neck.
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push([mm(9.5) - mm(8.6) * t * t, (rFoot - mm(1.2)) * t]); }
  prof.push([mm(0.4), rFoot - mm(0.3)], [0, rFoot + mm(0.4)], [mm(0.5), rFoot + mm(1.3)]);
  for (let i = 1; i <= 10; i++) { const a = (i / 10) * (Math.PI / 2); prof.push([mm(0.5) + (g.baseH - mm(0.5)) * (1 - Math.cos(a)), rFoot + mm(1.3) + (R - rFoot - mm(1.3)) * Math.sin(a)]); }
  const wallTop = g.H - g.neckH;
  for (let i = 1; i <= 24; i++) prof.push([g.baseH + ((wallTop - g.baseH) * i) / 24, R]);
  const neckTop = g.H - g.rimH - mm(0.6);
  for (let i = 1; i <= 16; i++) { const t = i / 16; prof.push([wallTop + (neckTop - wallTop) * t, R - (R - rNeck) * smooth(t)]); }

  const C = g.circumference;
  const printTop = g.printY1;
  const uvBody = (f: number, _j: number, y: number) => {
    const sx = C * f; // f = 0 at the back (phi = −π), 0.5 at the front
    const sy = Math.max(-surface.bleed, Math.min(surface.h + surface.bleed, printTop - y));
    return surfaceUV(box, sx, sy);
  };
  // The dome, stand ring and base curve below the print are bare aluminium (the decorator never
  // reaches them); mapping the art there smeared its bottom row into wedges across the dome.
  let ring = 0;
  for (let j = 1; j < prof.length; j++) if (prof[j][0] < prof[ring][0]) ring = j;
  let cut = ring;
  while (cut < prof.length - 1 && prof[cut][0] < g.printY0) cut++;
  const a = prof[cut - 1], b = prof[cut];
  const tt = (g.printY0 - a[0]) / Math.max(1e-6, b[0] - a[0]);
  const at: [number, number] = [g.printY0, a[1] + (b[1] - a[1]) * tt];
  const baseProf: [number, number][] = [...prof.slice(0, cut), at];
  const printProf: [number, number][] = [at, ...prof.slice(cut)];
  const bodyGeo = revolve(printProf, 160, uvBody);
  const baseMat = new MeshPhysicalMaterial({ color: new Color('#c8cbd0'), metalness: 1, roughness: 0.28, anisotropy: 0.3, side: FrontSide });
  bag.mesh(revolve(baseProf, 120), baseMat, group);
  const body = printMaterial({ side: FrontSide, bumpScale: 1.2 });
  if (bool(o, 'condensation')) {
    const owned: Texture[] = [];
    installDetailBump(body, detailUniforms('droplets', 6, 10, 2.4, input.anisotropy, owned), 'can-drops');
    owned.forEach((t) => bag.texture(t));
  }
  bag.mesh(bodyGeo, body, group);

  // Double seam + countersunk lid.
  // Double seam: a rounded bead rolled over the end of the neck, then the chuck wall down into
  // the countersink, and the centre panel with a shallow reinforcing ring.
  const lidProf: [number, number][] = [[neckTop - mm(0.1), rNeck], [g.H - g.rimH, rEnd - mm(0.35)]];
  const beadR = mm(1.05), beadY = g.H - beadR, beadX = rEnd - beadR;
  for (let i = 0; i <= 14; i++) {
    const a = -Math.PI / 2 + (i / 14) * (Math.PI * 1.25);
    lidProf.push([beadY + beadR * Math.sin(a) * (a < 0 ? 1.9 : 1), beadX + beadR * Math.cos(a)]);
  }
  lidProf.push(
    [g.H - mm(1.3), rEnd - mm(1.95)], [g.H - mm(5.3), rEnd - mm(2.25)],
    [g.H - mm(6.05), rEnd - mm(2.75)], [g.H - mm(6.2), rEnd - mm(3.25)], [g.H - mm(5.85), rEnd - mm(3.85)], [g.H - mm(5.45), rEnd - mm(4.3)],
    [g.H - mm(5.35), rEnd * 0.72], [g.H - mm(5.6), rEnd * 0.66], [g.H - mm(5.35), rEnd * 0.6], [g.H - mm(5.3), 0],
  );
  const lidName = str(o, 'lid', 'silver');
  const lidColor = lidName === 'custom' ? str(o, 'lidColor', '#c0392b') : LID[lidName] ?? LID.silver;
  // Spun aluminium end: anisotropic highlights running round the lid (the revolve's u is the
  // angle, so the tangent follows the circumference).
  const lidMat = new MeshPhysicalMaterial({
    color: new Color(lidColor), metalness: lidName === 'black' ? 0.6 : lidName === 'custom' ? 0.75 : 1, roughness: lidName === 'black' ? 0.35 : lidName === 'custom' ? 0.3 : 0.3,
    anisotropy: lidName === 'black' ? 0.3 : 0.35, anisotropyRotation: 0, clearcoat: lidName === 'custom' || lidName === 'black' ? 0.6 : 0.15, clearcoatRoughness: 0.15, side: DoubleSide,
  });
  bag.mesh(revolve(lidProf, 96), lidMat, group);

  // Stay-on tab: a rounded key shape with a finger hole, plus the rivet and the score.
  const tab = new Shape();
  const tw = mm(14), tl = mm(21);
  tab.moveTo(-tw / 2, 0);
  tab.absarc(0, 0, tw / 2, Math.PI, 2 * Math.PI, false);
  tab.lineTo(tw / 2, tl * 0.62);
  tab.absarc(0, tl * 0.62, tw / 2, 0, Math.PI, false);
  tab.closePath();
  const hole = new Shape();
  hole.absellipse(0, tl * 0.62, tw * 0.3, tw * 0.22, 0, Math.PI * 2, false, 0);
  tab.holes.push(hole);
  const tabGeo = new ExtrudeGeometry(tab, { depth: mm(0.35), bevelEnabled: true, bevelThickness: mm(0.15), bevelSize: mm(0.25), bevelSegments: 2, curveSegments: 18 });
  tabGeo.rotateX(-Math.PI / 2);
  const tabMat = metalMaterial(lidName === 'custom' ? lidColor : lidColor, 0.22);
  const tabMesh = bag.mesh(tabGeo, tabMat, group);
  // The opening faces +x (the side it pours from), the stay-on tab behind it.
  tabMesh.position.set(-mm(2.5), g.H - mm(5.2), 0);
  tabMesh.rotation.y = -Math.PI / 2;
  const score = new Shape();
  score.absellipse(0, 0, mm(8.5), mm(11), 0, Math.PI * 2, false, 0);
  const scoreGeo = new ExtrudeGeometry(score, { depth: mm(0.05), bevelEnabled: false, curveSegments: 32 });
  scoreGeo.rotateX(-Math.PI / 2);
  const scoreMat = metalMaterial(new Color(lidColor).multiplyScalar(0.82).getStyle(), 0.4);
  const scoreMesh = bag.mesh(scoreGeo, scoreMat, group, false);
  scoreMesh.position.set(rEnd * 0.42, g.H - mm(5.42), 0);

  const model: ProductModel = {
    group,
    info: {
      rollRadius: R,
      dew: { profile: prof, y0: mm(2), y1: wallTop + g.neckH * 0.8, materials: [body] },
      pour: { mouth: new Vector3(rEnd * 0.5, g.H - mm(4), 0), radius: R, height: g.H, stream: mm(3.4) },
    },
    pose: () => undefined,
    applyTextures(tex) {
      const t = tex[surface.id];
      const c = compose({
        art: t?.art ?? null, masks: t?.masks ?? {},
        base: bare ? '#c8ccd2' : '#f7f7f5',
        roughness: varnish === 'matte' ? 0.62 : varnish === 'satin' ? 0.4 : 0.24,
        metalness: bare ? 1 : 0.05,
        clearcoat: varnish === 'gloss' ? 1 : varnish === 'satin' ? 0.4 : 0,
        mode: bare ? 'metal' : 'opaque', widthPt: box.w, anisotropy: input.anisotropy,
      });
      bag.setComposite('body', c);
      applyComposite(body, c, varnish === 'gloss' ? 0.05 : 0.18);
      // Drawn-and-ironed aluminium: the grain runs up the wall where the metal shows.
      body.anisotropy = bare ? 0.55 : 0;
      body.anisotropyRotation = Math.PI / 2;
      if (bool(o, 'condensation')) { body.roughness = 1; body.clearcoat = 1; body.clearcoatRoughness = 0.05; }
    },
    dispose: () => bag.dispose(),
  };
  return model;
}

