/** Merge helpers for mod records. Only plain JSON-like values are expected here. */

export const MERGE_KEY = '@merge';
export const APPEND_KEY = '@append';
export const REMOVE_KEY = '@remove';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merges `patch` into a copy of `base`: objects merge key by key; everything else replaces. */
export function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return out;
}

/**
 * Appends list items: for each key in `additions` (which must hold a list), the record's list
 * at that key gets the new items added. Returns an error message for non-list targets.
 */
export function appendLists(
  base: Record<string, unknown>,
  additions: Record<string, unknown>,
): { value: Record<string, unknown>; error?: string } {
  const out: Record<string, unknown> = { ...base };
  for (const [key, items] of Object.entries(additions)) {
    if (!Array.isArray(items))
      return { value: base, error: `"${APPEND_KEY}.${key}" must be a list` };
    const current = out[key] ?? [];
    if (!Array.isArray(current))
      return { value: base, error: `Cannot append to "${key}": it is not a list` };
    out[key] = [...current, ...items];
  }
  return { value: out };
}
