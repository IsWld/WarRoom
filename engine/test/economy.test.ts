import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canBuild, ECONOMY_SYSTEMS, industry } from '../src/economy.ts';
import { toFixed } from '../src/fixed.ts';
import { hashState } from '../src/hash.ts';
import { GameSession } from '../src/session.ts';
import { fromSnapshot, toSnapshot } from '../src/snapshot.ts';
import { createState } from '../src/state.ts';
import {
  DEFAULT_COMBAT,
  DEFAULT_ECONOMY,
  divisionStats,
  EMPTY_WORLD,
  type World,
} from '../src/world.ts';

/**
 * Two states: "home" (provinces 0,1) and "far" (province 2). Resources: steel (0), rubber (1).
 * Buildings: civilian_factory (0), military_factory (1), infrastructure (2).
 * Equipment: rifles (0: cost 0.5, 2 steel per factory), trucks (1: cost 2.5, 1 rubber).
 */
function makeWorld(): World {
  const battalions = new Map([
    [
      'infantry',
      {
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
    ],
  ]);
  return {
    ...EMPTY_WORLD,
    provinceCount: 3,
    provinceIds: Int32Array.from([1, 2, 3]),
    indexById: new Map([
      [1, 0],
      [2, 1],
      [3, 2],
    ]),
    isLand: Uint8Array.from([1, 1, 1]),
    adjStart: Uint32Array.from([0, 1, 3, 4]),
    adjList: Uint16Array.from([1, 0, 2, 1]),
    adjDistance: new Int32Array(4).fill(toFixed(50)),
    moveCost: new Int32Array(3).fill(toFixed(1)),
    attackModifier: new Int32Array(3).fill(toFixed(1)),
    templateIds: ['infantry_division'],
    templateNames: ['Infantry Division'],
    templates: [divisionStats({ infantry: 2 }, battalions)],
    templateEquipment: Int32Array.from([200, 0]), // 2 battalions × 100 rifles
    combat: DEFAULT_COMBAT,
    stateCount: 2,
    stateIds: ['home', 'far'],
    provinceState: Int32Array.from([0, 0, 1]),
    stateProvinceStart: Uint32Array.from([0, 2, 3]),
    stateProvinceList: Uint16Array.from([0, 1, 2]),
    stateSlots: Uint8Array.from([4, 2]),
    stateManpower: Int32Array.from([3_650_000, 0]),
    resourceIds: ['steel', 'rubber'],
    stateResources: Int32Array.from([toFixed(10), 0, 0, 0]),
    buildingIds: ['civilian_factory', 'military_factory', 'infrastructure'],
    buildingCost: Int32Array.from([toFixed(100), toFixed(100), toFixed(30)]),
    buildingMax: Uint8Array.from([20, 20, 10]),
    buildingShared: Uint8Array.from([1, 1, 0]),
    civilianFactory: 0,
    militaryFactory: 1,
    infrastructure: 2,
    equipmentIds: ['rifles', 'trucks'],
    equipmentCost: Int32Array.from([toFixed(0.5), toFixed(2.5)]),
    equipmentResources: Int32Array.from([toFixed(2), 0, 0, toFixed(1)]),
    economy: { ...DEFAULT_ECONOMY, consumerGoods: 0, efficiencyStart: toFixed(1) },
  };
}

function newSession(civ = 2, mil = 2) {
  const world = makeWorld();
  const state = createState({
    seed: 1,
    startDay: 0,
    countryTags: ['RED', 'BLU'],
    provinceCount: 3,
    owners: ['RED', 'RED', 'BLU'],
    stateCount: 2,
    buildingCount: 3,
  });
  state.buildings[0] = civ; // home civilian factories
  state.buildings[1] = mil; // home military factories
  return new GameSession(state, 1, { world, systems: ECONOMY_SYSTEMS });
}

const RED = 1;

test('industry counts factories, resources and trade', () => {
  const s = newSession(4, 2);
  s.execute([
    { type: 'SetProductionLine', country: 'RED', line: -1, equipment: 'trucks', factories: 2 },
  ]);
  const ind = industry(s.state, s.world, RED);
  assert.equal(ind.civilian, 4);
  assert.equal(ind.military, 2);
  assert.equal(ind.resources[0], toFixed(10));
  // Trucks need 2 rubber/day; one civilian factory imports 8.
  assert.equal(ind.trade, 1);
  assert.equal(ind.construction, 3);
  assert.equal(ind.resourceShare[1], toFixed(1));
});

test('construction completes and respects building slots', () => {
  const s = newSession(2, 1);
  assert.equal(canBuild(s.state, s.world, RED, 0, 0), null);
  s.execute([
    { type: 'QueueConstruction', country: 'RED', state: 0, building: 'civilian_factory' },
  ]);
  // 4 slots: 2 civ + 1 mil + 1 queued = full.
  assert.equal(canBuild(s.state, s.world, RED, 0, 1), 'No free building slots');
  assert.equal(canBuild(s.state, s.world, RED, 1, 0), 'You must own and control the whole state');
  // 2 civs × 5 points = 10/day → 100 points takes 10 days.
  s.advance(24 * 9);
  assert.equal(s.state.buildings[0], 2);
  s.advance(24);
  assert.equal(s.state.buildings[0], 3);
  assert.equal(s.state.economy[RED]!.construction.length, 0);
});

test('production fills the stockpile and resource shortages slow it', () => {
  const s = newSession(0, 2);
  s.execute([
    { type: 'SetProductionLine', country: 'RED', line: -1, equipment: 'rifles', factories: 2 },
  ]);
  s.advance(24 * 10);
  // 2 factories × 4.5 points = 9 points/day = 18 rifles/day; 10 days (first run at tick 0).
  assert.equal(s.state.economy[RED]!.stockpile[0], 180);
  // Trucks need rubber; with no civilian factories to trade there is none, so no output.
  const t = newSession(0, 2);
  t.execute([
    { type: 'SetProductionLine', country: 'RED', line: -1, equipment: 'trucks', factories: 2 },
  ]);
  t.advance(24 * 10);
  assert.equal(t.state.economy[RED]!.stockpile[1] ?? 0, 0);
});

test('only existing military factories produce', () => {
  const s = newSession(0, 1);
  s.execute([
    { type: 'SetProductionLine', country: 'RED', line: -1, equipment: 'rifles', factories: 10 },
  ]);
  s.advance(24 * 10);
  assert.equal(s.state.economy[RED]!.stockpile[0], 90);
});

test('manpower grows from controlled states', () => {
  const s = newSession(0, 0);
  s.advance(24 * 10);
  // 3,650,000 × 2.5% / 365 = 250 per day.
  assert.equal(s.state.economy[RED]!.manpower, 2500);
});

test('training waits for equipment and men, then deploys after the training time', () => {
  const s = newSession(0, 0);
  s.execute([
    { type: 'TrainDivision', country: 'RED', template: 'infantry_division', province: 0 },
  ]);
  s.advance(24 * 3);
  assert.equal(s.state.economy[RED]!.training[0]!.daysLeft, -1, 'waiting');
  const eco = s.state.economy[RED]!;
  eco.stockpile[0] = 500;
  eco.manpower = 5000;
  s.advance(24);
  assert.equal(eco.stockpile[0], 300);
  assert.equal(eco.manpower, 5000 - 2000 + 250);
  s.advance(24 * 90);
  assert.equal(s.state.divisions.count, 1);
  assert.equal(s.state.economy[RED]!.training.length, 0);
});

test('damaged divisions reinforce using men and equipment', () => {
  const s = newSession(0, 0);
  s.execute([
    { type: 'SpawnDivision', country: 'RED', template: 'infantry_division', province: 0 },
  ]);
  const hp = s.world.templates[0]!.hp;
  s.state.divisions.strength[0] = hp / 2;
  const eco = s.state.economy[RED]!;
  eco.manpower = 100_000;
  eco.stockpile[0] = 1000;
  s.advance(24 * 30);
  assert.ok(s.state.divisions.strength[0]! > hp * 0.9);
  assert.ok(eco.stockpile[0]! < 1000);
  // With no equipment, no reinforcement.
  const t = newSession(0, 0);
  t.execute([
    { type: 'SpawnDivision', country: 'RED', template: 'infantry_division', province: 0 },
  ]);
  t.state.divisions.strength[0] = hp / 2;
  t.state.economy[RED]!.manpower = 100_000;
  t.advance(24 * 30);
  assert.equal(t.state.divisions.strength[0], hp / 2);
});

test('too many divisions in a state suffer supply attrition', () => {
  const s = newSession(0, 0);
  for (let k = 0; k < 6; k++)
    s.execute([
      { type: 'SpawnDivision', country: 'RED', template: 'infantry_division', province: 0 },
    ]);
  const hp = s.world.templates[0]!.hp;
  s.advance(24 * 5);
  assert.ok(s.state.divisions.strength[0]! < hp, 'over capacity (2) → attrition');
  s.state.buildings[2] = 10; // infrastructure 10 → capacity 12
  const before = s.state.divisions.strength[0]!;
  s.advance(24 * 5);
  assert.ok(s.state.divisions.strength[0]! >= before);
});

test('economy state survives save and load', () => {
  const s = newSession(3, 2);
  s.execute([
    { type: 'SetProductionLine', country: 'RED', line: -1, equipment: 'rifles', factories: 2 },
    { type: 'QueueConstruction', country: 'RED', state: 0, building: 'infrastructure' },
    { type: 'TrainDivision', country: 'RED', template: 'infantry_division', province: 0 },
  ]);
  s.advance(24 * 7 + 5);
  const copy = fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(s.state))));
  assert.equal(hashState(copy), hashState(s.state));
  const t = new GameSession(copy, 1, { world: s.world, systems: ECONOMY_SYSTEMS });
  s.advance(24 * 30);
  t.advance(24 * 30);
  assert.equal(hashState(t.state), hashState(s.state));
});
