import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadMods } from '../../engine/src/content/loader.ts';
import { CORE_SCHEMAS } from '../../engine/src/content/schemas.ts';
import { parseYaml } from '../../engine/src/content/yaml.ts';
import { readModFolder } from '../mod-folder.ts';

const coreDir = fileURLToPath(new URL('../../content/core', import.meta.url));

test('the core mod loads without errors', () => {
  const result = loadMods([readModFolder(coreDir)], parseYaml, CORE_SCHEMAS);
  assert.deepEqual(result.errors, []);
  assert.equal(result.mods[0]?.id, 'core');
  assert.ok((result.collections.countries?.length ?? 0) >= 7);
});
