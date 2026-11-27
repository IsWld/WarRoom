import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import type { ModSource } from '../engine/src/content/types.ts';

const TEXT_FILE = /\.(ya?ml|json|csv)$/i;

/** Reads every text content file in a mod folder into memory, with forward-slash relative paths. */
export function readModFolder(dir: string): ModSource {
  if (!statSync(dir).isDirectory()) throw new Error(`Not a folder: ${dir}`);
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((entry) => join(dir, entry))
    .filter((path) => TEXT_FILE.test(path) && statSync(path).isFile())
    .map((path) => ({
      path: relative(dir, path).split(sep).join('/'),
      text: readFileSync(path, 'utf8'),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  return { folder: basename(dir), files };
}
