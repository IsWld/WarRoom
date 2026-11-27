import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compressText, decompressToText } from '../../client/src/sim/saves.ts';

test('save compression round-trips and accepts plain JSON', async () => {
  const text = JSON.stringify({ format: 'warroom-save', data: 'x'.repeat(10_000) });
  const blob = await compressText(text);
  assert.ok(blob.size < text.length / 10);
  assert.equal(await decompressToText(blob), text);
  assert.equal(await decompressToText(new Blob([text])), text);
});
