import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divisionIndex } from '../src/divisions.ts';
import { toFixed } from '../src/fixed.ts';
import { hashState } from '../src/hash.ts';
import { findPath } from '../src/pathfinding.ts';
import { replay } from '../src/replay.ts';
import { GameSession } from '../src/session.ts';
import { fromSnapshot, toSnapshot } from '../src/snapshot.ts';
import { atWar, createState } from '../src/state.ts';
import { DEFAULT_COMBAT, divisionStats, type World } from '../src/world.ts';

const BATTALIONS = new Map(
  Object.entries({
    infantry: {
      soft_attack: 6,
      hard_attack: 1,
      defense: 22,
      breakthrough: 3,
      organization: 60,
      hp: 25,
      speed: 4,
      width: 2,
      hardness: 0,
      manpower: 1000,
    },
    artillery: {
      soft_attack: 25,
      hard_attack: 2,
      defense: 10,
      breakthrough: 6,
      organization: 0,
      hp: 6,
      speed: 4,
      width: 3,
      hardness: 0,
      manpower: 500,
    },
    light_armor: {
      soft_attack: 12,
      hard_attack: 6,
      defense: 4,
      breakthrough: 24,
      organization: 10,
      hp: 2,
      speed: 12,
      width: 2,
      hardness: 0.7,
      manpower: 500,
    },
  }),
);

/**
 * Provinces 0–5 in a row (50 km apart), plus 6 = sea next to 1 and 2, plus 7 = land reachable
 * only from 5. Province 3 is mountains (move cost 2, attack ×0.5).
 *   7 - 5 - 4 - 3 - 2 - 1 - 0      (6 = sea touching 1 and 2)
 */
function makeWorld(): World {
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 7],
    [1, 6],
    [2, 6],
  ];
  const n = 8;
  const lists: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    lists[a]!.push(b);
    lists[b]!.push(a);
  }
  lists.forEach((l) => l.sort((x, y) => x - y));
  const adjStart = new Uint32Array(n + 1);
  lists.forEach((l, i) => (adjStart[i + 1] = adjStart[i]! + l.length));
  const adjList = Uint16Array.from(lists.flat());
  const moveCost = new Int32Array(n).fill(toFixed(1));
  const attackModifier = new Int32Array(n).fill(toFixed(1));
  moveCost[3] = toFixed(2);
  attackModifier[3] = toFixed(0.5);
  return {
    provinceCount: n,
    provinceIds: Int32Array.from({ length: n }, (_, i) => i + 100),
    indexById: new Map(Array.from({ length: n }, (_, i) => [i + 100, i])),
    isLand: Uint8Array.from([1, 1, 1, 1, 1, 1, 0, 1]),
    adjStart,
    adjList,
    adjDistance: new Int32Array(adjList.length).fill(toFixed(50)),
    moveCost,
    attackModifier,
    templateIds: ['infantry_division', 'panzer_division'],
    templateNames: ['Infantry Division', 'Panzer Division'],
    templates: [
      divisionStats({ infantry: 9, artillery: 1 }, BATTALIONS),
      divisionStats({ light_armor: 4, infantry: 4, artillery: 1 }, BATTALIONS),
    ],
    combat: DEFAULT_COMBAT,
  };
}

// Countries: 1 RED (owns 0–2), 2 BLU (owns 3–5), 3 GRY (neutral, owns 7).
function newSession(world = makeWorld()) {
  const state = createState({
    seed: 9,
    startDay: 0,
    countryTags: ['RED', 'BLU', 'GRY'],
    provinceCount: 8,
    owners: ['RED', 'RED', 'RED', 'BLU', 'BLU', 'BLU', undefined, 'GRY'],
  });
  return new GameSession(state, 9, { world });
}

function spawn(
  s: GameSession,
  country: string,
  province: number,
  template = 'infantry_division',
): number {
  const r = s.execute([{ type: 'SpawnDivision', country, template, province }]);
  assert.deepEqual(r.rejected, []);
  return s.state.divisions.id[s.state.divisions.count - 1]!;
}

test('division stats derive from battalions', () => {
  const inf = divisionStats({ infantry: 9, artillery: 1 }, BATTALIONS);
  assert.equal(inf.softAttack, toFixed(79));
  assert.equal(inf.defense, toFixed(208));
  assert.equal(inf.hp, toFixed(231));
  assert.equal(inf.width, toFixed(21));
  assert.equal(inf.organization, toFixed(54)); // (9 × 60 + 0) / 10
  assert.equal(inf.speed, toFixed(4));
  assert.throws(() => divisionStats({ spaceships: 1 }, BATTALIONS));
});

test('pathfinding avoids water and impassable provinces', () => {
  const w = makeWorld();
  assert.deepEqual(
    findPath(w, 0, 5, () => true),
    [1, 2, 3, 4, 5],
  );
  assert.equal(
    findPath(w, 0, 6, () => true),
    null,
    'sea is not a land target',
  );
  assert.equal(
    findPath(w, 0, 5, (p) => p !== 3),
    null,
    'blocked province cuts the only route',
  );
});

test('divisions cannot enter neutral territory, but can after war is declared', () => {
  const s = newSession();
  const id = spawn(s, 'RED', 0);
  assert.equal(
    s.execute([{ type: 'MoveDivision', division: id, target: 4 }]).rejected[0]?.reason,
    'No route to the target',
  );
  s.execute([{ type: 'DeclareWar', country: 'RED', target: 'BLU' }]);
  assert.ok(atWar(s.state, 1, 2));
  assert.deepEqual(s.execute([{ type: 'MoveDivision', division: id, target: 4 }]).rejected, []);
  // Neutral GRY still blocks.
  assert.ok(s.execute([{ type: 'MoveDivision', division: id, target: 7 }]).rejected.length === 1);
});

