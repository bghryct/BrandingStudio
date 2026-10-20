/**
 * The brand logo, drawn live from the brand kit: a symbol mark (circle monogram, leaf, wave,
 * star, drop, bolt, sun, diamond, arch) and a wordmark set in the kit's headline face, combined
 * as a lockup, a stacked logo, a badge or a monogram. An uploaded logo replaces the generated one.
 */
import type { BrandKit, LogoElement, LogoMark } from '../../model/types';
import type { FontRef, Prim, TextRun } from '../../render/primitives';
import { circlePath, ellipsePath, rectPath } from '../../render/primitives';
import { luminance } from '../../lib/color';
import type { GenContext } from './context';

export interface LogoContext extends GenContext {
  brand: BrandKit;
  /** Prims for the uploaded logo asset fitted into w × h (null when there is none). */
  uploaded: (w: number, h: number, color: string | null) => Prim[] | null;
}

export const LOGO_MARKS: { value: LogoMark; label: string }[] = [
  { value: 'circle', label: 'Monogram circle' }, { value: 'arch', label: 'Arch' }, { value: 'leaf', label: 'Leaf' },
  { value: 'wave', label: 'Waves' }, { value: 'sun', label: 'Sun' }, { value: 'star', label: 'Sparkle' },
  { value: 'drop', label: 'Drop' }, { value: 'bolt', label: 'Bolt' }, { value: 'diamond', label: 'Diamond' }, { value: 'none', label: 'No mark' },
];

const f = (n: number) => +n.toFixed(2);

export function brandColors(brand: BrandKit) {
  const by = (role: string) => brand.palette.find((s) => s.role === role)?.hex;
  const primary = by('primary') ?? brand.palette[0]?.hex ?? '#16151a';
  const accent = by('accent') ?? by('secondary') ?? brand.palette[1]?.hex ?? '#e8483b';
  const background = by('background') ?? '#ffffff';
  const neutral = by('neutral') ?? '#16151a';
  return { primary, accent, background, neutral, secondary: by('secondary') ?? accent };
}

/** Readable colour on a ground (white or ink). */
export const onColor = (hex: string) => (luminance(hex) > 0.45 ? '#16151a' : '#ffffff');

