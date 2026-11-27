import { createDivisions } from './divisions.ts';
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
  divisions: {
    nextId: number;
    id: number[];
    owner: number[];
    template: number[];
    location: number[];
    strength: number[];
    organization: number[];
    progress: number[];
    paths: number[][];
  };
  /** Pairs [a, b] with a < b that are at war. */
  wars: [number, number][];
  /** Country indices controlled by humans. */
  humans: number[];
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
    divisions: (() => {
      const d = state.divisions;
      const take = (a: Int32Array | Uint16Array) => Array.from(a.subarray(0, d.count));
      return {
        nextId: d.nextId,
        id: take(d.id),
        owner: take(d.owner),
        template: take(d.template),
        location: take(d.location),
        strength: take(d.strength),
        organization: take(d.organization),
        progress: take(d.progress),
        paths: d.paths.slice(0, d.count).map((p) => [...p]),
      };
    })(),
    wars: (() => {
      const n = state.countryTags.length;
      const pairs: [number, number][] = [];
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++) if (state.wars[a * n + b]) pairs.push([a, b]);
      return pairs;
    })(),
    humans: Array.from(state.humans.keys()).filter((i) => state.humans[i] === 1),
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
  const sd = snapshot.divisions;
  const dc = sd.id.length;
  for (const field of [
    sd.owner,
    sd.template,
    sd.location,
    sd.strength,
    sd.organization,
    sd.progress,
    sd.paths,
  ]) {
    if (field.length !== dc) throw new Error('Corrupt save: division array lengths differ');
  }
  const divisions = createDivisions(Math.max(64, dc));
  divisions.count = dc;
  divisions.nextId = sd.nextId;
  divisions.id.set(sd.id);
  divisions.owner.set(sd.owner);
  divisions.template.set(sd.template);
  divisions.location.set(sd.location);
  divisions.strength.set(sd.strength);
  divisions.organization.set(sd.organization);
  divisions.progress.set(sd.progress);
  divisions.paths = sd.paths.map((p) => [...p]);
  const n = snapshot.countryTags.length;
  const wars = new Uint8Array(n * n);
  for (const [a, b] of snapshot.wars) {
    wars[a * n + b] = 1;
    wars[b * n + a] = 1;
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
    divisions,
    wars,
    humans: (() => {
      const humans = new Uint8Array(n);
      for (const i of snapshot.humans) humans[i] = 1;
      return humans;
    })(),
  };
}

/** Deep copy via a snapshot round trip. */
export function cloneState(state: GameState): GameState {
  return fromSnapshot(toSnapshot(state));
}
