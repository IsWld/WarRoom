/** One file inside a mod folder, already read into memory. */
export interface ModFile {
  /** Path relative to the mod folder, using forward slashes, e.g. "common/countries.yaml". */
  path: string;
  text: string;
}

/** A mod as handed to the loader: its folder name and every file in it (including mod.json). */
export interface ModSource {
  folder: string;
  files: ModFile[];
}

export interface ModManifest {
  id: string;
  name: string;
  version: string;
  /** Mods that must be present and load before this one. */
  dependencies: string[];
  /** Mods that load before this one if they are present. */
  loadAfter: string[];
}

/** A problem found while loading content. Loading never stops at the first error. */
export interface ContentError {
  /** Mod id (or folder name if the manifest could not be read). */
  mod: string;
  file?: string;
  /** Collection and record id, e.g. "countries/GER". */
  record?: string;
  line?: number;
  message: string;
}

export type ContentRecord = { id: string } & Record<string, unknown>;

/** Result of validating one record or object. */
export type ValidationResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; issues: { path: string; message: string }[] };

export type Validator = (value: unknown) => ValidationResult;

/** Schemas the loader validates against: one per record collection, plus the defines object. */
export interface ContentSchemas {
  collections: Record<string, Validator>;
  defines: Validator;
}

/** Parses the text of a content file. Throw an error with a numeric `line` property on failure. */
export type TextParser = (text: string) => unknown;

export interface LoadedContent {
  /** Mods in the order they were applied. */
  mods: ModManifest[];
  /** Merged records per collection, in a deterministic order. */
  collections: Record<string, ContentRecord[]>;
  /** Merged and validated defines (balance constants). */
  defines: Record<string, unknown>;
  errors: ContentError[];
}
