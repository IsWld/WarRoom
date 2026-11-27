/**
 * Determinism harness. If a deliberate rule change alters GOLDEN_HASH, update it on purpose
 * and say so in the commit message. An unexpected change means something broke determinism.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Command } from '../src/commands.ts';
import { hashState } from '../src/hash.ts';
import { createRng, nextInt, nextU32 } from '../src/rng.ts';
import { step, type System } from '../src/sim.ts';
import { fromSnapshot, toSnapshot } from '../src/snapshot.ts';
import { createState, type GameState } from '../src/state.ts';

const TAGS = ['GER', 'ENG', 'FRA', 'SOV', 'USA', 'ITA', 'JAP'];
const PROVINCES = 500;
const TICKS = 24 * 365; // one game year

/** A stand-in system that consumes the state's RNG, so the harness covers RNG persistence. */
const churn: System = {
  id: 'test-churn',
  everyHours: 24,
  run(state) {
    const p = nextInt(state.rng, state.provinces.count);
    const c = 1 + nextInt(state.rng, state.countryTags.length - 1);
    state.provinces.controller[p] = c;
  },
};

function newGame(seed: number): GameState {
  const owners = Array.from({ length: PROVINCES }, (_, i) => TAGS[i % TAGS.length]);
  return createState({ seed, startDay: 0, countryTags: TAGS, provinceCount: PROVINCES, owners });
}

/** Player commands generated from a separate seeded stream, as a scripted "player". */
function commandsFor(tick: number, seed: number): Command[] {
  const r = createRng(seed ^ tick);
  if (nextU32(r) % 6 !== 0) return [];
  return [
    {
      type: nextU32(r) % 2 === 0 ? 'SetController' : 'SetOwner',
      province: nextInt(r, PROVINCES),
      country: TAGS[nextInt(r, TAGS.length)]!,
    },
  ];
}

function run(seed: number, ticks: number, saveAndReloadAt?: number): string {
  let state = newGame(seed);
  for (let t = 0; t < ticks; t++) {
    if (t === saveAndReloadAt) {
      // Simulate writing a save file and loading it again.
      state = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(state))));
    }
    step(state, commandsFor(state.tick, seed), [churn]);
  }
  return hashState(state);
}

// Recorded from the first run. Changes only when the rules deliberately change.
const GOLDEN_HASH = 'c1d85b93';

test('the same seed and commands produce the same state', () => {
  assert.equal(run(1936, TICKS), run(1936, TICKS));
});

test('different seeds produce different states', () => {
  assert.notEqual(run(1936, TICKS), run(1937, TICKS));
});

test('saving and reloading mid-run changes nothing', () => {
  const uninterrupted = run(1936, TICKS);
  for (const at of [1, 1000, 4321, TICKS - 1]) {
    assert.equal(run(1936, TICKS, at), uninterrupted, `reload at tick ${at}`);
  }
});

test('golden hash is unchanged', () => {
  assert.equal(run(1936, TICKS), GOLDEN_HASH);
});
