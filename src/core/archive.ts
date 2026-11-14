import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { safePath, validateProject, uid } from './sandbox.mjs';
import type { Project } from '../types';

export async function exportProject(project: Project) {
  const archive: Record<string, Uint8Array> = {};
  for (const file of project.files) archive[safePath(file.path)] = strToU8(file.content);
  archive['astromen-project.json'] = strToU8(JSON.stringify({ ...project, history: [], messages: project.messages.map(({ baseFiles, ...m }) => m) }, null, 2));
  const bytes = zipSync(archive), name = `${project.name.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 60)}.zip`;
  if (Capacitor.isNativePlatform()) {
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    const file = await Filesystem.writeFile({ directory: Directory.Cache, path: name, data: btoa(binary) });
    await Share.share({ title: project.name, url: file.uri });
  } else {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export async function importProject(file: File): Promise<Project> {
  if (file.size > 10_000_000) throw new Error('Import archives must be smaller than 10 MB.');
  if (file.name.endsWith('.json')) return { ...validateProject(JSON.parse(await file.text())), id: uid(), history: [] };
  let total = 0;
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => {
    if (entry.name.endsWith('/')) return false;
    safePath(entry.name); total += entry.originalSize;
    if (total > 20_000_000 || entry.originalSize > 5_000_000) throw new Error('Expanded archive is too large.');
    return true;
  } });
  if (entries['astromen-project.json']) return { ...validateProject(JSON.parse(strFromU8(entries['astromen-project.json']))), id: uid(), history: [] };
  const files = Object.entries(entries).map(([path, data]) => ({ path, content: strFromU8(data) }));
  return validateProject({ name: file.name.replace(/\.zip$/i, ''), description: 'Imported from your files.', files });
}
