import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useStore, loadAutosave, startAutosave } from './store/store';
import { ensureFamily } from './engine/fonts';
import { ensureHyphenation } from './engine/hyphenate';
import { TopBar } from './ui/TopBar';
import { Toolbar } from './ui/Toolbar';
import { BrushBar } from './ui/BrushBar';
import { StatusBar } from './ui/StatusBar';
import { LeftPanel } from './ui/panels/LeftPanel';
import { RightPanel } from './ui/panels/RightPanel';
import { Editor } from './ui/canvas/Editor';
import { restoreProjectFonts } from './ui/projectIO';
import { Toast } from './ui/Toast';
import { BrushPanel } from './ui/brush';
import { useScene3D } from './ui/scene3d';

const Viewer3D = lazy(() => import('./ui/Viewer3D'));
const BrandBoard = lazy(() => import('./ui/BrandBoard'));
const ExportDialog = lazy(() => import('./ui/ExportDialog'));
const TemplateGallery = lazy(() => import('./ui/TemplateGallery'));

export default function App() {
  const view = useStore((s) => s.view);
  const tool = useStore((s) => s.tool);
  const exportOpen = useStore((s) => s.exportOpen);
  const galleryOpen = useStore((s) => s.galleryOpen);
  const left = useStore((s) => s.leftOpen);
  const setLeft = useStore((s) => s.setLeftOpen);
  const [right, setRight] = useState(() => window.innerWidth > 700);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadAutosave();
      if (cancelled) return;
      if (saved) {
        useStore.getState().replaceProject(saved);
        await restoreProjectFonts(saved);
      }
      useStore.setState({ ready: true });
      startAutosave();
    })();
    // Warm the faces the starter brand uses and the hyphenation patterns.
    const kit = useStore.getState().project.brand;
    for (const f of [kit.fonts.headline, kit.fonts.body, kit.fonts.accent, 'inter']) void ensureFamily(f);
    void ensureHyphenation('en-us');
    return () => { cancelled = true; };
  }, []);

  const editing = view === 'design';
  const scenePanel = useScene3D((s) => s.panel);
  const leftShown = view === '3d' ? scenePanel : left;
  const toggleLeft = () => (view === '3d' ? useScene3D.getState().set({ panel: !scenePanel }) : setLeft(!left));
  return (
    <div className="flex h-full flex-col bg-ink-950 text-ink-100">
      <TopBar onToggleLeft={toggleLeft} onToggleRight={() => setRight(!right)} leftOpen={leftShown} rightOpen={right} />
      <div className="flex min-h-0 flex-1">
        {left && view !== '3d' && <LeftPanel />}
        <main className="relative flex min-w-0 flex-1 flex-col">
          {editing && (tool === 'brush' || tool === 'eraser') && <BrushBar />}
          <div className="relative flex min-h-0 flex-1">
            {editing && <Toolbar />}
            <div className="relative min-w-0 flex-1">
              {editing && <Editor />}
              {editing && (tool === 'brush' || tool === 'eraser') && <BrushPanel />}
              <Suspense fallback={<Loading />}>
                {view === '3d' && <Viewer3D />}
                {view === 'board' && <BrandBoard />}
              </Suspense>
            </div>
          </div>
          <StatusBar />
        </main>
        {right && (editing || view === '3d') && <RightPanel />}
      </div>
      <Suspense fallback={null}>
        {exportOpen && <ExportDialog />}
        {galleryOpen && <TemplateGallery />}
      </Suspense>
      <Toast />
    </div>
  );
}

function Loading() {
  return <div className="flex h-full items-center justify-center text-ink-400">Loading…</div>;
}
