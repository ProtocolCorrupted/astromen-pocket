import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { validateProject } from './sandbox.mjs';
import type { Project } from '../types';

const native = Capacitor.isNativePlatform();
async function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('astromen-pocket', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Device storage is unavailable. Export your work before closing.'));
  });
}
async function transaction(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest) {
  const database = await db();
  return new Promise<any>((resolve, reject) => {
    const tx = database.transaction('projects', mode);
    const request = operation(tx.objectStore('projects'));
    tx.oncomplete = () => { database.close(); resolve(request.result); };
    tx.onerror = () => { database.close(); reject(new Error('Could not save to device storage.')); };
    tx.onabort = tx.onerror;
  });
}
export async function listProjects(): Promise<Project[]> {
  if (!native) return (await transaction('readonly', store => store.getAll())).map(validateProject);
  let files;
  try { files = (await Filesystem.readdir({ directory: Directory.Data, path: 'projects' })).files; }
  catch (error: any) { if (String(error.message).includes('does not exist') || String(error.message).includes('not exist')) return []; throw error; }
  return Promise.all(files.filter(f => /^[a-zA-Z0-9-]+\.json$/.test(f.name)).map(async f => {
    const result = await Filesystem.readFile({ directory: Directory.Data, path: `projects/${f.name}`, encoding: Encoding.UTF8 });
    return validateProject(JSON.parse(String(result.data)));
  }));
}
export async function saveProject(project: Project) {
  const checked = validateProject(project);
  if (native) await Filesystem.writeFile({ directory: Directory.Data, path: `projects/${checked.id}.json`, data: JSON.stringify(checked), encoding: Encoding.UTF8, recursive: true });
  else await transaction('readwrite', store => store.put(checked));
}
export async function removeProject(id: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid project ID.');
  if (native) await Filesystem.deleteFile({ directory: Directory.Data, path: `projects/${id}.json` });
  else await transaction('readwrite', store => store.delete(id));
}
