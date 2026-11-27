import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_SCHEMAS } from '../src/content/schemas.ts';
import { parseYaml } from '../src/content/yaml.ts';

const validateCountry = CORE_SCHEMAS.collections.countries!;

test('a valid country passes', () => {
  const r = validateCountry({ id: 'GER', name: 'Germany', color: [1, 2, 3] });
  assert.equal(r.ok, true);
});

test('country errors point at the bad field', () => {
  const r = validateCountry({ id: 'germany', name: '', color: [1, 2, 300], colour: 'typo' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  const paths = r.issues.map((i) => i.path);
  assert.ok(paths.includes('id'));
  assert.ok(paths.includes('name'));
  assert.ok(paths.includes('color.2'));
  assert.ok(
    r.issues.some((i) => /colour/.test(i.message)),
    'unknown keys are reported',
  );
});

test('defines require a real start date', () => {
  assert.equal(
    CORE_SCHEMAS.defines({ game: { start_date: '1936-01-01', default_seed: 1 } }).ok,
    true,
  );
  assert.equal(
    CORE_SCHEMAS.defines({ game: { start_date: '1937-02-29', default_seed: 1 } }).ok,
    false,
  );
});

test('YAML syntax errors carry a line number', () => {
  try {
    parseYaml('countries:\n  - id: GER\n   name: bad indent\n');
    assert.fail('expected a syntax error');
  } catch (error) {
    assert.equal(typeof (error as { line?: unknown }).line, 'number');
  }
});
