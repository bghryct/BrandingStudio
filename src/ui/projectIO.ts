import type { Project } from '../model/types';
import { useStore } from '../store/store';
import { faceBytes, restoreUploadedFont, getFace } from '../engine/fonts';

/** Portable project file: the project (images embedded as data URLs) plus uploaded font bytes. */
interface ProjectFile {
  format: 'branding-studio';
  version: 1;
  savedAt: string;
  project: Project;
  fonts: { id: string; fileName: string; data: string }[];
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const safeName = (s: string) => (s || 'brand').replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'brand';

/** Save the project — including uploaded fonts and images — as one portable file. */
export function saveProjectFile(project: Project) {
  const fonts = project.fonts
    .map((f) => {
      const bytes = faceBytes(f.id);
      return bytes ? { id: f.id, fileName: f.fileName, data: toBase64(bytes) } : null;
    })
    .filter(Boolean) as ProjectFile['fonts'];
  const file: ProjectFile = { format: 'branding-studio', version: 1, savedAt: new Date().toISOString(), project, fonts };
  downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${safeName(project.name)}.brand.json`);
}

export async function loadProjectFile(file: File) {
  const data = JSON.parse(await file.text()) as ProjectFile | Project;
  const pf: ProjectFile = 'format' in data ? data : { format: 'branding-studio', version: 1, savedAt: '', project: data as Project, fonts: [] };
  if (!pf.project || pf.project.app !== 'branding-studio' || !Array.isArray(pf.project.products)) throw new Error('Not a Branding Studio project file.');
  for (const f of pf.fonts ?? []) await restoreUploadedFont(f.id, { bytes: fromBase64(f.data), fileName: f.fileName });
  useStore.getState().replaceProject(pf.project);
}

/** Re-register the uploaded fonts a project references (bytes from IndexedDB). */
export async function restoreProjectFonts(project: Project) {
  for (const f of project.fonts) {
    if (getFace(f.id)?.status === 'ready') continue;
    await restoreUploadedFont(f.id).catch(() => null);
  }
}
