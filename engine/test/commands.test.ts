import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, countryIndex } from '../src/state.ts';
import { step } from '../src/sim.ts';

function smallState() {
  return createState({
    seed: 1,
    startDay: 0,
    countryTags: ['GER', 'POL'],
    provinceCount: 3,
    owners: ['GER', 'POL', undefined],
  });
}

test('createState assigns owners and controllers', () => {
  const s = smallState();
  assert.deepEqual(Array.from(s.provinces.owner), [1, 2, 0]);
  assert.deepEqual(Array.from(s.provinces.controller), [1, 2, 0]);
  assert.equal(countryIndex(s, 'POL'), 2);
});

test('createState rejects duplicate and unknown tags', () => {
  assert.throws(() =>
    createState({ seed: 1, startDay: 0, countryTags: ['GER', 'GER'], provinceCount: 0 }),
  );
  assert.throws(() =>
    createState({ seed: 1, startDay: 0, countryTags: ['GER'], provinceCount: 1, owners: ['XXX'] }),
  );
});

test('SetController changes control but not ownership', () => {
  const s = smallState();
  const { rejected } = step(s, [{ type: 'SetController', province: 1, country: 'GER' }]);
  assert.deepEqual(rejected, []);
  assert.equal(s.provinces.controller[1], 1);
  assert.equal(s.provinces.owner[1], 2);
  assert.equal(s.tick, 1);
});

test('SetOwner changes owner and controller', () => {
  const s = smallState();
  step(s, [{ type: 'SetOwner', province: 2, country: 'POL' }]);
  assert.equal(s.provinces.owner[2], 2);
  assert.equal(s.provinces.controller[2], 2);
});

test('invalid commands are rejected and change nothing', () => {
  const s = smallState();
  const before = Array.from(s.provinces.controller);
  const { rejected } = step(s, [
    { type: 'SetController', province: 99, country: 'GER' },
    { type: 'SetController', province: 0, country: 'XXX' },
    { type: 'SetOwner', province: 0, country: '---' },
  ]);
  assert.equal(rejected.length, 3);
  assert.deepEqual(Array.from(s.provinces.controller), before);
  assert.equal(s.tick, 1, 'the tick still advances');
});

test('systems run on their schedule', () => {
  const s = smallState();
  const runs: number[] = [];
  const daily = { id: 'daily', everyHours: 24, run: (st: typeof s) => runs.push(st.tick) };
  for (let i = 0; i < 49; i++) step(s, [], [daily]);
  assert.deepEqual(runs, [0, 24, 48]);
});
