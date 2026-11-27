import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedDiv, fixedMul, fixedToFloat, scaleInt, toFixed } from '../src/fixed.ts';
import {
  civilFromDays,
  dateToTick,
  daysFromCivil,
  formatDate,
  parseDay,
  tickToDate,
} from '../src/calendar.ts';

test('fixed-point multiply and divide', () => {
  assert.equal(toFixed(1.5), 1500);
  assert.equal(fixedMul(toFixed(1.5), toFixed(2)), toFixed(3));
  assert.equal(fixedMul(toFixed(0.1), toFixed(0.1)), 10); // 0.010
  assert.equal(fixedDiv(toFixed(1), toFixed(3)), 333); // truncates
  assert.equal(fixedMul(toFixed(-1.5), toFixed(2)), toFixed(-3));
  assert.equal(fixedToFloat(1250), 1.25);
  assert.equal(scaleInt(1_000_000, toFixed(0.15)), 150_000);
  assert.throws(() => fixedDiv(1, 0), RangeError);
});

test('calendar round-trips known dates', () => {
  assert.equal(daysFromCivil(1970, 1, 1), 0);
  assert.deepEqual(civilFromDays(0), { year: 1970, month: 1, day: 1 });
  const start = daysFromCivil(1936, 1, 1);
  assert.deepEqual(civilFromDays(start), { year: 1936, month: 1, day: 1 });
  // 1936 is a leap year.
  assert.deepEqual(civilFromDays(daysFromCivil(1936, 2, 28) + 1), {
    year: 1936,
    month: 2,
    day: 29,
  });
  assert.deepEqual(civilFromDays(daysFromCivil(1939, 2, 28) + 1), { year: 1939, month: 3, day: 1 });
});

test('calendar round-trips every day 1900-2100', () => {
  const from = daysFromCivil(1900, 1, 1);
  const to = daysFromCivil(2100, 12, 31);
  for (let d = from; d <= to; d++) {
    const c = civilFromDays(d);
    assert.equal(daysFromCivil(c.year, c.month, c.day), d);
  }
});

test('ticks map to dates and back', () => {
  const start = parseDay('1936-01-01');
  assert.equal(formatDate(tickToDate(0, start)), '1936-01-01 00:00');
  assert.equal(formatDate(tickToDate(25, start)), '1936-01-02 01:00');
  const invasion = { year: 1939, month: 9, day: 1, hour: 4 };
  assert.deepEqual(tickToDate(dateToTick(invasion, start), start), invasion);
});

test('parseDay rejects malformed and impossible dates', () => {
  assert.throws(() => parseDay('1936-1-1'));
  assert.throws(() => parseDay('1937-02-29'));
});