test('movement takes distance / speed hours and occupies enemy provinces', () => {
  const s = newSession();
  const id = spawn(s, 'RED', 2);
  s.execute([{ type: 'DeclareWar', country: 'RED', target: 'BLU' }]);
  s.execute([{ type: 'MoveDivision', division: id, target: 4 }]);
  // 50 km into mountains at 4 km/h with move cost 2 → 25 hours.
  s.advance(24);
  assert.equal(s.state.divisions.location[0], 2);
  s.advance(1);
  assert.equal(s.state.divisions.location[0], 3);
  assert.equal(s.state.countryTags[s.state.provinces.controller[3]!], 'RED', 'province occupied');
  assert.equal(s.state.countryTags[s.state.provinces.owner[3]!], 'BLU', 'ownership unchanged');
  s.advance(13); // 50 km plains at 4 km/h = 12.5 h
  assert.equal(s.state.divisions.location[0], 4);
  assert.equal(s.state.divisions.paths[0]!.length, 0);
});

function battle(
  attackers: number,
  defenders: number,
  defenderProvince: number,
  attackerTemplate = 'infantry_division',
) {
  const s = newSession();
  const ids: number[] = [];
  const from = defenderProvince - 1;
  for (let k = 0; k < attackers; k++) ids.push(spawn(s, 'RED', from, attackerTemplate));
  for (let k = 0; k < defenders; k++) spawn(s, 'BLU', defenderProvince);
  s.execute([{ type: 'DeclareWar', country: 'RED', target: 'BLU' }]);
  s.execute(
    ids.map((division) => ({ type: 'MoveDivision' as const, division, target: defenderProvince })),
  );
  let hours = 0;
  while (hours < 24 * 20) {
    s.advance(1);
    hours++;
    const d = s.state.divisions;
    const attacking = ids.some((id) => {
      const i = divisionIndex(d, id);
      return i >= 0 && d.paths[i]!.length > 0;
    });
    if (!attacking) break;
  }
  const d = s.state.divisions;
  const redHolds = s.state.provinces.controller[defenderProvince] === 1;
  return { s, hours, redHolds, remaining: d.count };
}

test('equal infantry fails to break a defender', () => {
  const r = battle(1, 1, 4);
  assert.equal(r.redHolds, false);
});

test('a 3:1 infantry attack wins on plains and the defender retreats', () => {
  const r = battle(3, 1, 4);
  assert.equal(r.redHolds, true, `after ${r.hours} hours`);
  const d = r.s.state.divisions;
  const blue = Array.from({ length: d.count }, (_, i) => i).filter((i) => d.owner[i] === 2);
  assert.equal(blue.length, 1, 'defender survived by retreating');
  assert.equal(d.location[blue[0]!], 5, 'retreated to the next own province');
});

test('mountains make the same attack far slower', () => {
  const plains = battle(2, 1, 4);
  const mountains = battle(2, 1, 3);
  assert.equal(plains.redHolds, true);
  assert.ok(
    !mountains.redHolds || mountains.hours >= 1.8 * plains.hours,
    `plains ${plains.hours} h, mountains ${mountains.hours} h`,
  );
});

test('an encircled defender is destroyed', () => {
  // BLU division in province 7 (GRY land, at war with nobody) cannot retreat: put BLU in 5,
  // owned by BLU, attacked from 4 with 7 neutral → no retreat path.
  const s = newSession();
  const a = [spawn(s, 'RED', 4), spawn(s, 'RED', 4), spawn(s, 'RED', 4)];
  spawn(s, 'BLU', 5);
  s.execute([{ type: 'DeclareWar', country: 'RED', target: 'BLU' }]);
  s.execute([{ type: 'SetController', province: 4, country: 'RED' }]);
  s.execute(a.map((division) => ({ type: 'MoveDivision' as const, division, target: 5 })));
  s.advance(24 * 10);
  const d = s.state.divisions;
  assert.equal(Array.from(d.owner.subarray(0, d.count)).filter((o) => o === 2).length, 0);
  assert.equal(s.state.provinces.controller[5], 1);
});

test('white peace returns occupied provinces', () => {
  const s = newSession();
  s.execute([{ type: 'DeclareWar', country: 'RED', target: 'BLU' }]);
  s.execute([{ type: 'SetController', province: 3, country: 'RED' }]);
  s.execute([{ type: 'WhitePeace', country: 'RED', target: 'BLU' }]);
  assert.equal(s.state.provinces.controller[3], 2);
  assert.equal(atWar(s.state, 1, 2), false);
});

test('warfare is deterministic, survives save/load, and replays exactly', () => {
  const run = (reloadAt: number | null) => {
    let s = newSession();
    const ids = [spawn(s, 'RED', 1), spawn(s, 'RED', 1), spawn(s, 'RED', 2, 'panzer_division')];
    spawn(s, 'BLU', 4);
    spawn(s, 'BLU', 5);
    s.execute([{ type: 'DeclareWar', country: 'RED', target: 'BLU' }]);
    s.execute(ids.map((division) => ({ type: 'MoveDivision' as const, division, target: 5 })));
    for (let h = 0; h < 24 * 15; h++) {
      if (h === reloadAt) {
        const state = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(s.state))));
        s = new GameSession(state, s.seed, { log: s.log, world: s.world });
      }
      s.advance(1);
    }
    return s;
  };
  const a = run(null);
  assert.equal(hashState(a.state), hashState(run(null).state));
  assert.equal(hashState(a.state), hashState(run(100).state));
  // Replay from scratch.
  const fresh = newSession();
  const rejected = replay(fresh.state, a.log, a.state.tick, undefined, fresh.world);
  assert.equal(rejected, 0);
  assert.equal(hashState(fresh.state), hashState(a.state));
});
