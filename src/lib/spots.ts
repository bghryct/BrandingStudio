/**
 * A small reference of commonly used solid (spot) ink colours with approximate sRGB values, for
 * suggesting a spot reference next to a brand colour. Screen values are approximations; always
 * check against a physical guide before press.
 */
import { parseColor } from './color';

export const SPOT_REFS: { name: string; hex: string }[] = [
  { name: 'PMS Yellow C', hex: '#fedd00' }, { name: 'PMS 109 C', hex: '#ffd100' }, { name: 'PMS 116 C', hex: '#ffcd00' },
  { name: 'PMS 123 C', hex: '#ffc72c' }, { name: 'PMS 130 C', hex: '#f2a900' }, { name: 'PMS 137 C', hex: '#ffa300' },
  { name: 'PMS 151 C', hex: '#ff8200' }, { name: 'PMS 158 C', hex: '#e87722' }, { name: 'PMS 165 C', hex: '#ff671f' },
  { name: 'PMS 172 C', hex: '#fa4616' }, { name: 'PMS 179 C', hex: '#e03c31' }, { name: 'PMS Warm Red C', hex: '#f9423a' },
  { name: 'PMS 185 C', hex: '#e4002b' }, { name: 'PMS 186 C', hex: '#c8102e' }, { name: 'PMS 199 C', hex: '#d50032' },
  { name: 'PMS 202 C', hex: '#862633' }, { name: 'PMS 206 C', hex: '#d50057' }, { name: 'PMS 213 C', hex: '#e31c79' },
  { name: 'PMS 225 C', hex: '#df1995' }, { name: 'PMS Rhodamine Red C', hex: '#e10098' }, { name: 'PMS 233 C', hex: '#c6007e' },
  { name: 'PMS 2593 C', hex: '#84329b' }, { name: 'PMS 2685 C', hex: '#330072' }, { name: 'PMS Purple C', hex: '#bb29bb' },
  { name: 'PMS 2728 C', hex: '#0047bb' }, { name: 'PMS 286 C', hex: '#0033a0' }, { name: 'PMS 293 C', hex: '#003da5' },
  { name: 'PMS Reflex Blue C', hex: '#001489' }, { name: 'PMS 300 C', hex: '#005eb8' }, { name: 'PMS 2995 C', hex: '#00a9e0' },
  { name: 'PMS Process Blue C', hex: '#0085ca' }, { name: 'PMS 306 C', hex: '#00b5e2' }, { name: 'PMS 3125 C', hex: '#00aec7' },
  { name: 'PMS 320 C', hex: '#009ca6' }, { name: 'PMS 327 C', hex: '#008675' }, { name: 'PMS 3415 C', hex: '#007749' },
  { name: 'PMS 347 C', hex: '#009a44' }, { name: 'PMS 355 C', hex: '#009639' }, { name: 'PMS 361 C', hex: '#43b02a' },
  { name: 'PMS 375 C', hex: '#97d700' }, { name: 'PMS 382 C', hex: '#c4d600' }, { name: 'PMS 802 C', hex: '#44d62c' },
  { name: 'PMS 7406 C', hex: '#f1c400' }, { name: 'PMS 7408 C', hex: '#f6be00' }, { name: 'PMS 7549 C', hex: '#ffb500' },
  { name: 'PMS 7597 C', hex: '#e04e39' }, { name: 'PMS 7621 C', hex: '#ab2328' }, { name: 'PMS 7625 C', hex: '#e1523d' },
  { name: 'PMS 7416 C', hex: '#e5554f' }, { name: 'PMS 5545 C', hex: '#4f6f63' }, { name: 'PMS 7716 C', hex: '#00857d' },
  { name: 'PMS 7547 C', hex: '#131e29' }, { name: 'PMS 433 C', hex: '#1d252d' }, { name: 'PMS Black C', hex: '#2d2926' },
  { name: 'PMS Black 6 C', hex: '#101820' }, { name: 'PMS Cool Gray 1 C', hex: '#d9d9d6' }, { name: 'PMS Cool Gray 7 C', hex: '#97999b' },
  { name: 'PMS Cool Gray 11 C', hex: '#53565a' }, { name: 'PMS 7527 C', hex: '#d6d2c4' }, { name: 'PMS 7506 C', hex: '#efdbb2' },
  { name: 'PMS 7509 C', hex: '#d6a461' }, { name: 'PMS 4685 C', hex: '#e0c6ad' }, { name: 'PMS 7502 C', hex: '#ceb888' },
  { name: 'PMS 7753 C', hex: '#c69214' }, { name: 'PMS 2725 C', hex: '#685bc7' }, { name: 'PMS 806 C', hex: '#ff3eb5' },
  { name: 'PMS 871 C (metallic gold)', hex: '#84754e' }, { name: 'PMS 877 C (metallic silver)', hex: '#8a8d8f' },
];

/** Nearest reference by a simple perceptual distance (redmean). */
export function nearestSpot(hex: string): { name: string; hex: string; distance: number } {
  const a = parseColor(hex);
  let best = { ...SPOT_REFS[0], distance: Infinity };
  for (const s of SPOT_REFS) {
    const b = parseColor(s.hex);
    const rm = (a.r + b.r) / 2;
    const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
    const d = Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
    if (d < best.distance) best = { ...s, distance: d };
  }
  return best;
}
