/**
 * The World is the immutable data a game runs on: the map graph, terrain effects, unit
 * templates and balance constants. It is built once from content and never saved (it is
 * rebuilt from the same content on load). All values that affect simulation are integers or
 * fixed-point.
 */
import type { BattalionDef, MapDefines, TemplateDef, TerrainDef } from './content/schemas.ts';
import type { LoadedContent } from './content/types.ts';
import { toFixed, type Fixed } from './fixed.ts';
import { KIND_LAND, type MapModel } from './map/model.ts';
import { makeProjection } from './map/projection.ts';

export interface DivisionStats {
  softAttack: Fixed;
  hardAttack: Fixed;
  defense: Fixed;
  breakthrough: Fixed;
  organization: Fixed;
  hp: Fixed;
  /** km per hour on plains. */
  speed: Fixed;
  width: Fixed;
  /** 0–1 as fixed-point. */
  hardness: Fixed;
  manpower: number;
}

export interface CombatDefines {
  width: Fixed;
  blockedHitChance: Fixed;
  unblockedHitChance: Fixed;
  strengthDamagePerHit: Fixed;
  organizationDamagePerHit: Fixed;
  randomSpread: Fixed;
  organizationRecovery: Fixed;
}

export interface World {
  provinceCount: number;
  provinceIds: Int32Array;
  indexById: Map<number, number>;
  isLand: Uint8Array;
  adjStart: Uint32Array;
  adjList: Uint16Array;
  /** Distance to each neighbor in fixed-point km (parallel to adjList). */
  adjDistance: Int32Array;
  /** Per province: terrain movement cost and attacker modifier (fixed-point). */
  moveCost: Int32Array;
  attackModifier: Int32Array;
  templateIds: string[];
  templates: DivisionStats[];
  templateNames: string[];
  combat: CombatDefines;
}

export const DEFAULT_COMBAT: CombatDefines = {
  width: toFixed(80),
  blockedHitChance: toFixed(0.1),
  unblockedHitChance: toFixed(0.4),
  strengthDamagePerHit: toFixed(0.04),
  organizationDamagePerHit: toFixed(0.1),
  randomSpread: toFixed(0.1),
  organizationRecovery: toFixed(0.4),
};

/** A world with no provinces or templates, for engine tests that do not need warfare. */
export const EMPTY_WORLD: World = {
  provinceCount: 0,
  provinceIds: new Int32Array(0),
  indexById: new Map(),
  isLand: new Uint8Array(0),
  adjStart: new Uint32Array(1),
  adjList: new Uint16Array(0),
  adjDistance: new Int32Array(0),
  moveCost: new Int32Array(0),
  attackModifier: new Int32Array(0),
  templateIds: [],
  templates: [],
  templateNames: [],
  combat: DEFAULT_COMBAT,
};

/** Derives division stats from its battalions (see docs/design/land-warfare.md). */
export function divisionStats(
  battalions: Record<string, number>,
  types: ReadonlyMap<string, Pick<BattalionDef, Exclude<keyof BattalionDef, 'id' | 'name'>>>,
): DivisionStats {
  let count = 0;
  let soft = 0;
  let hard = 0;
  let def = 0;
  let bt = 0;
  let org = 0;
  let hp = 0;
  let width = 0;
  let hardness = 0;
  let manpower = 0;
  let speed = Infinity;
  for (const [typeId, n] of Object.entries(battalions).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const t = types.get(typeId);
    if (!t) throw new Error(`Unknown battalion type "${typeId}"`);
    count += n;
    soft += t.soft_attack * n;
    hard += t.hard_attack * n;
    def += t.defense * n;
    bt += t.breakthrough * n;
    org += t.organization * n;
    hp += t.hp * n;
    width += t.width * n;
    hardness += t.hardness * n;
    manpower += t.manpower * n;
    speed = Math.min(speed, t.speed);
  }
  if (count === 0) throw new Error('A division template needs at least one battalion');
  return {
    softAttack: toFixed(soft),
    hardAttack: toFixed(hard),
    defense: toFixed(def),
    breakthrough: toFixed(bt),
    organization: toFixed(org / count),
    hp: toFixed(hp),
    speed: toFixed(speed),
    width: toFixed(width),
    hardness: toFixed(hardness / count),
    manpower,
  };
}

/** Great-circle distance in km, rounded to whole km so results are identical everywhere. */
export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return Math.max(1, Math.round(6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)))));
}

export function buildWorld(content: LoadedContent, map: MapModel): World {
  const defines = content.defines as { map?: MapDefines; combat?: Record<string, number> };
  const terrain = (content.collections.terrain ?? []) as TerrainDef[];
  const battalions = (content.collections.battalions ?? []) as BattalionDef[];
  const templates = (content.collections.templates ?? []) as TemplateDef[];

  const n = map.provinceCount;
  const moveCost = new Int32Array(n);
  const attackModifier = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const t = terrain[map.terrain[i]!];
    moveCost[i] = toFixed(t?.movement_cost ?? 1);
    attackModifier[i] = toFixed(t?.attack_modifier ?? 1);
  }
  const isLand = new Uint8Array(n);
  for (let i = 0; i < n; i++) isLand[i] = map.kind[i] === KIND_LAND ? 1 : 0;

  // Neighbor distances from centroids via the map projection (static data, rounded).
  const adjDistance = new Int32Array(map.adjList.length);
  if (defines.map) {
    const projection = makeProjection(defines.map);
    const lonLat = (i: number) => projection.toLonLat(map.centroidX[i]!, map.centroidY[i]!);
    for (let i = 0; i < n; i++) {
      const [lon1, lat1] = lonLat(i);
      for (let k = map.adjStart[i]!; k < map.adjStart[i + 1]!; k++) {
        const [lon2, lat2] = lonLat(map.adjList[k]!);
        adjDistance[k] = toFixed(distanceKm(lon1, lat1, lon2, lat2));
      }
    }
  } else {
    adjDistance.fill(toFixed(50));
  }

  const types = new Map(battalions.map((b) => [b.id, b]));
  const c = defines.combat ?? {};
  const fx = (key: string, fallback: Fixed) =>
    typeof c[key] === 'number' ? toFixed(c[key]) : fallback;

  return {
    provinceCount: n,
    provinceIds: map.provinceIds,
    indexById: map.indexById,
    isLand,
    adjStart: map.adjStart,
    adjList: map.adjList,
    adjDistance,
    moveCost,
    attackModifier,
    templateIds: templates.map((t) => t.id),
    templateNames: templates.map((t) => t.name),
    templates: templates.map((t) => divisionStats(t.battalions, types)),
    combat: {
      width: fx('width', DEFAULT_COMBAT.width),
      blockedHitChance: fx('blocked_hit_chance', DEFAULT_COMBAT.blockedHitChance),
      unblockedHitChance: fx('unblocked_hit_chance', DEFAULT_COMBAT.unblockedHitChance),
      strengthDamagePerHit: fx('strength_damage_per_hit', DEFAULT_COMBAT.strengthDamagePerHit),
      organizationDamagePerHit: fx(
        'organization_damage_per_hit',
        DEFAULT_COMBAT.organizationDamagePerHit,
      ),
      randomSpread: fx('random_spread', DEFAULT_COMBAT.randomSpread),
      organizationRecovery: fx('organization_recovery', DEFAULT_COMBAT.organizationRecovery),
    },
  };
}
