import React from 'react';
import clsx from 'clsx';
import {
  MousePointer2, Spline, Type, Square, Circle, Star, Minus, PenTool, Image, Brush, Eraser, Grid3x3, Sparkles, Hand, ZoomIn, BadgeCheck, Barcode, LayoutTemplate,
} from 'lucide-react';
import { useStore, type Tool } from '../store/store';

interface ToolDef { id: Tool; icon: React.ReactNode; label: string; key?: string; hint?: string }

const GROUPS: ToolDef[][] = [
  [
    { id: 'select', icon: <MousePointer2 size={16} />, label: 'Select & transform', key: 'V', hint: 'Shift: add · Alt-click: select beneath · drag handles to resize, circle to rotate' },
    { id: 'node', icon: <Spline size={16} />, label: 'Direct selection (path nodes)', key: 'A' },
  ],
  [
    { id: 'text', icon: <Type size={16} />, label: 'Text', key: 'T', hint: 'Click or drag a frame; double-click a frame to edit it' },
    { id: 'rect', icon: <Square size={16} />, label: 'Rectangle', key: 'R' },
    { id: 'ellipse', icon: <Circle size={16} />, label: 'Ellipse', key: 'E' },
    { id: 'polygon', icon: <Star size={16} />, label: 'Star / polygon / burst' },
    { id: 'line', icon: <Minus size={16} />, label: 'Line', key: 'L' },
    { id: 'pen', icon: <PenTool size={16} />, label: 'Pen (Bézier)', key: 'P', hint: 'Click for corners, drag for curves, click the first point to close, Enter to finish' },
    { id: 'image', icon: <Image size={16} />, label: 'Image frame', key: 'I' },
  ],
  [
    { id: 'logo', icon: <BadgeCheck size={16} />, label: 'Brand logo', key: 'O', hint: 'Lockup, stacked, wordmark, mark, badge — follows the brand kit' },
    { id: 'pattern', icon: <Grid3x3 size={16} />, label: 'Pattern', key: 'K', hint: 'Click a surface to cover it with a repeat; drag for a box' },
    { id: 'gradient', icon: <Sparkles size={16} />, label: 'Mesh gradient', key: 'G', hint: 'Click a surface to fill it; drag for a box' },
    { id: 'barcode', icon: <Barcode size={16} />, label: 'EAN / UPC barcode' },
  ],
  [
    { id: 'brush', icon: <Brush size={16} />, label: 'Brushes — ink, marker, watercolour, crayon…', key: 'B', hint: '[ ] change size' },
    { id: 'eraser', icon: <Eraser size={16} />, label: 'Eraser', key: 'X' },
  ],
  [
    { id: 'hand', icon: <Hand size={16} />, label: 'Hand (or hold Space)', key: 'H' },
    { id: 'zoom', icon: <ZoomIn size={16} />, label: 'Zoom (Alt to zoom out)', key: 'Z' },
  ],
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  return (
    <nav className="scroll-thin flex w-10 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-ink-700 bg-ink-900 py-1.5" aria-label="Tools">
      <button
        type="button"
        title="Template gallery — add a can, bottle, carton, pouch, tote, garment…"
        aria-label="Template gallery"
        onClick={() => useStore.getState().setGalleryOpen(true)}
        className="mb-1 inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-gold hover:bg-ink-700"
      >
        <LayoutTemplate size={16} />
      </button>
      {GROUPS.map((g, gi) => (
        <React.Fragment key={gi}>
          {gi > 0 && <div className="my-1 h-px w-5 bg-ink-700" />}
          {g.map((t) => (
            <button
              key={t.id}
              type="button"
              title={`${t.label}${t.key ? ` (${t.key})` : ''}${t.hint ? ` — ${t.hint}` : ''}`}
              aria-label={t.label}
              onClick={() => setTool(t.id)}
              className={clsx('inline-flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors', tool === t.id ? 'bg-rubric text-white' : 'text-ink-300 hover:bg-ink-700 hover:text-ink-100')}
            >
              {t.icon}
            </button>
          ))}
        </React.Fragment>
      ))}
    </nav>
  );
}
