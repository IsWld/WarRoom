/**
 * Loader core tests. They use JSON (a subset of YAML) and hand-written validators so they run
 * without the YAML and Zod packages; the real schemas are covered in schemas.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMods } from '../src/content/loader.ts';
import { resolveLoadOrder } from '../src/content/manifest.ts';
import type { ContentSchemas, ModManifest, ModSource, Validator } from '../src/content/types.ts';

const parseWithLine = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw Object.assign(new Error(`Bad syntax: ${(error as Error).message}`), { line: 1 });
  }
};

const country: Validator = (value) => {
  const v = value as Record<string, unknown>;
  const issues: { path: string; message: string }[] = [];
  if (typeof v.name !== 'string') issues.push({ path: 'name', message: 'required' });
  return issues.length ? { ok: false, issues } : { ok: true, value };
};

const SCHEMAS: ContentSchemas = {
  collections: { countries: country },
  defines: (value) => ({ ok: true, value }),
};

function mod(
  id: string,
  files: Record<string, unknown>,
  manifest: Partial<ModManifest> = {},
): ModSource {
  return {
    folder: id,
    files: [
      { path: 'mod.json', text: JSON.stringify({ id, name: id, version: '1', ...manifest }) },
      ...Object.entries(files).map(([path, content]) => ({
        path,
        text: typeof content === 'string' ? content : JSON.stringify(content),
      })),
    ],
  };
}

const core = mod('core', {
  'common/countries.json': {
    countries: [
      { id: 'GER', name: 'Germany', cores: ['GER'] },
      { id: 'FRA', name: 'France' },
    ],
  },
  'common/defines.json': { defines: { game: { start_date: '1936-01-01', speed: 1 } } },
});

test('loads a single mod', () => {
  const r = loadMods([core], parseWithLine, SCHEMAS);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(
    r.collections.countries!.map((c) => c.id),
    ['GER', 'FRA'],
  );
  assert.deepEqual(r.defines, { game: { start_date: '1936-01-01', speed: 1 } });
});

test('a later mod replaces, merges, appends and removes by id', () => {
  const patch = mod(
    'patch',
    {
      'a.json': {
        countries: [
          { id: 'GER', '@merge': { name: 'German Reich' }, '@append': { cores: ['AUS'] } },
          { id: 'FRA', '@remove': true },
          { id: 'ITA', name: 'Italy' },
        ],
        defines: { game: { speed: 2 } },
      },
    },
    { dependencies: ['core'] },
  );
  // Given in the "wrong" order on purpose: dependencies decide the order.
  const r = loadMods([patch, core], parseWithLine, SCHEMAS);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(
    r.mods.map((m) => m.id),
    ['core', 'patch'],
  );
  assert.deepEqual(r.collections.countries, [
    { id: 'GER', name: 'German Reich', cores: ['GER', 'AUS'] },
    { id: 'ITA', name: 'Italy' },
  ]);
  assert.deepEqual(r.defines, { game: { start_date: '1936-01-01', speed: 2 } });
});

test('full redefinition replaces the whole record', () => {
  const replace = mod(
    'replace',
    { 'a.json': { countries: [{ id: 'GER', name: 'Prussia' }] } },
    { dependencies: ['core'] },
  );
  const r = loadMods([core, replace], parseWithLine, SCHEMAS);
  assert.deepEqual(r.collections.countries![0], { id: 'GER', name: 'Prussia' });
});

test('errors name the mod, file, line and record, and loading continues', () => {
  const broken = mod(
    'broken',
    {
      'a.json': '{ not json',
      'b.json': {
        countries: [
          { id: 'XYZ' }, // fails validation: no name
          { id: 'NOP', '@merge': { name: 'x' } }, // nothing to patch
          { id: 'ABC', '@remove': true }, // nothing to remove
          { name: 'no id' },
          { id: 'GER', '@explode': true },
        ],
        widgets: [],
      },
    },
    { dependencies: ['core'] },
  );
  const r = loadMods([core, broken], parseWithLine, SCHEMAS);
  const messages = r.errors.map(
    (e) => `${e.mod}|${e.file ?? ''}|${e.line ?? ''}|${e.record ?? ''}|${e.message}`,
  );
  assert.ok(
    messages.some((m) => m.startsWith('broken|a.json|1||Bad syntax')),
    messages.join('\n'),
  );
  assert.ok(messages.some((m) => m === 'broken|b.json|||Unknown collection "widgets"'));
  assert.ok(messages.some((m) => m.includes('countries/XYZ|name: required')));
  assert.ok(messages.some((m) => m.includes('countries/NOP|Cannot patch')));
  assert.ok(messages.some((m) => m.includes('countries/ABC|Cannot remove')));
  assert.ok(messages.some((m) => m.includes('needs a string "id"')));
  assert.ok(messages.some((m) => m.includes('Unknown directive @explode')));
  // Valid records still load.
  assert.deepEqual(
    r.collections.countries!.map((c) => c.id),
    ['GER', 'FRA'],
  );
});

test('the same id twice in one mod is an error', () => {
  const dup = mod('dup', {
    'a.json': { countries: [{ id: 'GER', name: 'A' }] },
    'b.json': { countries: [{ id: 'GER', name: 'B' }] },
  });
  const r = loadMods([dup], parseWithLine, SCHEMAS);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0]!.message, /more than once/);
});

test('missing mod.json and bad manifests are reported', () => {
  const r = loadMods(
    [
      { folder: 'empty', files: [] },
      {
        folder: 'bad',
        files: [{ path: 'mod.json', text: JSON.stringify({ id: 'Bad Id', name: '', version: 1 }) }],
      },
    ],
    parseWithLine,
    SCHEMAS,
  );
  assert.ok(r.errors.some((e) => e.mod === 'empty' && e.message === 'Missing mod.json'));
  assert.equal(r.errors.filter((e) => e.mod === 'bad').length, 3);
});

function m(id: string, dependencies: string[] = [], loadAfter: string[] = []): ModManifest {
  return { id, name: id, version: '1', dependencies, loadAfter };
}

test('load order respects dependencies and optional loadAfter, keeping input order for ties', () => {
  const { order, errors } = resolveLoadOrder([
    m('b', ['core']),
    m('a', [], ['b', 'ghost']),
    m('core'),
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    order.map((x) => x.id),
    ['core', 'b', 'a'],
  );
});

test('load order reports missing dependencies, duplicates and cycles', () => {
  const missing = resolveLoadOrder([m('a', ['nope'])]);
  assert.match(missing.errors[0]!.message, /Missing required mod "nope"/);

  const dup = resolveLoadOrder([m('a'), m('a')]);
  assert.match(dup.errors[0]!.message, /Duplicate mod id/);

  const cycle = resolveLoadOrder([m('a', ['b']), m('b', ['a']), m('c')]);
  assert.deepEqual(
    cycle.order.map((x) => x.id),
    ['c'],
  );
  assert.equal(cycle.errors.filter((e) => /cycle/.test(e.message)).length, 2);
});
