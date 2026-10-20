import React, { useMemo } from 'react';
import type { Element, Product, Project } from '../../model/types';
import { compileElement, layoutText, anchorOffsetOf, elementMatrix, type CompileContext } from '../../render/compile';
import { primsToSvg } from '../../render/svgString';
import { rectPath, type Prim, type Matrix } from '../../render/primitives';
import { useFontStore } from '../../engine/fonts';
import type { SurfaceDesc } from './geometry';
import type { Overlays } from '../../store/store';
import { bleedPath, cutPath, piecePath, holesPath } from '../../products';
import type { DielineSurface, Zone } from '../../products/types';
import { polyToPath } from '../../products/geom';
import { fromPt } from '../../model/units';
import type { Unit } from '../../model/types';

const mat = (m: Matrix) => `matrix(${m.map((v) => +v.toFixed(4)).join(' ')})`;

function ElementView({ el, ctx, rasterScale, ox, oy }: { el: Element; ctx: CompileContext; rasterScale: number; ox: number; oy: number }) {
  useFontStore((s) => s.version);
  const layout = el.type === 'text' ? layoutText(el, ctx) : null;
  const generic = el.type === 'text' ? null : compileElement(el, ctx);
  const prims: Prim[] = useMemo(() => {
    if (el.type === 'text' && layout) return el.fill ? [{ t: 'path', d: rectPath(0, 0, el.w, el.h), fill: el.fill }, ...layout.prims] : layout.prims;
    return generic ?? [];
  }, [layout, generic, el]);
  const html = useMemo(() => primsToSvg(prims, { pxPerPt: rasterScale, idPrefix: `e${el.id}x` }), [prims, rasterScale, el.id]);
  return (
    <g
      data-el={el.id}
      transform={mat(elementMatrix(el, ox, oy))}
      opacity={el.opacity < 1 ? el.opacity : undefined}
      style={el.blend !== 'normal' ? { mixBlendMode: el.blend } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const MemoElement = React.memo(ElementView, (a, b) => a.el === b.el && a.rasterScale === b.rasterScale && a.ox === b.ox && a.oy === b.oy
  && (a.el.type !== 'text' && a.el.type !== 'logo' ? true : a.ctx.project.brand === b.ctx.project.brand && a.ctx.project.paragraphStyles === b.ctx.project.paragraphStyles && a.ctx.product?.name === b.ctx.product?.name));

const transparent = (c: string) => !c || c === 'transparent' || /^#[0-9a-f]{6}00$/i.test(c);

/** Artwork of one surface: substrate, ground and items clipped to the bleed outline. */
export function SurfaceView({ project, product, sd, rasterScale }: { project: Project; product: Product; sd: SurfaceDesc; rasterScale: number }) {
  const s = sd.s;
  const art = product.surfaces[s.id];
  const ctx: CompileContext = { project, product, surface: s };
  const clipId = `clip-${sd.key.replace(/[^a-z0-9]/gi, '')}`;
  const b = s.bleed;
  const clipD = s.cutKind === 'none' ? rectPath(0, 0, s.w, s.h) : bleedPath(s);
  const box = rectPath(-b, -b, s.w + 2 * b, s.h + 2 * b);
  return (
    <g transform={`translate(${sd.x} ${sd.y})`}>
      <defs>
        <clipPath id={clipId}><path d={clipD} /></clipPath>
      </defs>
      {s.context && <path d={s.context.d} fill={s.context.fill} stroke={s.context.stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      {s.cutKind !== 'none' && <path d={clipD} fill="rgba(0,0,0,0.38)" transform="translate(1.5 2.5)" style={{ filter: 'blur(3px)' }} />}
      <g clipPath={`url(#${clipId})`}>
        {transparent(s.substrate) ? <path d={box} fill="url(#brs-checker)" opacity={s.context ? 0.5 : 1} /> : (s.cutKind !== 'none' || !s.context) && <path d={box} fill={s.substrate} />}
        {art?.background && <path d={box} fill={art.background} />}
        {(art?.elements ?? []).filter((e) => !e.hidden).map((el) => {
          const o = anchorOffsetOf(el, s);
          return <MemoElement key={el.id} el={el} ctx={ctx} rasterScale={rasterScale} ox={o.x} oy={o.y} />;
        })}
      </g>
      {s.holes?.length ? <path d={holesPath(s)} fill="#29282d" /> : null}
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* Dieline overlay                                                              */
/* -------------------------------------------------------------------------- */

export const DIE_COLORS = { cut: '#ff2d6f', fold: '#19b5ff', perf: '#19b5ff', bleed: '#ff2d6f', safe: '#3ddc84', glue: '#d9c34a', dim: '#e9e3d9' };

const ZONE_STYLE: Record<Zone['kind'], { fill: string; stroke: string; dash?: string }> = {
  glue: { fill: 'url(#brs-hatch)', stroke: 'rgba(217,195,74,0.9)' },
  distortion: { fill: 'rgba(255,190,60,0.13)', stroke: 'rgba(255,190,60,0.55)', dash: '3 3' },
  seam: { fill: 'rgba(255,45,111,0.12)', stroke: 'rgba(255,45,111,0.6)', dash: '2 2' },
  seal: { fill: 'rgba(140,140,160,0.22)', stroke: 'rgba(170,170,190,0.6)', dash: '2 3' },
  nonprint: { fill: 'rgba(120,120,135,0.2)', stroke: 'rgba(160,160,175,0.6)', dash: '4 3' },
  'print-area': { fill: 'none', stroke: 'rgba(61,220,132,0.9)', dash: '6 4' },
  window: { fill: 'rgba(25,181,255,0.08)', stroke: 'rgba(25,181,255,0.7)', dash: '5 3' },
  barcode: { fill: 'none', stroke: 'rgba(255,255,255,0.6)', dash: '3 3' },
  info: { fill: 'rgba(255,255,255,0.5)', stroke: 'none' },
};

export function DielineOverlay({ sd, ov, zoom, unit, active }: { sd: SurfaceDesc; ov: Overlays; zoom: number; unit: Unit; active: boolean }) {
  const s: DielineSurface = sd.s;
  const fs = 10 / zoom;
  const lw = { vectorEffect: 'non-scaling-stroke' as const };
  const bleedD = s.cutKind !== 'none' && s.bleed > 0 ? bleedPath(s) : '';
  return (
    <g transform={`translate(${sd.x} ${sd.y})`} pointerEvents="none">
      {/* Veil over the bleed area (outside the cut) */}
      {ov.bleed && bleedD && (
        <>
          <defs>
            <mask id={`veil-${sd.id}`} maskUnits="userSpaceOnUse" x={-s.bleed - 2} y={-s.bleed - 2} width={s.w + 2 * s.bleed + 4} height={s.h + 2 * s.bleed + 4}>
              <path d={bleedD} fill="white" />
              <path d={piecePath(s)} fill="black" />
            </mask>
          </defs>
          <rect x={-s.bleed - 1} y={-s.bleed - 1} width={s.w + 2 * s.bleed + 2} height={s.h + 2 * s.bleed + 2} fill="rgba(41,40,45,0.5)" mask={`url(#veil-${sd.id})`} />
        </>
      )}
      {ov.zones && s.zones.map((z, i) => {
        const st = ZONE_STYLE[z.kind];
        return <path key={`z${i}`} d={polyToPath(z.poly)} fill={st.fill} stroke={st.stroke} strokeDasharray={st.dash} strokeWidth={1} {...lw} />;
      })}
      {ov.safe && s.panels.filter((p) => p.safe > 0 && p.role !== 'glue').map((p) => (
        <rect key={`safe${p.id}`} x={p.x + p.safe} y={p.y + p.safe} width={Math.max(0, p.w - 2 * p.safe)} height={Math.max(0, p.h - 2 * p.safe)} fill="none" stroke={DIE_COLORS.safe} strokeOpacity={0.75} strokeDasharray="2 3" strokeWidth={1} {...lw} />
      ))}
      {ov.folds && s.folds.map((f, i) => (
        <polyline key={`f${i}`} points={f.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={DIE_COLORS.fold} strokeWidth={1.1} strokeDasharray={f.kind === 'perf' ? '1.5 2.5' : f.kind === 'reverse' ? '8 3 2 3' : '5 3'} {...lw} />
      ))}
      {ov.cut && s.cutKind !== 'none' && <path d={cutPath(s)} fill="none" stroke={DIE_COLORS.cut} strokeWidth={1.1} {...lw} />}
      {ov.bleed && bleedD && <path d={bleedD} fill="none" stroke={DIE_COLORS.bleed} strokeOpacity={0.4} strokeDasharray="1 3" strokeWidth={1} {...lw} />}
      {ov.panels && s.panels.length > 1 && s.panels.filter((p) => p.role !== 'glue' || p.w * zoom > 30).map((p) => (
        <g key={`pl${p.id}`}>
          <text x={p.x + p.w / 2} y={p.y + Math.min(p.h * 0.5, fs * 1.6)} fontSize={fs} textAnchor="middle" fill="rgba(25,181,255,0.85)" style={{ fontFamily: 'ui-sans-serif, system-ui', fontWeight: 600 }}>
            {p.w * zoom > 60 ? p.label : ''}{p.read && p.w * zoom > 60 ? ` ↻${p.read}°` : ''}
          </text>
        </g>
      ))}
      {ov.dims && active && s.dims.map((d, i) => <DimLine key={`d${i}`} d={d} fs={fs} unit={unit} />)}
    </g>
  );
}

function DimLine({ d, fs, unit }: { d: DielineSurface['dims'][number]; fs: number; unit: Unit }) {
  const dx = d.b.x - d.a.x, dy = d.b.y - d.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const o = d.offset;
  const a = { x: d.a.x + nx * o, y: d.a.y + ny * o }, b = { x: d.b.x + nx * o, y: d.b.y + ny * o };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const label = d.label ?? `${(+fromPt(len, unit).toFixed(unit === 'in' ? 3 : 1))} ${unit}`;
  const tick = fs * 0.5;
  const c = DIE_COLORS.dim;
  return (
    <g opacity={0.85}>
      <line x1={d.a.x} y1={d.a.y} x2={a.x} y2={a.y} stroke={c} strokeWidth={0.6} vectorEffect="non-scaling-stroke" strokeOpacity={0.5} />
      <line x1={d.b.x} y1={d.b.y} x2={b.x} y2={b.y} stroke={c} strokeWidth={0.6} vectorEffect="non-scaling-stroke" strokeOpacity={0.5} />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
      <line x1={a.x - nx * tick + (dx / len) * tick} y1={a.y - ny * tick + (dy / len) * tick} x2={a.x + nx * tick - (dx / len) * tick} y2={a.y + ny * tick - (dy / len) * tick} stroke={c} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
      <line x1={b.x - nx * tick + (dx / len) * tick} y1={b.y - ny * tick + (dy / len) * tick} x2={b.x + nx * tick - (dx / len) * tick} y2={b.y + ny * tick - (dy / len) * tick} stroke={c} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
      <g transform={`translate(${mid.x} ${mid.y}) rotate(${ang > 90 || ang < -90 ? ang + 180 : ang})`}>
        <rect x={-label.length * fs * 0.3 - fs * 0.3} y={-fs * 0.75} width={label.length * fs * 0.6 + fs * 0.6} height={fs * 1.3} rx={fs * 0.25} fill="#29282d" />
        <text x={0} y={fs * 0.32} fontSize={fs * 0.92} textAnchor="middle" fill={c} style={{ fontFamily: 'ui-sans-serif, system-ui' }}>{label}</text>
      </g>
    </g>
  );
}

/** Shared SVG defs: checkerboard (clear substrates) and glue hatching. */
export function EditorDefs() {
  return (
    <defs>
      <pattern id="brs-checker" width="12" height="12" patternUnits="userSpaceOnUse">
        <rect width="12" height="12" fill="#d8dde2" />
        <rect width="6" height="6" fill="#eef1f4" />
        <rect x="6" y="6" width="6" height="6" fill="#eef1f4" />
      </pattern>
      <pattern id="brs-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="rgba(217,195,74,0.12)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(217,195,74,0.55)" strokeWidth="1.5" />
      </pattern>
    </defs>
  );
}
