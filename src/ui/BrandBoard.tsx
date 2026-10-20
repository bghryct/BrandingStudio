import React, { useMemo } from 'react';
import { Download, Image as ImageIcon } from 'lucide-react';
import { useStore } from '../store/store';
import { boardPrims, BOARD } from '../render/board';
import { primsToSvg } from '../render/svgString';
import { renderToCanvas, preloadImages } from '../render/canvasBackend';
import { useFontStore } from '../engine/fonts';
import { downloadBlob, safeName } from './projectIO';
import { Button } from './controls';

/** The brand on one board: logo, palette, type and the whole range — on screen, as PNG or SVG. */
export default function BrandBoard() {
  const project = useStore((s) => s.project);
  const version = useFontStore((s) => s.version);
  const prims = useMemo(() => boardPrims(project), [project, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const html = useMemo(() => primsToSvg(prims, { pxPerPt: 1.5, idPrefix: 'board' }), [prims]);
  const exportPng = async () => {
    await preloadImages(prims);
    const canvas = renderToCanvas(prims, { x: 0, y: 0, ...BOARD }, 2);
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    downloadBlob(blob, `${safeName(project.brand.name)}-brand-board.png`);
  };
  const exportSvg = async () => {
    await preloadImages(prims);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${BOARD.w}pt" height="${BOARD.h}pt" viewBox="0 0 ${BOARD.w} ${BOARD.h}">${primsToSvg(prims, { pxPerPt: 2, idPrefix: 'bb', outlineText: true })}</svg>`;
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${safeName(project.brand.name)}-brand-board.svg`);
  };
  return (
    <div className="pasteboard flex h-full flex-col overflow-auto p-6">
      <div className="mx-auto mb-3 flex w-full max-w-[1400px] items-center gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-100">Brand board</h2>
          <p className="text-[11px] text-ink-400">Logo, palette with CMYK and spot references, typefaces and every product's artwork. Edit anything in Design or the Brand tab and the board follows.</p>
        </div>
        <div className="ml-auto flex shrink-0 gap-2 whitespace-nowrap">
          <Button onClick={exportSvg}><Download size={13} /> SVG</Button>
          <Button variant="primary" onClick={exportPng}><ImageIcon size={13} /> PNG</Button>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1400px] overflow-hidden rounded-lg shadow-2xl">
        <svg viewBox={`0 0 ${BOARD.w} ${BOARD.h}`} className="block h-auto w-full"><g dangerouslySetInnerHTML={{ __html: html }} /></svg>
      </div>
    </div>
  );
}
