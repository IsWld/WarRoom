import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chance, cloneRng, createRng, nextInt, nextRange, nextU32 } from '../src/rng.ts';

test('same seed gives the same sequence', () => {
  const a = createRng(1936);
  const b = createRng(1936);
  for (let i = 0; i < 1000; i++) assert.equal(nextU32(a), nextU32(b));
});

test('different seeds diverge immediately', () => {
  const a = createRng(1);
  const b = createRng(2);
  assert.notEqual(nextU32(a), nextU32(b));
});

test('values are unsigned 32-bit integers', () => {
  const s = createRng(42);
  for (let i = 0; i < 1000; i++) {
    const x = nextU32(s);
    assert.ok(Number.isInteger(x) && x >= 0 && x <= 0xffffffff);
  }
});

test('nextInt stays in range and covers every value', () => {
  const s = createRng(7);
  const seen = new Set<number>();
  for (let i = 0; i < 10_000; i++) {
    const x = nextInt(s, 6);
    assert.ok(x >= 0 && x < 6);
    seen.add(x);
  }
  assert.equal(seen.size, 6);
});

test('nextInt is roughly uniform', () => {
  const s = createRng(99);
  const counts = new Array<number>(10).fill(0);
  const n = 100_000;
  for (let i = 0; i < n; i++) counts[nextInt(s, 10)]! += 1;
  for (const c of counts) assert.ok(Math.abs(c - n / 10) < n / 100, `bucket count ${c}`);
});

test('nextRange is inclusive', () => {
  const s = createRng(3);
  const seen = new Set<number>();
  for (let i = 0; i < 1000; i++) seen.add(nextRange(s, -2, 2));
  assert.deepEqual(
    [...seen].sort((x, y) => x - y),
    [-2, -1, 0, 1, 2],
  );
});

test('chance respects certainty and impossibility', () => {
  const s = createRng(5);
  for (let i = 0; i < 100; i++) {
    assert.equal(chance(s, 0, 10), false);
    assert.equal(chance(s, 10, 10), true);
  }
});

test('nextInt rejects invalid bounds', () => {
  const s = createRng(1);
  assert.throws(() => nextInt(s, 0), RangeError);
  assert.throws(() => nextInt(s, 1.5), RangeError);
});

test('cloned state continues identically without disturbing the original', () => {
  const s = createRng(11);
  nextU32(s);
  const copy = cloneRng(s);
  assert.equal(nextU32(copy), nextU32(s));
});
