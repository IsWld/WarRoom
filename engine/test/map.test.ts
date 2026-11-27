import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/content/csv.ts';
import { checkReferences } from '../src/content/references.ts';
import type { ProvinceDef, StateDef, TerrainDef } from '../src/content/schemas.ts';
import { CORE_SCHEMAS } from '../src/content/schemas.ts';
import type { LoadedContent } from '../src/content/types.ts';
import { buildMapModel, countRegions, neighbors, provinceAt } from '../src/map/model.ts';
import { makeProjection } from '../src/map/projection.ts';

test('parseCsv handles quotes, CRLF, comments and blank lines', () => {
  const rows = parseCsv('id,name\r\n# comment\n1,"Bavaria, south"\n\n2,"say ""hi"""\n');
  assert.deepEqual(rows, [
    { id: '1', name: 'Bavaria, south' },
    { id: '2', name: 'say "hi"' },
  ]);
});

test('parseCsv reports the line of a bad row', () => {
  assert.throws(
    () => parseCsv('a,b\n1,2\n3\n'),
    (e: Error & { line?: number }) => e.line === 3,
  );
  assert.throws(() => parseCsv('a,b\n"unclosed,2\n'), /Unclosed quote/);
});

const terrain: TerrainDef[] = [
  {
    id: 'plains',
    name: 'Plains',
    color: [1, 1, 1],
    movement_cost: 1,
    attack_modifier: 1,
    water: false,
  },
  {
    id: 'ocean',
    name: 'Ocean',
    color: [0, 0, 9],
    movement_cost: 1,
    attack_modifier: 1,
    water: true,
  },
];

/**
 * A 6×4 test map:
 *   A A B B S S
 *   A A B B S S
 *   C C C B S S
 *   C C C S S S
 */
const LAYOUT = ['AABBSS', 'AABBSS', 'CCCBSS', 'CCCSSS'];
const COLORS: Record<string, [number, number, number]> = {
  A: [255, 0, 0],
  B: [0, 255, 0],
  C: [0, 0, 254],
  S: [10, 20, 30],
};
const provinces: ProvinceDef[] = [
  { id: '30', color: COLORS.S!, kind: 'sea', terrain: 'ocean', state: undefined },
  { id: '10', color: COLORS.A!, kind: 'land', terrain: 'plains', state: 'north' },
  { id: '20', color: COLORS.B!, kind: 'land', terrain: 'plains', state: 'north' },
  { id: '25', color: COLORS.C!, kind: 'land', terrain: 'plains', state: 'south' },
];
const states: StateDef[] = [
  { id: 'north', name: 'North', provinces: [10, 20] },
  { id: 'south', name: 'South', provinces: [25] },
];

function pixelsFor(layout: string[]): Uint8Array {
  const w = layout[0]!.length;
  const px = new Uint8Array(w * layout.length * 4);
  layout.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const [r, g, b] = COLORS[ch]!;
      px.set([r, g, b, 255], (y * w + x) * 4);
    }),
  );
  return px;
}

test('buildMapModel assigns dense indices in id order and computes adjacency', () => {
  const { model, problems } = buildMapModel({
    width: 6,
    height: 4,
    pixels: pixelsFor(LAYOUT),
    provinces,
    states,
    terrain,
  });
  assert.deepEqual(problems, []);
  assert.ok(model);
  assert.deepEqual(Array.from(model.provinceIds), [10, 20, 25, 30]);
  const A = 0,
    B = 1,
    C = 2,
    S = 3;
  assert.deepEqual(Array.from(neighbors(model, A)), [B, C]);
  assert.deepEqual(Array.from(neighbors(model, B)), [A, C, S]);
  assert.deepEqual(Array.from(neighbors(model, S)), [B, C]);
  // A–B share 2 vertical edges; A–C share 2 horizontal edges.
  const ab = model.adjBorder[model.adjStart[A]!]!;
  assert.equal(ab, 2);
  assert.equal(model.pixelCount[A], 4);
  assert.equal(model.centroidX[A], 1);
  assert.equal(model.centroidY[A], 1);
  assert.equal(provinceAt(model, 4.5, 0.5), S);
  assert.equal(provinceAt(model, -1, 0), -1);
  assert.deepEqual(Array.from(model.state), [0, 0, 1, -1]);
  assert.deepEqual(Array.from(model.stateProvinceList), [A, B, C]);
  assert.deepEqual(Array.from(countRegions(model)), [1, 1, 1, 1]);
});

