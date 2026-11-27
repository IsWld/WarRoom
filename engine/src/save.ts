/**
 * Save files: a snapshot of the state plus the command log since the scenario started and
 * enough metadata to refuse loading into incompatible content. Compression and storage
 * (IndexedDB, file download) are the client's job; this module only defines the format.
 */
import type { CommandLog } from './replay.ts';
import { fromSnapshot, toSnapshot, type Snapshot } from './snapshot.ts';
import type { GameState } from './state.ts';

export const SAVE_FORMAT = 'warroom-save';
export const SAVE_FORMAT_VERSION = 1;

export interface SaveMeta {
  /** Display name, e.g. "Germany, 1 March 1936". */
  name: string;
  setupId: string;
  /** Tag the player was playing, if any. */
  playerTag: string | null;
  /** Mod ids and versions in load order, e.g. ["core@0.0.1"]. */
  mods: string[];
  /** Hash of the merged content; a mismatch means mods changed since saving. */
  contentHash: string;
  /** ISO time the save was written (metadata only; never read by the simulation). */
  savedAt: string;
}

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: number;
  meta: SaveMeta;
  /** Initial seed, so the start state can be rebuilt for replay verification. */
  seed: number;
  snapshot: Snapshot;
  log: CommandLog;
}

export function createSave(
  state: GameState,
  log: CommandLog,
  seed: number,
  meta: SaveMeta,
): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: SAVE_FORMAT_VERSION,
    meta,
    seed,
    snapshot: toSnapshot(state),
    log: { entries: log.entries.map((e) => ({ tick: e.tick, commands: [...e.commands] })) },
  };
}

export function serializeSave(save: SaveFile): string {
  return JSON.stringify(save);
}

export interface LoadedSave {
  save: SaveFile;
  state: GameState;
  /** Problems that do not prevent loading, e.g. content changed since the save. */
  warnings: string[];
}

export function parseSave(text: string, currentContentHash?: string): LoadedSave {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a WarRoom save (not valid JSON)');
  }
  const save = raw as Partial<SaveFile>;
  if (save.format !== SAVE_FORMAT) throw new Error('This file is not a WarRoom save');
  if (save.version !== SAVE_FORMAT_VERSION) {
    throw new Error(
      `Save format version ${save.version} is not supported (expected ${SAVE_FORMAT_VERSION})`,
    );
  }
  if (!save.meta || !save.snapshot || !save.log || typeof save.seed !== 'number') {
    throw new Error('Corrupt save: missing sections');
  }
  const warnings: string[] = [];
  if (currentContentHash !== undefined && save.meta.contentHash !== currentContentHash) {
    warnings.push(
      `This save was made with different mods (${save.meta.mods.join(', ')}); it may not load correctly.`,
    );
  }
  return { save: save as SaveFile, state: fromSnapshot(save.snapshot), warnings };
}

/** FNV-1a hash of any JSON-serializable value, used for content hashes. */
export function hashJson(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
