import { parseCsv } from './csv.ts';
import { parseManifest, resolveLoadOrder } from './manifest.ts';
import {
  APPEND_KEY,
  MERGE_KEY,
  REMOVE_KEY,
  appendLists,
  deepMerge,
  isPlainObject,
} from './merge.ts';
import type {
  ContentError,
  ContentRecord,
  ContentSchemas,
  LoadedContent,
  ModManifest,
  ModSource,
  TextParser,
} from './types.ts';

const CONTENT_FILE = /\.(ya?ml|json|csv)$/i;
const CSV_FILE = /\.csv$/i;
const DEFINES_KEY = 'defines';

interface Provenance {
  mod: string;
  file: string;
}

/**
 * Loads mods: reads manifests, resolves load order, parses every content file, merges records
 * by id, and validates the result. Collects every error instead of stopping at the first.
 *
 * This function has no I/O and no parser dependency: the caller supplies the files and a
 * `parse` function (YAML in practice), so the same code runs in the browser and in Node.
 */
export function loadMods(
  sources: readonly ModSource[],
  parse: TextParser,
  schemas: ContentSchemas,
): LoadedContent {
  const errors: ContentError[] = [];

  // 1. Manifests.
  const manifests: ModManifest[] = [];
  const sourceById = new Map<string, ModSource>();
  for (const source of sources) {
    const file = source.files.find((f) => f.path === 'mod.json');
    if (!file) {
      errors.push({ mod: source.folder, message: 'Missing mod.json' });
      continue;
    }
    const { manifest, errors: manifestErrors } = parseManifest(source.folder, file.text);
    errors.push(...manifestErrors);
    if (manifest) {
      manifests.push(manifest);
      if (!sourceById.has(manifest.id)) sourceById.set(manifest.id, source);
    }
  }

  // 2. Load order.
  const { order, errors: orderErrors } = resolveLoadOrder(manifests);
  errors.push(...orderErrors);

  // 3. Parse and merge, mod by mod in load order, files in sorted path order.
  const collections = new Map<string, Map<string, ContentRecord>>();
  const provenance = new Map<string, Provenance>();
  let defines: Record<string, unknown> = {};
  const definesProvenance: Provenance[] = [];

  for (const manifest of order) {
    const source = sourceById.get(manifest.id)!;
    const files = source.files
      .filter((f) => f.path !== 'mod.json' && CONTENT_FILE.test(f.path))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const seenInMod = new Set<string>();

    for (const file of files) {
      const at = { mod: manifest.id, file: file.path };
      let parsed: unknown;
      try {
        parsed = CSV_FILE.test(file.path)
          ? { [csvCollection(file.path)]: parseCsv(file.text) }
          : parse(file.text);
      } catch (error) {
        const line = (error as { line?: unknown }).line;
        errors.push({
          ...at,
          ...(typeof line === 'number' ? { line } : {}),
          message: firstLine(error),
        });
        continue;
      }
      if (parsed === null || parsed === undefined) continue; // empty file
      if (!isPlainObject(parsed)) {
        errors.push({
          ...at,
          message: 'A content file must map collection names to lists of records',
        });
        continue;
      }

      for (const [collection, value] of Object.entries(parsed)) {
        if (collection === DEFINES_KEY) {
          if (!isPlainObject(value)) {
            errors.push({ ...at, message: '"defines" must be a mapping of names to values' });
            continue;
          }
          defines = deepMerge(defines, value);
          definesProvenance.push(at);
          continue;
        }
        if (!(collection in schemas.collections)) {
          errors.push({ ...at, message: `Unknown collection "${collection}"` });
          continue;
        }
        if (!Array.isArray(value)) {
          errors.push({ ...at, message: `"${collection}" must be a list of records` });
          continue;
        }
        let records = collections.get(collection);
        if (!records) {
          records = new Map();
          collections.set(collection, records);
        }
        for (const entry of value) {
          applyEntry(entry, collection, records, provenance, seenInMod, at, errors);
        }
      }
    }
  }

  // 4. Validate merged records against their schemas.
  const output: Record<string, ContentRecord[]> = {};
  for (const [collection, records] of collections) {
    const validate = schemas.collections[collection]!;
    const valid: ContentRecord[] = [];
    for (const [id, record] of records) {
      const result = validate(record);
      if (result.ok) {
        valid.push(result.value as ContentRecord);
        continue;
      }
      const from = provenance.get(key(collection, id));
      for (const issue of result.issues) {
        errors.push({
          mod: from?.mod ?? '?',
          ...(from ? { file: from.file } : {}),
          record: `${collection}/${id}`,
          message: issue.path ? `${issue.path}: ${issue.message}` : issue.message,
        });
      }
    }
    output[collection] = valid;
  }

  const definesResult = schemas.defines(defines);
  if (!definesResult.ok) {
    const last = definesProvenance.at(-1);
    for (const issue of definesResult.issues) {
      errors.push({
        mod: last?.mod ?? '?',
        ...(last ? { file: last.file } : {}),
        record: DEFINES_KEY,
        message: issue.path ? `${issue.path}: ${issue.message}` : issue.message,
      });
    }
  }

  return {
    mods: order,
    collections: output,
    defines: definesResult.ok ? (definesResult.value as Record<string, unknown>) : defines,
    errors,
  };
}