/** A mark in the square (x, y, s). `knock` is the colour of details cut into the mark. */
function markPrims(mark: LogoMark, x: number, y: number, s: number, color: string, knock: string, letter: string, font: FontRef, ctx: GenContext): Prim[] {
  const cx = x + s / 2, cy = y + s / 2, r = s / 2;
  const out: Prim[] = [];
  const glyph = (size: number, col: string, dy = 0): Prim | null => {
    if (!letter) return null;
    const m = ctx.metrics(font);
    const w = ctx.measure(letter, font, size);
    return { t: 'text', runs: [{ x: cx - w / 2, y: cy + (m.capHeight * size) / 2 + dy, text: letter, font, size, color: col, width: w }] };
  };
  switch (mark) {
    case 'circle': {
      out.push({ t: 'path', d: circlePath(cx, cy, r), fill: color });
      out.push({ t: 'path', d: circlePath(cx, cy, r * 0.86), fill: null, stroke: knock, strokeWidth: s * 0.022 });
      const g = glyph(s * 0.56, knock);
      if (g) out.push(g);
      break;
    }
    case 'arch': {
      const w = s * 0.78, h = s, ax = cx - w / 2;
      out.push({ t: 'path', d: `M${f(ax)} ${f(y + h)}V${f(y + w / 2)}A${f(w / 2)} ${f(w / 2)} 0 0 1 ${f(ax + w)} ${f(y + w / 2)}V${f(y + h)}Z`, fill: color });
      const g = glyph(s * 0.5, knock, s * 0.12);
      if (g) out.push(g);
      break;
    }
    case 'leaf': {
      out.push({ t: 'path', d: `M${f(x + s * 0.12)} ${f(y + s * 0.88)}C${f(x + s * 0.05)} ${f(y + s * 0.3)} ${f(x + s * 0.45)} ${f(y + s * 0.05)} ${f(x + s * 0.92)} ${f(y + s * 0.08)}C${f(x + s * 0.95)} ${f(y + s * 0.55)} ${f(x + s * 0.7)} ${f(y + s * 0.95)} ${f(x + s * 0.12)} ${f(y + s * 0.88)}Z`, fill: color });
      out.push({ t: 'path', d: `M${f(x + s * 0.14)} ${f(y + s * 0.86)}C${f(x + s * 0.4)} ${f(y + s * 0.55)} ${f(x + s * 0.62)} ${f(y + s * 0.34)} ${f(x + s * 0.86)} ${f(y + s * 0.14)}`, fill: null, stroke: knock, strokeWidth: s * 0.035, cap: 'round' });
      break;
    }
    case 'wave': {
      out.push({ t: 'path', d: circlePath(cx, cy, r), fill: color });
      for (let k = 0; k < 3; k++) {
        const yy = cy - r * 0.32 + k * r * 0.32;
        let p = '';
        for (let i = 0; i <= 24; i++) {
          const xx = cx - r * 0.72 + (i / 24) * r * 1.44;
          p += `${i ? 'L' : 'M'}${f(xx)} ${f(yy + Math.sin((i / 24) * Math.PI * 3) * r * 0.08)}`;
        }
        out.push({ t: 'path', d: p, fill: null, stroke: knock, strokeWidth: s * 0.05, cap: 'round' });
      }
      break;
    }
    case 'sun': {
      out.push({ t: 'path', d: circlePath(cx, cy, r * 0.5), fill: color });
      let rays = '';
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const a0 = a - 0.09, a1 = a + 0.09;
        rays += `M${f(cx + Math.cos(a0) * r * 0.62)} ${f(cy + Math.sin(a0) * r * 0.62)}L${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}L${f(cx + Math.cos(a1) * r * 0.62)} ${f(cy + Math.sin(a1) * r * 0.62)}Z`;
      }
      out.push({ t: 'path', d: rays, fill: color });
      break;
    }
    case 'star': {
      let d = '';
      for (let k = 0; k < 8; k++) {
        const a = -Math.PI / 2 + (k / 8) * Math.PI * 2;
        const rr = k % 2 ? r * 0.38 : r;
        d += `${k ? 'L' : 'M'}${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)}`;
        const a2 = a + Math.PI / 8;
        d += `L${f(cx + Math.cos(a2) * r * 0.16)} ${f(cy + Math.sin(a2) * r * 0.16)}`;
      }
      out.push({ t: 'path', d: d + 'Z', fill: color });
      break;
    }
    case 'drop': {
      out.push({ t: 'path', d: `M${f(cx)} ${f(y)}C${f(cx + r * 0.25)} ${f(y + s * 0.3)} ${f(cx + r * 0.78)} ${f(y + s * 0.45)} ${f(cx + r * 0.78)} ${f(y + s * 0.68)}C${f(cx + r * 0.78)} ${f(y + s * 0.88)} ${f(cx + r * 0.42)} ${f(y + s)} ${f(cx)} ${f(y + s)}C${f(cx - r * 0.42)} ${f(y + s)} ${f(cx - r * 0.78)} ${f(y + s * 0.88)} ${f(cx - r * 0.78)} ${f(y + s * 0.68)}C${f(cx - r * 0.78)} ${f(y + s * 0.45)} ${f(cx - r * 0.25)} ${f(y + s * 0.3)} ${f(cx)} ${f(y)}Z`, fill: color });
      out.push({ t: 'path', d: `M${f(cx - r * 0.42)} ${f(y + s * 0.7)}C${f(cx - r * 0.42)} ${f(y + s * 0.82)} ${f(cx - r * 0.28)} ${f(y + s * 0.88)} ${f(cx - r * 0.12)} ${f(y + s * 0.9)}`, fill: null, stroke: knock, strokeWidth: s * 0.045, cap: 'round' });
      break;
    }
    case 'bolt':
      out.push({ t: 'path', d: `M${f(x + s * 0.58)} ${f(y)}L${f(x + s * 0.16)} ${f(y + s * 0.58)}H${f(x + s * 0.46)}L${f(x + s * 0.38)} ${f(y + s)}L${f(x + s * 0.84)} ${f(y + s * 0.4)}H${f(x + s * 0.54)}Z`, fill: color });
      break;
    case 'diamond': {
      const d = (k: number) => `M${f(cx)} ${f(cy - r * k)}L${f(cx + r * k * 0.82)} ${f(cy)}L${f(cx)} ${f(cy + r * k)}L${f(cx - r * k * 0.82)} ${f(cy)}Z`;
      out.push({ t: 'path', d: d(1), fill: color }, { t: 'path', d: d(0.55), fill: null, stroke: knock, strokeWidth: s * 0.04 });
      break;
    }
    case 'none':
      break;
  }
  return out;
}

/** A line of type fitted into a box (shrinks to fit width and height). */
function fittedRun(text: string, font: FontRef, x: number, y: number, w: number, h: number, color: string, tracking: number, ctx: GenContext, align: 'left' | 'center' = 'left'): TextRun | null {
  if (!text) return null;
  const m = ctx.metrics(font);
  const per = (size: number) => ctx.measure(text, font, size) + (tracking / 1000) * size * Math.max(0, text.length - 1);
  let size = h / Math.max(0.5, m.capHeight);
  const wAt = per(size);
  if (wAt > w) size *= w / wAt;
  const width = per(size);
  const cap = m.capHeight * size;
  const bx = align === 'center' ? x + (w - width) / 2 : x;
  return { x: bx, y: y + (h + cap) / 2, text, font, size, color, width, letterSpacing: (tracking / 1000) * size };
}

