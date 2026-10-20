import React, { useState } from 'react';
import clsx from 'clsx';
import { X, FileDown, Film, Image as ImageIcon, Save, FolderOpen } from 'lucide-react';
import { useStore } from '../store/store';
import { exportPdf, DEFAULT_PDF_OPTIONS, type PdfOptions } from '../export/pdf';
import { exportSurfaceSvg, exportSurfacePng, type SurfaceExportOptions } from '../export/svg';
import { downloadBlob, saveProjectFile, loadProjectFile, safeName } from './projectIO';
import { Button, Toggle, Select, Segmented, Hint, Row } from './controls';
import { productOf } from '../model/surfaces';
import { dielineOf, getTemplate } from '../products';
import { fromPt } from '../model/units';

type Tab = 'pdf' | 'svg' | 'video' | 'project';

export default function ExportDialog() {
  const [tab, setTab] = useState<Tab>('pdf');
  const close = () => useStore.getState().setExportOpen(false);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex max-h-[92vh] w-full max-w-[660px] flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-850 shadow-2xl">
        <header className="flex items-center gap-3 border-b border-ink-700 px-4 py-3">
          <h2 className="text-[16px] font-semibold text-ink-100">Export</h2>
          <div className="ml-2 flex flex-wrap gap-1">
            {([['pdf', 'Print PDF', <FileDown key="a" size={13} />], ['svg', 'SVG · PNG', <ImageIcon key="b" size={13} />], ['video', '3D stills & video', <Film key="c" size={13} />], ['project', 'Project', <Save key="d" size={13} />]] as const).map(([id, label, icon]) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={clsx('flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px]', tab === id ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-100')}>{icon}{label}</button>
            ))}
          </div>
          <button type="button" title="Close" onClick={close} className="ml-auto rounded p-1 text-ink-400 hover:bg-ink-700 hover:text-ink-100"><X size={16} /></button>
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'pdf' && <PdfTab />}
          {tab === 'svg' && <SvgTab />}
          {tab === 'video' && <VideoTab />}
          {tab === 'project' && <ProjectTab />}
        </div>
      </div>
    </div>
  );
}

