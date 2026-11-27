import { STATE_VERSION, type GameState } from './state.ts';

/**
 * A JSON-safe copy of the game state: the basis of save files. Typed arrays become plain
 * arrays here; Phase 2 adds a compact binary encoding on top.
 */
export interface Snapshot {
  version: number;
  tick: number;
  startDay: number;
  rng: number[];
  countryTags: string[];
  provinces: { count: number; owner: number[]; controller: number[] };
}

export function toSnapshot(state: GameState): Snapshot {
  return {
    version: state.version,
    tick: state.tick,
    startDay: state.startDay,
    rng: Array.from(state.rng),
    countryTags: [...state.countryTags],
    provinces: {
      count: state.provinces.count,
      owner: Array.from(state.provinces.owner),
      controller: Array.from(state.provinces.controller),
    },
  };
}

export function fromSnapshot(snapshot: Snapshot): GameState {
  if (snapshot.version !== STATE_VERSION) {
    throw new Error(
      `Save version ${snapshot.version} is not supported (expected ${STATE_VERSION})`,
    );
  }
  const { count, owner, controller } = snapshot.provinces;
  if (snapshot.rng.length !== 4) throw new Error('Corrupt save: RNG state must have 4 words');
  if (owner.length !== count || controller.length !== count) {
    throw new Error('Corrupt save: province array lengths do not match the province count');
  }
  return {
    version: snapshot.version,
    tick: snapshot.tick,
    startDay: snapshot.startDay,
    rng: Uint32Array.from(snapshot.rng),
    countryTags: [...snapshot.countryTags],
    provinces: {
      count,
      owner: Uint16Array.from(owner),
      controller: Uint16Array.from(controller),
    },
  };
}

/** Deep copy via a snapshot round trip. */
export function cloneState(state: GameState): GameState {
  return fromSnapshot(toSnapshot(state));
}