export function generateLogo(el: LogoElement, ctx: LogoContext): Prim[] {
  const { brand } = ctx;
  const cols = brandColors(brand);
  const color = el.color ?? cols.primary;
  const accent = el.color2 ?? cols.accent;
  const { w, h } = el;
  const name = (el.text ?? brand.name ?? 'Brand').trim() || 'Brand';
  const word = brand.logo.uppercase ? name.toUpperCase() : name;
  const font = ctx.font(brand.fonts.headline, brand.logo.weight, false);
  const letter = (brand.logo.monogram || name[0] || 'B').slice(0, 2);
  const tracking = brand.logo.tracking;
  const uploaded = ctx.uploaded(w, h, el.color);
  if (uploaded && el.variant !== 'wordmark') return uploaded;
  const mark = brand.logo.mark;
  const markColor = mark === 'circle' || mark === 'arch' || mark === 'wave' ? color : accent;
  const knock = luminance(markColor) < 0.45 ? (luminance(cols.background) > 0.6 ? cols.background : '#ffffff') : cols.neutral;
  const out: Prim[] = [];
  switch (el.variant) {
    case 'wordmark': {
      const run = fittedRun(word, font, 0, h * 0.12, w, h * 0.76, color, tracking, ctx, 'center');
      if (run) out.push({ t: 'text', runs: [run] });
      break;
    }
    case 'mark': {
      const s = Math.min(w, h);
      out.push(...markPrims(mark === 'none' ? 'circle' : mark, (w - s) / 2, (h - s) / 2, s, mark === 'none' ? color : markColor, knock, letter, font, ctx));
      break;
    }
    case 'monogram': {
      const s = Math.min(w, h);
      out.push(...markPrims('circle', (w - s) / 2, (h - s) / 2, s, color, onColor(color) === '#ffffff' ? '#ffffff' : cols.background, letter, font, ctx));
      break;
    }
    case 'stacked': {
      const ms = mark === 'none' ? 0 : Math.min(h * 0.58, w * 0.6);
      if (ms) out.push(...markPrims(mark, (w - ms) / 2, 0, ms, markColor, knock, letter, font, ctx));
      const run = fittedRun(word, font, 0, ms ? ms + h * 0.1 : h * 0.1, w, ms ? h - ms - h * 0.12 : h * 0.8, color, tracking, ctx, 'center');
      if (run) out.push({ t: 'text', runs: [run] });
      break;
    }
    case 'badge': {
      const s = Math.min(w, h), x = (w - s) / 2, y = (h - s) / 2, cx = w / 2, cy = h / 2;
      out.push({ t: 'path', d: circlePath(cx, cy, s / 2), fill: color });
      out.push({ t: 'path', d: circlePath(cx, cy, s * 0.44), fill: null, stroke: accent, strokeWidth: s * 0.018 });
      const inner = onColor(color);
      const ms = s * 0.34;
      if (mark !== 'none') out.push(...markPrims(mark === 'circle' ? 'star' : mark, cx - ms / 2, y + s * 0.16, ms, accent, color, letter, font, ctx));
      const run = fittedRun(word, font, x + s * 0.18, y + s * 0.56, s * 0.64, s * 0.13, inner, tracking + 40, ctx, 'center');
      if (run) out.push({ t: 'text', runs: [run] });
      if (brand.tagline) {
        const tf = ctx.font(brand.fonts.body, 600, false);
        const t2 = fittedRun(brand.tagline.toUpperCase(), tf, x + s * 0.26, y + s * 0.73, s * 0.48, s * 0.045, inner, 140, ctx, 'center');
        if (t2) out.push({ t: 'text', runs: [t2] });
      }
      break;
    }
    default: { // lockup
      const ms = mark === 'none' ? 0 : Math.min(h, w * 0.3);
      if (ms) out.push(...markPrims(mark, 0, (h - ms) / 2, ms, markColor, knock, letter, font, ctx));
      const gap = ms ? ms * 0.22 : 0;
      const run = fittedRun(word, font, ms + gap, h * (ms ? 0.27 : 0.12), w - ms - gap, h * (ms ? 0.46 : 0.76), color, tracking, ctx);
      if (run) out.push({ t: 'text', runs: [run] });
    }
  }
  return out.length ? out : [{ t: 'path', d: rectPath(0, 0, w, h), stroke: '#999', strokeWidth: 0.5, dash: [3, 3] }];
}

export { ellipsePath };
