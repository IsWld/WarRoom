import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConsoleLine, type ConsoleContext } from '../src/console.ts';
import type { LoadedContent } from '../src/content/types.ts';
import { hashState } from '../src/hash.ts';
import { replay } from '../src/replay.ts';
import { hashJson, parseSave, serializeSave } from '../src/save.ts';
import { createGameFromContent } from '../src/scenario.ts';
import { GameSession } from '../src/session.ts';
import { createRng, nextInt } from '../src/rng.ts';

const content = {
  mods: [],
  defines: {},
  errors: [],
  collections: {
    countries: [
      { id: 'GER', name: 'Germany', color: [1, 1, 1] },
      { id: 'POL', name: 'Poland', color: [2, 2, 2] },
      { id: 'DNZ', name: 'Danzig', color: [3, 3, 3] },
    ],
    setups: [
      {
        id: '1936',
        name: 'Road to War',
        start_date: '1936-01-01',
        states: {
          prussia: { owner: 'GER', cores: ['GER'] },
          danzig: { owner: 'DNZ', cores: ['DNZ'] },
          warsaw: { owner: 'POL', controller: 'GER', cores: ['POL'] },
        },
      },
    ],
  },
} as unknown as LoadedContent;

// Provinces: 0,1 prussia; 2 danzig; 3 warsaw; 4 sea.
const map = {
  provinceCount: 5,
  state: Int32Array.from([0, 0, 1, 2, -1]),
  stateIds: ['prussia', 'danzig', 'warsaw'],
};

function newGame() {
  return createGameFromContent(content, map, { setupId: '1936', seed: 42 });
}

test('createGameFromContent applies setup owners and controllers', () => {
  const s = newGame();
  const tag = (i: number) => s.countryTags[i];
  assert.deepEqual(Array.from(s.provinces.owner, tag), ['GER', 'GER', 'DNZ', 'POL', '---']);
  assert.deepEqual(Array.from(s.provinces.controller, tag), ['GER', 'GER', 'DNZ', 'GER', '---']);
  assert.equal(s.startDay, -12419); // 1936-01-01 is 12,419 days before 1970-01-01
  assert.throws(() => createGameFromContent(content, map, { setupId: 'nope', seed: 1 }));
});

test('Annex transfers ownership and control', () => {
  const session = new GameSession(newGame(), 42);
  const r = session.execute([{ type: 'Annex', country: 'GER', target: 'DNZ' }]);
  assert.deepEqual(r.rejected, []);
  assert.equal(r.provincesChanged, true);
  assert.equal(session.state.countryTags[session.state.provinces.owner[2]!], 'GER');
  const bad = session.execute([{ type: 'Annex', country: 'GER', target: 'GER' }]);
  assert.equal(bad.rejected.length, 1);
  assert.equal(bad.provincesChanged, false);
});

test('replaying the command log from the start reproduces the game exactly', () => {
  const session = new GameSession(newGame(), 42);
  const r = createRng(7);
  const tags = ['GER', 'POL', 'DNZ'];
  for (let day = 0; day < 200; day++) {
    if (nextInt(r, 3) === 0) {
      session.execute([
        { type: 'SetController', province: nextInt(r, 4), country: tags[nextInt(r, 3)]! },
      ]);
    }
    session.advance(1 + nextInt(r, 30));
  }
  const fresh = newGame();
  const rejected = replay(fresh, session.log, session.state.tick);
  assert.equal(rejected, 0);
  assert.equal(hashState(fresh), hashState(session.state));
});

test('saves round-trip and reject foreign files', () => {
  const session = new GameSession(newGame(), 42);
  session.execute([{ type: 'Annex', country: 'POL', target: 'DNZ' }]);
  session.advance(100);
  const meta = {
    name: 'test',
    setupId: '1936',
    playerTag: 'POL',
    mods: ['core@0.0.1'],
    contentHash: 'abc',
    savedAt: '2026-01-01T00:00:00Z',
  };
  const text = serializeSave(session.save(meta));
  const loaded = parseSave(text, 'abc');
  assert.deepEqual(loaded.warnings, []);
  assert.equal(hashState(loaded.state), hashState(session.state));
  assert.equal(parseSave(text, 'different').warnings.length, 1);
  assert.throws(() => parseSave('{"format":"other"}'), /not a WarRoom save/);
  assert.throws(() => parseSave('nonsense'), /not a WarRoom save/);
  // Replay verification from the save's seed and log.
  const rebuilt = newGame();
  replay(rebuilt, loaded.save.log, loaded.state.tick);
  assert.equal(hashState(rebuilt), hashState(loaded.state));
});

test('hashJson is stable and sensitive', () => {
  assert.equal(hashJson({ a: 1 }), hashJson({ a: 1 }));
  assert.notEqual(hashJson({ a: 1 }), hashJson({ a: 2 }));
});

test('console parses commands', () => {
  const ctx: ConsoleContext = {
    playerTag: 'GER',
    isCountry: (t) => ['GER', 'POL', 'DNZ'].includes(t),
    provinceIndex: (id) => (id === 101 ? 3 : undefined),
  };
  assert.deepEqual(parseConsoleLine('annex dnz', ctx), {
    kind: 'commands',
    commands: [{ type: 'Annex', country: 'GER', target: 'DNZ' }],
    message: 'GER annexes DNZ',
  });
  const own = parseConsoleLine('owner 101 pol', ctx);
  assert.equal(own.kind, 'commands');
  if (own.kind === 'commands')
    assert.deepEqual(own.commands, [{ type: 'SetOwner', province: 3, country: 'POL' }]);
  assert.equal(parseConsoleLine('tag pol', ctx).kind, 'tag');
  assert.deepEqual(parseConsoleLine('speed 0', ctx), {
    kind: 'speed',
    speed: 0,
    message: 'Paused',
  });
  assert.equal(parseConsoleLine('speed 9', ctx).kind, 'error');
  assert.equal(parseConsoleLine('owner 5 GER', ctx).kind, 'error');
  assert.equal(parseConsoleLine('annex XXX', ctx).kind, 'error');
  assert.equal(parseConsoleLine('dance', ctx).kind, 'error');
  assert.equal(parseConsoleLine('help', ctx).kind, 'help');
});
