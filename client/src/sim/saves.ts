/**
 * Save storage in the browser: IndexedDB for the save list (gzip-compressed), plus export to
 * and import from files. Save contents come from the worker as JSON text.
 */
import type { SaveMeta } from '../../../engine/src/save.ts';

const DB_NAME = 'warroom';
const DB_VERSION = 1;
const STORE = 'saves';

export interface StoredSaveInfo {
  id: string;
  meta: SaveMeta;
  bytes: number;
}

interface StoredSave extends StoredSaveInfo {
  data: Blob;
}

/** Gzip-compresses text. */
export async function compressText(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

/** Decompresses gzip data, or returns plain text if the data is not gzipped. */
export async function decompressToText(data: Blob): Promise<string> {
  const head = new Uint8Array(await data.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return data.text();
  const stream = data.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open save storage'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Save storage error'));
    });
  } finally {
    db.close();
  }
}

export async function writeSave(id: string, meta: SaveMeta, text: string): Promise<void> {
  const data = await compressText(text);
  const record: StoredSave = { id, meta, bytes: data.size, data };
  await withStore('readwrite', (store) => store.put(record));
}

export async function readSave(id: string): Promise<string | null> {
  const record = await withStore<StoredSave | undefined>(
    'readonly',
    (store) => store.get(id) as IDBRequest<StoredSave | undefined>,
  );
  return record ? decompressToText(record.data) : null;
}

export async function listSaves(): Promise<StoredSaveInfo[]> {
  const records = await withStore<StoredSave[]>(
    'readonly',
    (store) => store.getAll() as IDBRequest<StoredSave[]>,
  );
  return records
    .map(({ id, meta, bytes }) => ({ id, meta, bytes }))
    .sort((a, b) => (a.meta.savedAt < b.meta.savedAt ? 1 : -1));
}

export async function deleteSave(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}

/** Offers the save as a downloadable .warroom file (gzip-compressed JSON). */
export async function exportSave(fileName: string, text: string): Promise<void> {
  const blob = await compressText(text);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.warroom') ? fileName : `${fileName}.warroom`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Reads an imported save file (gzipped or plain JSON) as text. */
export function importSaveFile(file: File): Promise<string> {
  return decompressToText(file);
}
