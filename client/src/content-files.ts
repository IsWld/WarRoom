import type { ModSource } from '../../engine/src/content/types.ts';

/**
 * Bundles the core mod's files into the build. Vite replaces `import.meta.glob` at build
 * time with the raw text of every matching file. Player mods (loaded from a folder, zip or
 * URL) arrive in Phase 10 and will produce the same ModSource shape.
 */
const files = import.meta.glob('../../content/core/**/*.{json,yaml,yml}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const PREFIX = '../../content/core/';

export function coreModSource(): ModSource {
  return {
    folder: 'core',
    files: Object.entries(files)
      .map(([path, text]) => ({ path: path.slice(PREFIX.length), text }))
      .sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
}
