import type { GameState } from './state.ts';

/**
 * FNV-1a (32-bit) over every field of the game state, in a fixed order. Two states with the
 * same hash are, for practical purposes, identical. Used by the determinism harness and,
 * later, to detect desyncs in multiplayer.
 */
export function hashState(state: GameState): string {
  const h = new Fnv1a();
  h.int(state.version);
  h.int(state.tick);
  h.int(state.startDay);
  for (const word of state.rng) h.int(word);
  h.int(state.countryTags.length);
  for (const tag of state.countryTags) h.str(tag);
  h.int(state.provinces.count);
  h.array(state.provinces.owner);
  h.array(state.provinces.controller);
  const d = state.divisions;
  h.int(d.count);
  h.int(d.nextId);
  for (const a of [d.id, d.owner, d.template, d.location, d.strength, d.organization, d.progress]) {
    h.array(a.subarray(0, d.count));
  }
  for (let i = 0; i < d.count; i++) h.array(d.paths[i]!);
  h.array(state.wars);
  h.array(state.humans);
  return h.hex();
}

class Fnv1a {
  private h = 0x811c9dc5;

  byte(b: number): void {
    this.h ^= b & 0xff;
    this.h = Math.imul(this.h, 0x01000193);
  }

  /** Hashes a 32-bit integer (or a safe integer's low 32 bits plus high bits). */
  int(n: number): void {
    const lo = n >>> 0;
    const hi = Math.floor(n / 0x1_0000_0000) >>> 0;
    for (const word of [lo, hi]) {
      this.byte(word);
      this.byte(word >>> 8);
      this.byte(word >>> 16);
      this.byte(word >>> 24);
    }
  }

  str(s: string): void {
    this.int(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.byte(c);
      this.byte(c >>> 8);
    }
  }

  array(values: ArrayLike<number>): void {
    this.int(values.length);
    for (let i = 0; i < values.length; i++) this.int(values[i]!);
  }

  hex(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}
