import { createDivisions, type DivisionArrays } from './divisions.ts';
import { createRng, type RngState } from './rng.ts';

export const STATE_VERSION = 4;

/** Country index 0 is reserved for "nobody" (unowned land, open sea). */
export const NO_COUNTRY = 0;
export const NO_COUNTRY_TAG = '---';

/** Per-province data stored as parallel typed arrays (structure of arrays). */
export interface ProvinceArrays {
  count: number;
  /** Country index that owns the province. */
  owner: Uint16Array;
  /** Country index that currently controls (occupies) the province. */
  controller: Uint16Array;
}

export interface GameState {
  version: number;
  /** Hours since the scenario start. */
  tick: number;
  /** Days since 1970-01-01 of tick 0. */
  startDay: number;
  rng: RngState;
  /** Country index → tag. Index 0 is NO_COUNTRY_TAG. */
  countryTags: string[];
  provinces: ProvinceArrays;
  divisions: DivisionArrays;
  /** Symmetric country × country matrix: 1 = at war. Index [a * countryCount + b]. */
  wars: Uint8Array;
  /** 1 for countries controlled by a human player; everyone else is run by the AI. */
  humans: Uint8Array;
  /** Number of states and building types the `buildings` matrix is sized for. */
  stateCount: number;
  buildingCount: number;
  /** Building levels per state × building type. */
  buildings: Uint8Array;
  /** Per country index. */
  economy: CountryEconomy[];
}

export interface ProductionLine {
  equipment: number;
  factories: number;
  /** Fixed-point 0–1. */
  efficiency: number;
  /** Fixed-point production points toward the next unit. */
  progress: number;
}

export interface ConstructionProject {
  state: number;
  building: number;
  /** Fixed-point construction points. */
  progress: number;
}

export interface TrainingDivision {
  template: number;
  province: number;
  /** -1 while waiting for equipment and manpower; otherwise days until it deploys. */
  daysLeft: number;
}

export interface CountryEconomy {
  manpower: number;
  /** Equipment counts by equipment index. */
  stockpile: number[];
  lines: ProductionLine[];
  construction: ConstructionProject[];
  training: TrainingDivision[];
}

export function emptyEconomy(): CountryEconomy {
  return { manpower: 0, stockpile: [], lines: [], construction: [], training: [] };
}

export interface CreateStateOptions {
  seed: number;
  startDay: number;
  /** Country tags in a stable order; index 0 ("nobody") is added automatically. */
  countryTags: readonly string[];
  provinceCount: number;
  /** Optional starting owner per province, as country tags (missing = nobody). */
  owners?: readonly (string | undefined)[];
  stateCount?: number;
  buildingCount?: number;
}

export function createState(options: CreateStateOptions): GameState {
  const countryTags = [NO_COUNTRY_TAG, ...options.countryTags];
  const seen = new Set<string>();
  for (const tag of countryTags) {
    if (seen.has(tag)) throw new Error(`Duplicate country tag "${tag}"`);
    seen.add(tag);
  }
  if (countryTags.length > 0xffff) throw new Error('Too many countries (max 65535)');

  const count = options.provinceCount;
  const owner = new Uint16Array(count);
  if (options.owners) {
    for (let i = 0; i < count; i++) {
      const tag = options.owners[i];
      owner[i] = tag === undefined ? NO_COUNTRY : countryIndex({ countryTags }, tag);
    }
  }

  return {
    version: STATE_VERSION,
    tick: 0,
    startDay: options.startDay,
    rng: createRng(options.seed),
    countryTags,
    provinces: { count, owner, controller: new Uint16Array(owner) },
    divisions: createDivisions(),
    wars: new Uint8Array(countryTags.length * countryTags.length),
    humans: new Uint8Array(countryTags.length),
    stateCount: options.stateCount ?? 0,
    buildingCount: options.buildingCount ?? 0,
    buildings: new Uint8Array((options.stateCount ?? 0) * (options.buildingCount ?? 0)),
    economy: countryTags.map(() => emptyEconomy()),
  };
}

/** Looks up a country index by tag; throws if unknown. */
export function countryIndex(state: Pick<GameState, 'countryTags'>, tag: string): number {
  const index = state.countryTags.indexOf(tag);
  if (index < 0) throw new Error(`Unknown country tag "${tag}"`);
  return index;
}

export function atWar(
  state: Pick<GameState, 'wars' | 'countryTags'>,
  a: number,
  b: number,
): boolean {
  return state.wars[a * state.countryTags.length + b] === 1;
}

export function setWar(
  state: Pick<GameState, 'wars' | 'countryTags'>,
  a: number,
  b: number,
  war: boolean,
): void {
  const n = state.countryTags.length;
  state.wars[a * n + b] = war ? 1 : 0;
  state.wars[b * n + a] = war ? 1 : 0;
}
