/**
 * Seeded, deterministic random numbers (sfc32).
 *
 * The generator's whole state is four 32-bit words kept in a Uint32Array that lives inside
 * GameState, so saving the state also saves the exact position in the random sequence.
 * Never use Math.random in the engine.
 */

export type RngState = Uint32Array;

/** Creates a generator state from any 32-bit seed, mixed with splitmix32. */
export function createRng(seed: number): RngState {
  const state = new Uint32Array(4);
  let x = seed | 0;
  for (let i = 0; i < 4; i++) {
    x = (x + 0x9e3779b9) | 0;
    let t = x ^ (x >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    state[i] = t >>> 0;
  }
  // Warm up so that similar seeds diverge quickly.
  for (let i = 0; i < 12; i++) nextU32(state);
  return state;
}

/** Returns the next unsigned 32-bit integer and advances the state. */
export function nextU32(s: RngState): number {
  const a = s[0]!;
  const b = s[1]!;
  const c = s[2]!;
  const d = s[3]!;
  const t = (((a + b) | 0) + d) | 0;
  s[3] = (d + 1) | 0;
  s[0] = b ^ (b >>> 9);
  s[1] = (c + (c << 3)) | 0;
  const rotated = (c << 21) | (c >>> 11);
  s[2] = (rotated + t) | 0;
  return t >>> 0;
}

const TWO_POW_32 = 0x1_0000_0000;

/** Returns an unbiased integer in [0, n). `n` must be an integer between 1 and 2^32. */
export function nextInt(s: RngState, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > TWO_POW_32) {
    throw new RangeError(`nextInt: n must be an integer in [1, 2^32], got ${n}`);
  }
  const limit = TWO_POW_32 - (TWO_POW_32 % n);
  let x = nextU32(s);
  while (x >= limit) x = nextU32(s);
  return x % n;
}

/** Returns an integer in [min, max] inclusive. */
export function nextRange(s: RngState, min: number, max: number): number {
  return min + nextInt(s, max - min + 1);
}

/** True with probability numerator / denominator, using integers only. */
export function chance(s: RngState, numerator: number, denominator: number): boolean {
  return nextInt(s, denominator) < numerator;
}

/** Copies a generator state (for previews that must not disturb the real sequence). */
export function cloneRng(s: RngState): RngState {
  return new Uint32Array(s);
}
