import { saveNpy } from '../data/npy_file.ts';
import { download } from '../data/download.ts';
import { fromFrames } from '../data/recording.ts';
import type { Sidecar } from './sidecar.ts';

/** Where captures are written: a folder the user picked, or downloads. */
export interface Sink {
  name: string;
  write(file: string, blob: Blob): Promise<void>;
  remove?(file: string): Promise<void>;
  /** Sidecars already in the folder (for running counts), when it can list. */
  sidecars?(): Promise<Sidecar[]>;
}

type DirHandle = {
  name: string;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>; getFile(): Promise<File> }>;
  removeEntry(name: string): Promise<void>;
  values(): AsyncIterable<{ kind: string; name: string }>;
  queryPermission?(o: { mode: string }): Promise<string>;
  requestPermission?(o: { mode: string }): Promise<string>;
};

/** Writes files straight into a folder (File System Access API: Chrome, Edge). */
export function folderSink(dir: DirHandle): Sink {
  return {
    name: dir.name,
    async write(file, blob) {
      const fh = await dir.getFileHandle(file, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    },
    async remove(file) { await dir.removeEntry(file); },
    async sidecars() {
      const out: Sidecar[] = [];
      for await (const e of dir.values()) {
        if (e.kind !== 'file' || !e.name.endsWith('.json')) continue;
        try {
          const s = JSON.parse(await (await (await dir.getFileHandle(e.name)).getFile()).text());
          if (s?.format === 'radar-js-capture') out.push(s);
        } catch { /* not a sidecar */ }
      }
      return out;
    },
  };
}

/** Offers each file as a browser download (works everywhere; files land in Downloads). */
export function downloadSink(): Sink {
  return { name: 'Downloads', async write(file, blob) { download(blob, file); } };
}

const DB = 'radar-js', STORE = 'handles', KEY = 'capture-folder';
function idb<T>(fn: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = fn(open.result.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

/** True where the browser can write into a chosen folder. */
export const canChooseFolder = (): boolean => typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

/** Ask the user for a folder to save captures in (remembered for next time). */
export async function chooseFolder(): Promise<Sink> {
  const dir = await (globalThis as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ id: 'radar-captures', mode: 'readwrite' });
  try { await idb(s => s.put(dir, KEY), 'readwrite'); } catch { /* remembered for this visit only */ }
  return folderSink(dir);
}

/** The folder chosen last time, if the browser still allows writing to it (may ask the user). */
export async function restoreFolder(ask = false): Promise<Sink | null> {
  try {
    const dir = await idb<DirHandle | undefined>(s => s.get(KEY), 'readonly');
    if (!dir) return null;
    let state = await dir.queryPermission?.({ mode: 'readwrite' });
    if (state !== 'granted' && ask) state = await dir.requestPermission?.({ mode: 'readwrite' });
    return state === 'granted' ? folderSink(dir) : null;
  } catch { return null; }
}

/**
 * Save a capture: <stem>.npy with the frames (frames, rx, chirps, samples,
 * float32, as SensDSv2 reads recordings) and <stem>.json with its sidecar.
 */
export async function saveCapture(sink: Sink, stem: string, frames: Float32Array[], shape: [number, number, number], meta: Sidecar): Promise<void> {
  const rec = fromFrames(frames, shape);
  await sink.write(`${stem}.npy`, saveNpy(rec));
  await sink.write(`${stem}.json`, new Blob([JSON.stringify(meta, null, 1)], { type: 'application/json' }));
}
