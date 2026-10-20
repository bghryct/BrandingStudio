/**
 * Drop-cap backgrounds for the text engine: a plain box, a double outline, or a gilded square.
 * (A compact stand-in for Book Design Studio's illuminated frames; the host draws the letter on top.)
 */
import type { DropCapFrame } from '../model/types';
import type { Prim } from '../render/primitives';
import { rectPath } from '../render/primitives';
import { mix } from '../lib/color';

export function illuminatedFrame(
  frame: DropCapFrame,
  box: { x: number; y: number; w: number; h: number },
  colors: { frame: string; ground: string | null; gold?: string },
  _seed: number,
): Prim[] {
  const { x, y, w, h } = box;
  if (!(w > 0 && h > 0) || frame === 'none') return [];
  const s = Math.min(w, h);
  if (frame === 'outline') {
    const lw = Math.max(0.3, s * 0.008);
    const gap = Math.max(1.4, s * 0.035);
    return [
      { t: 'path', d: rectPath(x + lw / 2, y + lw / 2, w - lw, h - lw), fill: colors.ground, stroke: colors.frame, strokeWidth: lw },
      { t: 'path', d: rectPath(x + gap, y + gap, w - 2 * gap, h - 2 * gap), fill: null, stroke: colors.frame, strokeWidth: lw * 0.7 },
    ];
  }
  if (frame === 'gilded') {
    const gold = colors.gold ?? '#c9a227';
    return [{
      t: 'path', d: rectPath(x, y, w, h),
      fill: { kind: 'linear', x1: x, y1: y, x2: x + w, y2: y + h, stops: [{ offset: 0, color: mix(gold, '#ffffff', 0.35) }, { offset: 0.5, color: gold }, { offset: 1, color: mix(gold, '#000000', 0.25) }] },
    }];
  }
  return [{ t: 'path', d: rectPath(x, y, w, h), fill: colors.ground ?? colors.frame }];
}
