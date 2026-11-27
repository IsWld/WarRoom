import type { ContentError, ModManifest } from './types.ts';

const MOD_ID = /^[a-z0-9][a-z0-9-]*$/;

/** Parses and checks a mod.json file. Returns the manifest, or null plus errors. */
export function parseManifest(
  folder: string,
  text: string,
): { manifest: ModManifest | null; errors: ContentError[] } {
  const errors: ContentError[] = [];
  const fail = (message: string) => errors.push({ mod: folder, file: 'mod.json', message });

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    fail(`mod.json is not valid JSON: ${(error as Error).message}`);
    return { manifest: null, errors };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail('mod.json must contain a JSON object');
    return { manifest: null, errors };
  }
  const obj = raw as Record<string, unknown>;

  const id = obj.id;
  if (typeof id !== 'string' || !MOD_ID.test(id)) {
    fail('"id" must be lowercase letters, digits and hyphens, e.g. "my-mod"');
  }
  if (typeof obj.name !== 'string' || obj.name.trim() === '')
    fail('"name" must be a non-empty string');
  if (typeof obj.version !== 'string' || obj.version.trim() === '')
    fail('"version" must be a string');
  const dependencies = stringList(obj.dependencies, 'dependencies', fail);
  const loadAfter = stringList(obj.loadAfter, 'loadAfter', fail);

  if (errors.length > 0) return { manifest: null, errors };
  return {
    manifest: {
      id: id as string,
      name: obj.name as string,
      version: obj.version as string,
      dependencies,
      loadAfter,
    },
    errors,
  };
}

function stringList(value: unknown, field: string, fail: (m: string) => void): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    fail(`"${field}" must be a list of mod ids`);
    return [];
  }
  return value as string[];
}

/**
 * Orders mods so every mod loads after its dependencies and after any present `loadAfter`
 * mods. Ties keep the order the mods were given in, so the result is deterministic.
 */
export function resolveLoadOrder(manifests: readonly ModManifest[]): {
  order: ModManifest[];
  errors: ContentError[];
} {
  const errors: ContentError[] = [];
  const byId = new Map<string, ModManifest>();
  for (const m of manifests) {
    if (byId.has(m.id))
      errors.push({ mod: m.id, file: 'mod.json', message: `Duplicate mod id "${m.id}"` });
    else byId.set(m.id, m);
  }

  const prerequisites = new Map<string, string[]>();
  for (const m of byId.values()) {
    const before: string[] = [];
    for (const dep of m.dependencies) {
      if (byId.has(dep)) before.push(dep);
      else errors.push({ mod: m.id, file: 'mod.json', message: `Missing required mod "${dep}"` });
    }
    for (const after of m.loadAfter) if (byId.has(after)) before.push(after);
    prerequisites.set(m.id, before);
  }

  const order: ModManifest[] = [];
  const placed = new Set<string>();
  const pending = [...byId.values()];
  while (pending.length > 0) {
    const index = pending.findIndex((m) => prerequisites.get(m.id)!.every((p) => placed.has(p)));
    if (index < 0) {
      const ids = pending.map((m) => m.id).join(', ');
      for (const m of pending) {
        errors.push({ mod: m.id, file: 'mod.json', message: `Load order cycle among: ${ids}` });
      }
      break;
    }
    const [next] = pending.splice(index, 1);
    order.push(next!);
    placed.add(next!.id);
  }
  return { order, errors };
}