function PdfTab() {
  const project = useStore((s) => s.project);
  const activeId = useStore((s) => s.product);
  const product = productOf(project, activeId);
  const [scope, setScope] = useState<'product' | 'all'>('product');
  const [surface, setSurface] = useState('');
  const [o, setO] = useState<PdfOptions>({ ...DEFAULT_PDF_OPTIONS });
  const [busy, setBusy] = useState<{ p: number; label: string } | null>(null);
  const set = (p: Partial<PdfOptions>) => setO({ ...o, ...p });
  const surfaces = product ? dielineOf(product).surfaces : [];
  const hasSpots = project.brand.palette.some((s) => s.spot);
  const run = async () => {
    const products = scope === 'all' ? project.products : product ? [product] : [];
    if (!products.length) return;
    setBusy({ p: 0, label: 'Preparing' });
    try {
      const bytes = await exportPdf(project, products, { ...o, surfaces: scope === 'product' && surface ? [surface] : [], onProgress: (p, label) => setBusy({ p, label }) });
      const name = scope === 'all' ? `${safeName(project.brand.name)}-all-products` : `${safeName(project.brand.name)}-${safeName(product!.name)}${surface ? `-${surface}` : ''}`;
      downloadBlob(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }), `${name}.pdf`);
      useStore.getState().notify('Print PDF exported.');
    } catch (e) {
      console.error(e);
      useStore.getState().notify(`PDF export failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-3">
      <Segmented value={scope} onChange={setScope} options={[{ value: 'product', label: product ? `This product · ${product.name}` : 'This product' }, { value: 'all', label: `All ${project.products.length} products` }]} />
      {scope === 'product' && product && (
        <>
          <Select label="Surfaces" value={surface} options={[{ value: '', label: `Every surface (${surfaces.length} page${surfaces.length === 1 ? '' : 's'})` }, ...surfaces.map((s) => ({ value: s.id, label: s.label }))]} onChange={setSurface} />
          <Hint>{getTemplate(product.template).name}: {surfaces.map((s) => `${s.label} ${(+fromPt(s.w, 'mm').toFixed(1))} × ${(+fromPt(s.h, 'mm').toFixed(1))} mm`).join(' · ')}</Hint>
        </>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-ink-700 p-3">
        <Toggle label="Bleed" checked={o.bleed} onChange={(v) => set({ bleed: v })} />
        <Toggle label="Crop marks" checked={o.cropMarks} onChange={(v) => set({ cropMarks: v })} />
        <Toggle label="Bleed marks" checked={o.bleedMarks} onChange={(v) => set({ bleedMarks: v })} />
        <Toggle label="Registration marks" checked={o.registration} onChange={(v) => set({ registration: v })} />
        <Toggle label="Colour bars" checked={o.colorBars} onChange={(v) => set({ colorBars: v })} />
        <Toggle label="Slug information" checked={o.pageInfo} onChange={(v) => set({ pageInfo: v })} />
        <Toggle label="Dieline layers (CutContour · Fold · Glue)" checked={o.dieline} onChange={(v) => set({ dieline: v })} hint="Named spot colours on their own PDF layers, set to overprint" />
        <Toggle label="Info layer (dims, panels — non-printing)" checked={o.info} onChange={(v) => set({ info: v })} />
        <Toggle label="Finishes on spot plates" checked={o.finishSpots} onChange={(v) => set({ finishSpots: v })} hint="Foils, emboss, deboss, spot UV and white base on named separations" />
        <Toggle label="Brand spot colours as separations" checked={o.brandSpots} onChange={(v) => set({ brandSpots: v })} hint={hasSpots ? 'Palette colours with a spot reference print as solid inks' : 'Add spot references to palette colours in the Brand tab'} />
        <Toggle label="Print substrate colour (proof)" checked={o.substrate} onChange={(v) => set({ substrate: v })} hint="Simulates kraft, metal or coloured stock on white paper" />
      </div>
      <Row>
        <Select label="Colour" value={o.colorMode} options={[{ value: 'cmyk', label: 'CMYK (palette builds preserved)' }, { value: 'rgb', label: 'RGB (screen)' }]} onChange={(v) => set({ colorMode: v })} />
        <Select label="Text" value={o.textMode} options={[{ value: 'auto', label: 'Embed + subset static fonts' }, { value: 'outline', label: 'Convert all to outlines' }]} onChange={(v) => set({ textMode: v })} />
      </Row>
      <Select label="Raster resolution (photos, brushes, mesh gradients)" value={String(o.rasterDpi)} options={[{ value: '150', label: '150 dpi — proof' }, { value: '300', label: '300 dpi — offset' }, { value: '450', label: '450 dpi' }, { value: '600', label: '600 dpi — fine detail' }]} onChange={(v) => set({ rasterDpi: Number(v) })} />
      <Hint>One page per surface with TrimBox and BleedBox. Artwork is vector wherever it can be and is clipped to the bleed outline of the die; the dieline sits on the CutContour and Fold spot layers your printer's RIP expects.</Hint>
      <div className="flex items-center gap-3 pt-1">
        <Button variant="primary" disabled={!!busy || (!product && scope === 'product')} onClick={run}><FileDown size={14} /> Export PDF</Button>
        {busy && (
          <div className="flex flex-1 items-center gap-2 text-[11px] text-ink-300">
            <div className="h-1.5 flex-1 overflow-hidden rounded bg-ink-700"><div className="h-full bg-rubric transition-[width]" style={{ width: `${Math.round(busy.p * 100)}%` }} /></div>
            <span className="truncate">{busy.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SvgTab() {
  const project = useStore((s) => s.project);
  const product = useStore((s) => productOf(s.project, s.product));
  const activeSurface = useStore((s) => s.surface);
  const surfaces = product ? dielineOf(product).surfaces : [];
  const [sid, setSid] = useState(activeSurface);
  const [o, setO] = useState<Omit<SurfaceExportOptions, 'surfaceId'> & { dpi: number; transparent: boolean }>({ bleed: true, dieline: true, outlineText: true, substrate: false, rasterScale: 3, dpi: 300, transparent: false });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof o>) => setO({ ...o, ...p });
  const surfaceId = surfaces.some((s) => s.id === sid) ? sid : surfaces[0]?.id ?? '';
  const go = async (kind: 'svg' | 'png') => {
    if (!product) return;
    setBusy(true);
    try {
      const { blob, name } = kind === 'svg' ? await exportSurfaceSvg(project, product, { ...o, surfaceId }) : await exportSurfacePng(project, product, { ...o, surfaceId });
      downloadBlob(blob, name);
    } catch (e) {
      useStore.getState().notify(`Export failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  if (!product) return <Hint>Add a product first.</Hint>;
  return (
    <div className="space-y-3">
      <Select label={`Surface of ${product.name}`} value={surfaceId} options={surfaces.map((s) => ({ value: s.id, label: s.label }))} onChange={setSid} />
      <div className="grid grid-cols-2 gap-2">
        <Toggle label="Include bleed" checked={o.bleed} onChange={(v) => set({ bleed: v })} />
        <Toggle label="Dieline layers" checked={o.dieline} onChange={(v) => set({ dieline: v })} />
        <Toggle label="Text to outlines" checked={o.outlineText} onChange={(v) => set({ outlineText: v })} hint="Exact rendering without the fonts installed" />
        <Toggle label="Substrate colour" checked={o.substrate} onChange={(v) => set({ substrate: v })} />
        <Toggle label="Transparent PNG" checked={o.transparent} onChange={(v) => set({ transparent: v })} />
      </div>
      <Row>
        <Select label="Raster detail in SVG" value={String(o.rasterScale)} options={[{ value: '2', label: '144 dpi' }, { value: '3', label: '216 dpi' }, { value: '4.1667', label: '300 dpi' }]} onChange={(v) => set({ rasterScale: Number(v) })} />
        <Select label="PNG resolution" value={String(o.dpi)} options={[{ value: '96', label: '96 dpi — screen' }, { value: '150', label: '150 dpi' }, { value: '300', label: '300 dpi' }, { value: '600', label: '600 dpi' }]} onChange={(v) => set({ dpi: Number(v) })} />
      </Row>
      <div className="flex gap-2">
        <Button variant="primary" disabled={busy} onClick={() => go('svg')}>Export SVG</Button>
        <Button disabled={busy} onClick={() => go('png')}>Export PNG</Button>
      </div>
      <Hint>The SVG keeps the artwork, CutContour and Fold as separate named groups (layers in Illustrator, Affinity and Figma). 1 user unit = 1 pt.</Hint>
    </div>
  );
}

function VideoTab() {
  return (
    <div className="space-y-3 text-[12px] text-ink-300">
      <p>Stills and motion render from the 3D mockup: turntables, hero orbits, a can rolling in, a carton folding up from its dieline, a sleeve sliding open — frame-exact and encoded in your browser, in landscape, wide, portrait, square and story formats.</p>
      <ul className="list-disc space-y-1 pl-5 text-[11.5px] text-ink-400">
        <li><span className="text-ink-200">PNG</span> stills up to 4096 px, with alpha on the transparent backdrop</li>
        <li><span className="text-ink-200">MP4</span> — H.264 via WebCodecs (MediaRecorder fallback)</li>
        <li><span className="text-ink-200">WebM</span> — VP9 / VP8, keeps transparency where supported</li>
        <li><span className="text-ink-200">GIF</span> — palette-quantised, works everywhere</li>
      </ul>
      <Button variant="primary" onClick={() => { useStore.getState().setExportOpen(false); useStore.getState().setView('3d'); }}><Film size={14} /> Open the 3D mockup</Button>
    </div>
  );
}

function ProjectTab() {
  const project = useStore((s) => s.project);
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-ink-300">A project file holds the brand kit, every product with its options and artwork, placed images and uploaded fonts — open it on any machine.</p>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => saveProjectFile(project)}><Save size={14} /> Save .brand.json</Button>
        <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[5px] border border-ink-600 bg-ink-750 px-2.5 text-[11.5px] font-medium text-ink-100 hover:bg-ink-700">
          <FolderOpen size={14} /> Open…
          <input type="file" accept=".json,application/json" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { await loadProjectFile(f); useStore.getState().notify(`Opened ${f.name}`); useStore.getState().setExportOpen(false); } catch (err) { useStore.getState().notify((err as Error).message, 'error'); }
          }} />
        </label>
      </div>
      <Hint>Your work also autosaves in this browser (IndexedDB). Clearing site data removes it, so keep project files for anything important.</Hint>
    </div>
  );
}
