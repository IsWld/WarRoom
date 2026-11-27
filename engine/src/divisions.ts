/**
 * Division storage: parallel typed arrays with a stable id per division. Order is the
 * creation order and is preserved on removal, so iteration is deterministic.
 */
import type { Fixed } from './fixed.ts';

export interface DivisionArrays {
  count: number;
  nextId: number;
  id: Int32Array;
  owner: Uint16Array;
  template: Uint16Array;
  /** Province index the division is in. */
  location: Uint16Array;
  strength: Int32Array;
  organization: Int32Array;
  /** Fixed-point km travelled toward path[0]. */
  progress: Int32Array;
  /** Remaining route as province indices (excluding the current location). */
  paths: number[][];
}

const INITIAL_CAPACITY = 64;

export function createDivisions(capacity = INITIAL_CAPACITY): DivisionArrays {
  return {
    count: 0,
    nextId: 1,
    id: new Int32Array(capacity),
    owner: new Uint16Array(capacity),
    template: new Uint16Array(capacity),
    location: new Uint16Array(capacity),
    strength: new Int32Array(capacity),
    organization: new Int32Array(capacity),
    progress: new Int32Array(capacity),
    paths: [],
  };
}

function grow(d: DivisionArrays): void {
  const cap = d.id.length * 2;
  const g = <T extends Int32Array | Uint16Array>(a: T): T => {
    const b = new (a.constructor as new (n: number) => T)(cap);
    b.set(a);
    return b;
  };
  d.id = g(d.id);
  d.owner = g(d.owner);
  d.template = g(d.template);
  d.location = g(d.location);
  d.strength = g(d.strength);
  d.organization = g(d.organization);
  d.progress = g(d.progress);
}

export interface NewDivision {
  owner: number;
  template: number;
  location: number;
  strength: Fixed;
  organization: Fixed;
}

/** Adds a division and returns its id. */
export function addDivision(d: DivisionArrays, div: NewDivision): number {
  if (d.count === d.id.length) grow(d);
  const i = d.count++;
  const id = d.nextId++;
  d.id[i] = id;
  d.owner[i] = div.owner;
  d.template[i] = div.template;
  d.location[i] = div.location;
  d.strength[i] = div.strength;
  d.organization[i] = div.organization;
  d.progress[i] = 0;
  d.paths[i] = [];
  return id;
}

/** Index of the division with this id, or -1. */
export function divisionIndex(d: DivisionArrays, id: number): number {
  for (let i = 0; i < d.count; i++) if (d.id[i] === id) return i;
  return -1;
}

/** Removes every division for which `dead(i)` is true, preserving the order of the rest. */
export function removeDivisions(d: DivisionArrays, dead: (index: number) => boolean): number {
  let w = 0;
  const count = d.count;
  for (let r = 0; r < count; r++) {
    if (dead(r)) continue;
    if (w !== r) {
      d.id[w] = d.id[r]!;
      d.owner[w] = d.owner[r]!;
      d.template[w] = d.template[r]!;
      d.location[w] = d.location[r]!;
      d.strength[w] = d.strength[r]!;
      d.organization[w] = d.organization[r]!;
      d.progress[w] = d.progress[r]!;
      d.paths[w] = d.paths[r]!;
    }
    w++;
  }
  d.paths.length = w;
  d.count = w;
  return count - w;
}