function applyEntry(
  entry: unknown,
  collection: string,
  records: Map<string, ContentRecord>,
  provenance: Map<string, Provenance>,
  seenInMod: Set<string>,
  at: Provenance,
  errors: ContentError[],
): void {
  if (!isPlainObject(entry) || typeof entry.id !== 'string' || entry.id === '') {
    errors.push({ ...at, message: `Every entry in "${collection}" needs a string "id"` });
    return;
  }
  const id = entry.id;
  const k = key(collection, id);
  const where = { ...at, record: `${collection}/${id}` };

  if (seenInMod.has(k)) {
    errors.push({ ...where, message: 'Defined more than once in the same mod' });
    return;
  }
  seenInMod.add(k);

  const isRemove = entry[REMOVE_KEY] === true;
  const merge = entry[MERGE_KEY];
  const append = entry[APPEND_KEY];
  const isPatch = merge !== undefined || append !== undefined;
  const otherKeys = Object.keys(entry).filter((f) => f !== 'id' && !f.startsWith('@'));
  const unknownDirectives = Object.keys(entry).filter(
    (f) => f.startsWith('@') && f !== MERGE_KEY && f !== APPEND_KEY && f !== REMOVE_KEY,
  );

  if (unknownDirectives.length > 0) {
    errors.push({ ...where, message: `Unknown directive ${unknownDirectives.join(', ')}` });
    return;
  }

  if (isRemove) {
    if (isPatch || otherKeys.length > 0) {
      errors.push({ ...where, message: `"${REMOVE_KEY}" cannot be combined with other fields` });
    } else if (!records.delete(id)) {
      errors.push({ ...where, message: 'Cannot remove: no earlier mod defines this record' });
    } else {
      provenance.delete(k);
    }
    return;
  }

  if (isPatch) {
    if (otherKeys.length > 0) {
      errors.push({
        ...where,
        message: `Put changed fields inside "${MERGE_KEY}", not next to it`,
      });
      return;
    }
    const existing = records.get(id);
    if (!existing) {
      errors.push({ ...where, message: 'Cannot patch: no earlier mod defines this record' });
      return;
    }
    let next: Record<string, unknown> = existing;
    if (merge !== undefined) {
      if (!isPlainObject(merge)) {
        errors.push({ ...where, message: `"${MERGE_KEY}" must be a mapping of fields` });
        return;
      }
      next = deepMerge(next, merge);
    }
    if (append !== undefined) {
      if (!isPlainObject(append)) {
        errors.push({ ...where, message: `"${APPEND_KEY}" must be a mapping of list fields` });
        return;
      }
      const result = appendLists(next, append);
      if (result.error) {
        errors.push({ ...where, message: result.error });
        return;
      }
      next = result.value;
    }
    records.set(id, { ...next, id });
    provenance.set(k, at);
    return;
  }

  // Full definition: add or replace. Map.set keeps a replaced record in its original position.
  records.set(id, entry as ContentRecord);
  provenance.set(k, at);
}

/** A CSV file becomes the collection named by its file stem: map/provinces.csv → provinces. */
function csvCollection(path: string): string {
  const name = path.split('/').at(-1) ?? path;
  return name.replace(CSV_FILE, '');
}

function key(collection: string, id: string): string {
  return `${collection}\u0000${id}`;
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0] ?? message;
}
