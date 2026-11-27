/**
 * Validates one or more mod folders, loaded together in dependency order.
 *
 *   node tools/validate-content.ts content/core [path/to/another-mod ...]
 *
 * Exits with code 1 if any error is found.
 */
import { pathToFileURL } from 'node:url';
import { loadMods } from '../engine/src/content/loader.ts';
import { CORE_SCHEMAS } from '../engine/src/content/schemas.ts';
import type { ContentError } from '../engine/src/content/types.ts';
import { parseYaml } from '../engine/src/content/yaml.ts';
import { readModFolder } from './mod-folder.ts';

export function formatError(e: ContentError): string {
  const where = [e.mod, e.file && (e.line ? `${e.file}:${e.line}` : e.file), e.record]
    .filter(Boolean)
    .join(' › ');
  return `  ✗ ${where}\n    ${e.message}`;
}

function main(args: string[]): number {
  if (args.length === 0) {
    console.error('Usage: node tools/validate-content.ts <mod-folder> [more mod folders...]');
    return 2;
  }
  const result = loadMods(args.map(readModFolder), parseYaml, CORE_SCHEMAS);
  const counts = Object.entries(result.collections)
    .map(([name, records]) => `${records.length} ${name}`)
    .join(', ');
  console.log(`Loaded ${result.mods.map((m) => `${m.id}@${m.version}`).join(', ') || 'no mods'}`);
  console.log(`Records: ${counts || 'none'}`);
  if (result.errors.length === 0) {
    console.log('✓ No content errors');
    return 0;
  }
  console.error(`\n${result.errors.length} content error(s):`);
  for (const error of result.errors) console.error(formatError(error));
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
