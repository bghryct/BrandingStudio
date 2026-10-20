/**
 * Repeat patterns for packaging grounds: stripes, pinstripes, polka dots, checks, gingham,
 * chevrons, waves, fish scales, triangles, halftone ramps, terrazzo, confetti, grids, diamonds,
 * sunbursts and a repeated word. Each pattern is vector: one compound path per ink, rotated
 * about the box centre and clipped to the box.
 */
import type { PatternElement, PatternKind } from '../../model/types';
import type { Prim, TextRun } from '../../render/primitives';
import { rectPath, rotate } from '../../render/primitives';
import { rng } from '../../lib/random';
import { mix } from '../../lib/color';
import type { GenContext } from './context';

export const PATTERN_KINDS: { value: PatternKind; label: string }[] = [
  { value: 'stripes', label: 'Stripes' }, { value: 'pinstripe', label: 'Pinstripe' }, { value: 'dots', label: 'Polka dots' },
  { value: 'checker', label: 'Checkerboard' }, { value: 'gingham', label: 'Gingham' }, { value: 'chevron', label: 'Chevron' },
  { value: 'waves', label: 'Waves' }, { value: 'scales', label: 'Scales' }, { value: 'triangles', label: 'Triangles' },
  { value: 'diamonds', label: 'Diamonds' }, { value: 'grid', label: 'Grid' }, { value: 'halftone', label: 'Halftone ramp' },
  { value: 'terrazzo', label: 'Terrazzo' }, { value: 'confetti', label: 'Confetti' }, { value: 'sunburst', label: 'Sunburst' },
  { value: 'type-repeat', label: 'Word repeat' },
];

const f = (n: number) => +n.toFixed(2);

function circle(cx: number, cy: number, r: number): string {
  const k = r * 0.5523;
  return `M${f(cx - r)} ${f(cy)}C${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)}C${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)}C${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)}C${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)}Z`;
}

const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;

