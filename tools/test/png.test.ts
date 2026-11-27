import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePng, encodePng } from '../png.ts';

test('PNG round-trips RGB and RGBA exactly', () => {
  const w = 37;
  const h = 11;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 7919) & 0xff;
  const decoded = decodePng(encodePng(w, h, rgb, 3));
  assert.equal(decoded.width, w);
  assert.equal(decoded.height, h);
  for (let p = 0; p < w * h; p++) {
    assert.deepEqual(Array.from(decoded.pixels.subarray(p * 4, p * 4 + 4)), [
      rgb[p * 3]!,
      rgb[p * 3 + 1]!,
      rgb[p * 3 + 2]!,
      255,
    ]);
  }
  const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 31) & 0xff);
  assert.deepEqual(decodePng(encodePng(w, h, rgba, 4)).pixels, rgba);
});

test('encoded PNG has no color-management chunks', () => {
  const png = encodePng(2, 2, new Uint8Array(12));
  const text = png.toString('latin1');
  for (const chunk of ['gAMA', 'cHRM', 'sRGB', 'iCCP']) assert.equal(text.includes(chunk), false);
});
