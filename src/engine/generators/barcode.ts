/**
 * EAN-13 and UPC-A barcodes (GS1): the check digit is computed, guard bars extend below the
 * symbol, quiet zones are kept, and the human-readable digits are set in a monospace face.
 */
import type { BarcodeElement } from '../../model/types';
import type { Prim, TextRun } from '../../render/primitives';
import { rectPath } from '../../render/primitives';
import type { GenContext } from './context';

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function checkDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = +digits[digits.length - 1 - i];
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

/** The full number including the check digit (EAN-13: 13 digits, UPC-A: 12). */
export function barcodeNumber(el: Pick<BarcodeElement, 'symbology' | 'code'>): string {
  const n = el.symbology === 'upca' ? 11 : 12;
  const digits = (el.code.replace(/\D/g, '') + '000000000000').slice(0, n);
  return digits + checkDigit(digits);
}

export function generateBarcode(el: BarcodeElement, ctx: GenContext): Prim[] {
  const num = barcodeNumber(el);
  const ean = el.symbology === 'upca' ? '0' + num : num;
  const first = +ean[0];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[first][i - 1] === 'L' ? L : G)[+ean[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[+ean[i]];
  bits += '101';
  const quietL = 11, quietR = 7;
  const modules = quietL + 95 + quietR;
  const { w, h } = el;
  const m = w / modules;
  const textH = el.showText ? Math.min(h * 0.22, m * 11) : 0;
  const barH = h - textH * (el.showText ? 0.62 : 0);
  const guard = (i: number) => i < 3 || (i >= 45 && i < 50) || i >= 92 || (el.symbology === 'upca' && (i < 10 || i >= 85));
  let d = '';
  for (let i = 0; i < 95; i++) {
    if (bits[i] !== '1') continue;
    let j = i;
    while (j + 1 < 95 && bits[j + 1] === '1' && guard(j + 1) === guard(i)) j++;
    const x = (quietL + i) * m;
    const bh = guard(i) || !el.showText ? h - (el.showText ? textH * 0.25 : 0) : barH - textH * 0.5;
    d += rectPath(x, 0, (j - i + 1) * m, Math.max(1, bh));
    i = j;
  }
  const out: Prim[] = [];
  if (el.background) out.push({ t: 'path', d: rectPath(0, 0, w, h), fill: el.background });
  out.push({ t: 'path', d, fill: el.color });
  if (el.showText) {
    const font = ctx.font('ibm-plex-mono', 400, false);
    const size = textH * 1.05;
    const y = h - textH * 0.08;
    const runs: TextRun[] = [];
    const put = (text: string, cx: number, sz = size) => {
      const tw = ctx.measure(text, font, sz);
      const ls = text.length > 1 ? Math.max(0, (m * 7 * text.length * 0.92 - tw) / (text.length - 1)) : 0;
      const width = tw + ls * (text.length - 1);
      runs.push({ x: cx - width / 2, y, text, font, size: sz, color: el.color, width, letterSpacing: ls });
    };
    if (el.symbology === 'upca') {
      put(num[0], (quietL - 4) * m, size * 0.75);
      put(num.slice(1, 6), (quietL + 3 + 7 + 17.5) * m);
      put(num.slice(6, 11), (quietL + 50 + 17.5) * m);
      put(num[11], (quietL + 95 + 4) * m, size * 0.75);
    } else {
      put(ean[0], (quietL - 5) * m);
      put(ean.slice(1, 7), (quietL + 3 + 21) * m);
      put(ean.slice(7, 13), (quietL + 50 + 21) * m);
    }
    out.push({ t: 'text', runs });
  }
  return out;
}