export function generatePatternFill(el: PatternElement, ctx: GenContext): Prim[] {
  const { w, h } = el;
  const cx = w / 2, cy = h / 2;
  const R = Math.hypot(w, h) / 2 + 2;
  // Keep the mark count bounded however small the repeat is.
  const s = Math.max(el.scale, (2 * R) / 140, 1);
  const d = Math.max(0.02, Math.min(1, el.density));
  const x0 = cx - R, y0 = cy - R, x1 = cx + R, y1 = cy + R;
  const nx0 = Math.floor(x0 / s) - 1, nx1 = Math.ceil(x1 / s) + 1, ny0 = Math.floor(y0 / s) - 1, ny1 = Math.ceil(y1 / s) + 1;
  let a = '', b = '';
  const out: Prim[] = [];
  const r = rng(el.seed * 7919 + 13);
  switch (el.kind) {
    case 'stripes':
      for (let j = ny0; j <= ny1; j++) a += rectPath(x0, j * s, x1 - x0, s * d);
      break;
    case 'pinstripe':
      for (let j = ny0; j <= ny1; j++) a += rectPath(x0, j * s, x1 - x0, Math.max(0.35, s * d * 0.12));
      break;
    case 'dots':
      for (let j = ny0; j <= ny1; j++) for (let i = nx0; i <= nx1; i++) a += circle(i * s + (j & 1 ? s / 2 : 0), j * s * 0.866, (s * d) / 2);
      break;
    case 'checker':
      for (let j = ny0; j <= ny1; j++) for (let i = nx0; i <= nx1; i++) {
        const sq = rectPath(i * s, j * s, s, s);
        if ((i + j) & 1) a += sq; else if (el.color2) b += sq;
      }
      break;
    case 'gingham': {
      const bw = s * Math.max(0.15, d);
      let v = '', hz = '';
      for (let j = ny0; j <= ny1; j++) hz += rectPath(x0, j * s, x1 - x0, bw);
      for (let i = nx0; i <= nx1; i++) v += rectPath(i * s, y0, bw, y1 - y0);
      out.push({ t: 'path', d: hz, fill: el.color, opacity: 0.55 }, { t: 'path', d: v, fill: el.color, opacity: 0.55 });
      break;
    }
    case 'chevron': {
      const t = s * d * 0.6;
      for (let j = ny0; j <= ny1; j++) {
        const pts: [number, number][] = [];
        for (let i = nx0; i <= nx1; i++) pts.push([i * s, j * s + (i & 1 ? s / 2 : 0)]);
        const top = pts, bot = pts.map(([x, y]) => [x, y + t] as [number, number]).reverse();
        a += poly([...top, ...bot]);
      }
      break;
    }
    case 'waves': {
      const amp = s * 0.22, lw = Math.max(0.4, s * d * 0.35);
      for (let j = ny0; j <= ny1; j++) {
        let p = '';
        const y = j * s;
        for (let x = x0 - s; x <= x1 + s; x += s / 8) p += `${p ? 'L' : 'M'}${f(x)} ${f(y + Math.sin((x / s) * Math.PI * 2) * amp)}`;
        out.push({ t: 'path', d: p, stroke: el.color, strokeWidth: lw, fill: null, cap: 'round' });
      }
      break;
    }
    case 'scales': {
      const rr = s / 2;
      for (let j = ny1; j >= ny0; j--) for (let i = nx0; i <= nx1; i++) {
        const x = i * s + (j & 1 ? rr : 0), y = j * rr;
        out.push({ t: 'path', d: `M${f(x - rr)} ${f(y)}A${f(rr)} ${f(rr)} 0 0 0 ${f(x + rr)} ${f(y)}A${f(rr)} ${f(rr)} 0 0 0 ${f(x - rr)} ${f(y)}Z`, fill: el.background ?? '#ffffff', stroke: el.color, strokeWidth: Math.max(0.4, s * d * 0.08) });
        if (out.length > 4000) break;
      }
      break;
    }
    case 'triangles':
      for (let j = ny0; j <= ny1; j++) for (let i = nx0; i <= nx1; i++) {
        const x = i * s + (j & 1 ? s / 2 : 0), y = j * s * 0.866;
        const up = poly([[x, y + s * 0.866], [x + s / 2, y], [x + s, y + s * 0.866]]);
        if ((i + j) % 3 === 0) b += up; else if ((i * 7 + j * 3) % 2 === 0) a += up;
      }
      break;
    case 'diamonds':
      for (let j = ny0; j <= ny1; j++) for (let i = nx0; i <= nx1; i++) {
        const x = i * s + (j & 1 ? s / 2 : 0), y = j * s * 0.5, k = (s / 2) * Math.max(0.1, d);
        const dia = poly([[x, y - k], [x + k * 0.75, y], [x, y + k], [x - k * 0.75, y]]);
        if ((i + j) & 1) a += dia; else b += dia;
      }
      break;
    case 'grid': {
      const lw = Math.max(0.3, s * d * 0.06);
      for (let j = ny0; j <= ny1; j++) a += rectPath(x0, j * s, x1 - x0, lw);
      for (let i = nx0; i <= nx1; i++) a += rectPath(i * s, y0, lw, y1 - y0);
      break;
    }
    case 'halftone':
      for (let j = ny0; j <= ny1; j++) for (let i = nx0; i <= nx1; i++) {
        const x = i * s + (j & 1 ? s / 2 : 0), y = j * s * 0.866;
        const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
        const rad = (s / 2) * 1.08 * Math.pow(t, 1.1) * (0.4 + d);
        if (rad > 0.15) a += circle(x, y, rad);
      }
      break;
    case 'terrazzo': {
      const n = Math.min(900, Math.round(((x1 - x0) * (y1 - y0)) / (s * s) * 1.4));
      for (let k = 0; k < n; k++) {
        const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
        const size = s * (0.15 + r() * 0.55) * (0.5 + d);
        const sides = 4 + Math.floor(r() * 4), rot = r() * Math.PI * 2;
        const pts: [number, number][] = [];
        for (let q = 0; q < sides; q++) {
          const ang = rot + (q / sides) * Math.PI * 2, rr = size * (0.55 + r() * 0.45);
          pts.push([x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.8]);
        }
        const c = r();
        if (c < 0.45) a += poly(pts); else if (c < 0.8) b += poly(pts); else out.push({ t: 'path', d: poly(pts), fill: mix(el.color, el.color2, 0.5) });
      }
      break;
    }
    case 'confetti': {
      const n = Math.min(900, Math.round(((x1 - x0) * (y1 - y0)) / (s * s) * 1.1));
      for (let k = 0; k < n; k++) {
        const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
        const len = s * (0.25 + r() * 0.35) * (0.5 + d), th = len * 0.32, rot = r() * Math.PI;
        const c = Math.cos(rot), sn = Math.sin(rot);
        const pts: [number, number][] = [[-len / 2, -th / 2], [len / 2, -th / 2], [len / 2, th / 2], [-len / 2, th / 2]].map(([u, v]) => [x + u * c - v * sn, y + u * sn + v * c]);
        if (r() < 0.25) { if (r() < 0.5) a += circle(x, y, th * 0.8); else b += circle(x, y, th * 0.8); } else if (r() < 0.5) a += poly(pts); else b += poly(pts);
      }
      break;
    }
    case 'sunburst': {
      const n = Math.max(6, Math.round(Math.min(72, (2 * Math.PI * R) / s)));
      for (let k = 0; k < n; k += 2) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
        a += poly([[cx, cy], [cx + Math.cos(a0) * R * 1.5, cy + Math.sin(a0) * R * 1.5], [cx + Math.cos(a1) * R * 1.5, cy + Math.sin(a1) * R * 1.5]]);
      }
      break;
    }
    case 'type-repeat': {
      const font = ctx.font(el.fontFamily || 'inter', 800, false);
      const size = s;
      const word = (el.text || 'BRAND').trim() + '  ';
      const width = Math.max(1, ctx.measure(word, font, size));
      const runs: TextRun[] = [];
      const lead = size * (1.1 + (1 - d) * 0.8);
      const rows = Math.ceil((y1 - y0) / lead) + 2;
      const cols = Math.ceil((x1 - x0) / width) + 2;
      for (let j = 0; j < Math.min(rows, 160); j++) {
        const y = y0 + j * lead;
        const off = (j % 2) * width * 0.5;
        const text = word.repeat(Math.min(cols, 60));
        runs.push({ x: x0 - off - width, y, text, font, size, color: j % 2 && el.color2 ? el.color2 : el.color, width: width * Math.min(cols, 60) });
      }
      out.push({ t: 'text', runs });
      break;
    }
  }
  if (a) out.push({ t: 'path', d: a, fill: el.color });
  if (b && el.color2) out.push({ t: 'path', d: b, fill: el.color2 });
  const children: Prim[] = [];
  if (el.background) children.push({ t: 'path', d: rectPath(0, 0, w, h), fill: el.background });
  children.push({ t: 'group', matrix: rotate(el.angle, cx, cy), children: out });
  return [{ t: 'group', clip: rectPath(0, 0, w, h), children }];
}