test('buildMapModel reports unknown and missing colors', () => {
  const bad = pixelsFor(LAYOUT);
  bad.set([1, 2, 3, 255], 0); // unknown color in the corner
  const withMissing = [
    ...provinces,
    {
      id: '99',
      color: [9, 9, 9] as [number, number, number],
      kind: 'sea' as const,
      terrain: 'ocean',
      state: undefined,
    },
  ];
  const { model, problems } = buildMapModel({
    width: 6,
    height: 4,
    pixels: bad,
    provinces: withMissing,
    states,
    terrain,
  });
  assert.equal(model, null);
  assert.ok(problems.some((p) => /#010203/.test(p.message)));
  assert.ok(problems.some((p) => p.province === 99));
});

test('countRegions detects a split province', () => {
  const layout = ['ABA', 'BBB'];
  const { model } = buildMapModel({
    width: 3,
    height: 2,
    pixels: pixelsFor(layout),
    provinces: provinces.filter((p) => p.id === '10' || p.id === '20'),
    states: [{ id: 'north', name: 'N', provinces: [10, 20] }],
    terrain,
  });
  assert.ok(model);
  assert.deepEqual(Array.from(countRegions(model)), [2, 1]);
});

function content(collections: Record<string, unknown[]>): LoadedContent {
  return {
    mods: [],
    collections: collections as LoadedContent['collections'],
    defines: {},
    errors: [],
  };
}

test('checkReferences finds broken links between collections', () => {
  const errors = checkReferences(
    content({
      countries: [{ id: 'GER', name: 'Germany', color: [1, 1, 1] }],
      terrain,
      provinces: [
        { id: '1', color: [1, 0, 0], kind: 'land', terrain: 'plains', state: 'a' },
        { id: '2', color: [1, 0, 0], kind: 'land', terrain: 'swamp', state: 'nowhere' },
        { id: '3', color: [3, 0, 0], kind: 'sea', terrain: 'plains', state: 'a' },
        { id: '4', color: [4, 0, 0], kind: 'land', terrain: 'plains', state: 'a' },
      ],
      states: [{ id: 'a', name: 'A', provinces: [1, 3, 7] }],
      setups: [
        {
          id: '1936',
          name: 'x',
          start_date: '1936-01-01',
          states: { a: { owner: 'XXX', cores: [] }, ghost: { owner: 'GER', cores: [] } },
        },
      ],
    }),
  ).map((e) => `${e.record}: ${e.message}`);
  const expect = [
    'provinces/2: Color is already used by province 1',
    'provinces/2: Unknown terrain "swamp"',
    'provinces/2: Unknown state "nowhere"',
    'provinces/3: Terrain "plains" does not fit a sea province',
    'provinces/3: A sea province cannot belong to a state',
    'states/a: Province 3 is sea, not land',
    'states/a: Province 7 does not exist',
    'provinces/4: No state lists this province',
    'setups/1936: a: unknown country "XXX"',
    'setups/1936: Unknown state "ghost"',
  ];
  for (const e of expect)
    assert.ok(errors.includes(e), `missing: ${e}\n got:\n${errors.join('\n')}`);
});

test('province schema converts CSV strings', () => {
  const r = CORE_SCHEMAS.collections.provinces!({
    id: '12',
    color: '#0a0B0c',
    kind: 'land',
    terrain: 'plains',
    state: 'bavaria',
  });
  assert.ok(r.ok);
  if (r.ok)
    assert.deepEqual(r.value, {
      id: '12',
      color: [10, 11, 12],
      kind: 'land',
      terrain: 'plains',
      state: 'bavaria',
    });
  const sea = CORE_SCHEMAS.collections.provinces!({
    id: '13',
    color: '#000000',
    kind: 'sea',
    terrain: 'ocean',
    state: '',
  });
  assert.ok(sea.ok && (sea.value as { state?: string }).state === undefined);
  assert.equal(
    CORE_SCHEMAS.collections.provinces!({ id: '0', color: 'red', kind: 'hill', terrain: 'x' }).ok,
    false,
  );
});

test('projection round-trips', () => {
  const p = makeProjection({
    width: 3072,
    height: 3160,
    standard_parallel: 50,
    lon_min: -12,
    lon_max: 50,
    lat_max: 71,
  });
  const [x, y] = p.toPixel(13.4, 52.5); // Berlin
  const [lon, lat] = p.toLonLat(x, y);
  assert.ok(Math.abs(lon - 13.4) < 1e-9 && Math.abs(lat - 52.5) < 1e-9);
  assert.ok(x > 0 && x < 3072 && y > 0 && y < 3160);
  assert.ok(Math.abs(p.toPixel(50, 71)[0] - 3072) < 1e-6);
});
