/**
 * Validates one or more mod folders, loaded together in dependency order.
 *
 *   node tools/validate-content.ts content/core [path/to/another-mod ...]
 *
 * Exits with code 1 if any error is found.
 */
import { pathToFileURL } from 'node:url';
import type { ContentError } from '../engine/src/content/types.ts';
import { loadContentFromFolders } from './load-content.ts';

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
  const { content: result, map, errors, warnings } = loadContentFromFolders(args);
  const counts = Object.entries(result.collections)
    .map(([name, records]) => `${records.length} ${name}`)
    .join(', ');
  console.log(`Loaded ${result.mods.map((m) => `${m.id}@${m.version}`).join(', ') || 'no mods'}`);
  console.log(`Records: ${counts || 'none'}`);
  if (map) {
    console.log(
      `Map: ${map.width}×${map.height}, ${map.provinceCount} provinces, ${map.adjList.length / 2} borders`,
    );
  }
  if (warnings.length > 0) {
    console.log(`${warnings.length} warning(s):`);
    for (const w of warnings.slice(0, 30)) console.log(`  ! ${w}`);
    if (warnings.length > 30) console.log(`  ...and ${warnings.length - 30} more`);
  }
  if (errors.length === 0) {
    console.log('✓ No content errors');
    return 0;
  }
  console.error(`\n${errors.length} content error(s):`);
  for (const error of errors.slice(0, 200)) console.error(formatError(error));
  if (errors.length > 200) console.error(`  ...and ${errors.length - 200} more`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
