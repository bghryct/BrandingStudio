import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Undo2, Redo2, Download, PanelLeft, PanelRight, FolderOpen, Save, FilePlus, Box, PenTool, ChevronDown, Sparkles, Upload, LayoutDashboard, Plus } from 'lucide-react';
import { useStore, type View } from '../store/store';
import { createBlankProject, createStarterProject } from '../model/defaults';
import { BRAND_PRESETS } from '../model/brands';
import { saveProjectFile, loadProjectFile } from './projectIO';
import { importFiles } from './importFiles';

const VIEWS: { id: View; label: string; icon: React.ReactNode; title: string }[] = [
  { id: 'design', label: 'Design', icon: <PenTool size={14} />, title: 'Flat artwork on the dieline' },
  { id: '3d', label: '3D Mockup', icon: <Box size={14} />, title: 'Photoreal 3D mockup, stills and video' },
  { id: 'board', label: 'Brand board', icon: <LayoutDashboard size={14} />, title: 'The brand and every product on one board' },
];

export function TopBar({ onToggleLeft, onToggleRight, leftOpen, rightOpen }: { onToggleLeft: () => void; onToggleRight: () => void; leftOpen: boolean; rightOpen: boolean }) {
  const view = useStore((s) => s.view);
  const name = useStore((s) => s.project.name);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const s = useStore.getState;

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-ink-700 bg-ink-900 px-2">
      <button type="button" onClick={onToggleLeft} title="Toggle left panel" className={clsx('inline-flex h-7 w-7 items-center justify-center rounded text-ink-300 hover:bg-ink-700', leftOpen && 'text-ink-100')}>
        <PanelLeft size={15} />
      </button>
      <div className="flex items-center gap-2 pr-1">
        <Logo />
        <div className="hidden leading-none sm:block">
          <div className="text-[14px] font-bold tracking-[-0.01em] text-ink-100" style={{ fontFamily: '"BRS Syne", "BRS Inter", ui-sans-serif' }}>Branding Studio</div>
        </div>
      </div>
      <FileMenu />
      <button type="button" onClick={() => s().setGalleryOpen(true)} title="Add a product from the template gallery" className="hidden h-7 items-center gap-1 rounded px-2 text-[12px] text-ink-300 hover:bg-ink-700 hover:text-ink-100 md:inline-flex">
        <Plus size={13} /> Product
      </button>
      <input
        className="hidden h-7 w-44 min-w-0 rounded border border-transparent bg-transparent px-2 text-[12px] text-ink-200 outline-none hover:border-ink-700 focus:border-ink-500 lg:block"
        value={name}
        onChange={(e) => s().update((d) => { d.name = e.target.value; }, { history: false })}
        title="Project name"
      />
      <div className="mx-auto flex rounded-[7px] border border-ink-700 bg-ink-850 p-[2px]">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            title={v.title}
            onClick={() => s().setView(v.id)}
            className={clsx('flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] transition-colors', view === v.id ? 'bg-ink-600 text-ink-100' : 'text-ink-400 hover:text-ink-100')}
          >
            {v.icon}
            <span className="hidden lg:inline">{v.label}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" title="Undo (⌘Z)" disabled={!canUndo} onClick={() => s().undo()} className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-300 hover:bg-ink-700 disabled:opacity-30"><Undo2 size={15} /></button>
        <button type="button" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={() => s().redo()} className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-300 hover:bg-ink-700 disabled:opacity-30"><Redo2 size={15} /></button>
        <button type="button" onClick={() => s().setExportOpen(true)} className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-[5px] bg-rubric px-3 text-[12px] font-medium text-white hover:brightness-110">
          <Download size={14} /> <span className="hidden sm:inline">Export</span>
        </button>
        <button type="button" onClick={onToggleRight} title="Toggle inspector" className={clsx('inline-flex h-7 w-7 items-center justify-center rounded text-ink-300 hover:bg-ink-700', rightOpen && 'text-ink-100')}>
          <PanelRight size={15} />
        </button>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="12" fill="#232227" />
      <path d="M22 14h20l3 6v30a4 4 0 0 1-4 4H23a4 4 0 0 1-4-4V20z" fill="#efeae2" />
      <rect x="19" y="26" width="26" height="16" fill="#ff5a36" />
      <path d="M24 31h16M24 36h10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="24" y="10" width="16" height="5" rx="1.5" fill="#b9b2a6" />
    </svg>
  );
}

function FileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const s = useStore.getState;
  const item = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-ink-200 hover:bg-ink-700';
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex h-7 items-center gap-1 rounded px-2 text-[12px] text-ink-300 hover:bg-ink-700 hover:text-ink-100">
        File <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-ink-600 bg-ink-800 p-1 shadow-2xl">
          <button type="button" className={item} onClick={() => {
            if (confirm('Start a new, blank brand? The current project stays autosaved in this browser until replaced.')) s().replaceProject(createBlankProject());
            setOpen(false);
          }}><FilePlus size={14} /> New blank brand</button>
          <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">Start from a starter brand</div>
          {BRAND_PRESETS.map((b) => (
            <button key={b.id} type="button" className={item} title={b.summary} onClick={() => {
              if (confirm(`Load the “${b.label}” starter brand? This replaces the current project.`)) s().replaceProject(createStarterProject(b.id));
              setOpen(false);
            }}>
              <Sparkles size={14} className="shrink-0" />
              <span className="truncate">{b.label}</span>
              <span className="ml-auto flex shrink-0 gap-0.5">{b.kit.palette.slice(0, 4).map((c) => <span key={c.id} className="h-2.5 w-2.5 rounded-full border border-white/10" style={{ background: c.hex }} />)}</span>
            </button>
          ))}
          <div className="my-1 border-t border-ink-700" />
          <button type="button" className={item} onClick={() => { fileRef.current?.click(); }}><FolderOpen size={14} /> Open project… <span className="ml-auto text-[10px] text-ink-500">.brand.json</span></button>
          <button type="button" className={item} onClick={() => { saveProjectFile(s().project); setOpen(false); }}><Save size={14} /> Save project file</button>
          <button type="button" className={item} onClick={() => { importRef.current?.click(); }}><Upload size={14} /> Import images, SVG, fonts…</button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              try { await loadProjectFile(f); s().notify(`Opened ${f.name}`); } catch (err) { s().notify((err as Error).message, 'error'); }
            }
            setOpen(false);
            e.target.value = '';
          }} />
          <input ref={importRef} type="file" multiple accept="image/*,.svg,.ttf,.otf,.woff,.woff2" className="hidden" onChange={async (e) => {
            const files = e.target.files ? [...e.target.files] : [];
            const res = await importFiles(files);
            s().notify(res.errors[0] ?? (res.messages.join(' ') || 'Imported.'), res.errors.length ? 'error' : 'info');
            setOpen(false);
            e.target.value = '';
          }} />
          <div className="my-1 border-t border-ink-700" />
          <p className="px-2 py-1 text-[10.5px] leading-snug text-ink-500">Everything runs in your browser. Projects autosave locally; save a project file to move it between machines.</p>
        </div>
      )}
    </div>
  );
}
