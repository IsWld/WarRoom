import { createRng, type RngState } from './rng.ts';

export const STATE_VERSION = 1;

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
}

export interface CreateStateOptions {
  seed: number;
  startDay: number;
  /** Country tags in a stable order; index 0 ("nobody") is added automatically. */
  countryTags: readonly string[];
  provinceCount: number;
  /** Optional starting owner per province, as country tags (missing = nobody). */
  owners?: readonly (string | undefined)[];
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
  };
}

/** Looks up a country index by tag; throws if unknown. */
export function countryIndex(state: Pick<GameState, 'countryTags'>, tag: string): number {
  const index = state.countryTags.indexOf(tag);
  if (index < 0) throw new Error(`Unknown country tag "${tag}"`);
  return index;
}
