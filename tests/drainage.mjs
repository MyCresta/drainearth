import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { cellAt, createTerrain, computeDrainage, getMetrics } from '../hydrology.js';

const asset = (name) => readFile(new URL('../assets/' + name, import.meta.url));
function arrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
const terrain = createTerrain(
  new Int16Array(arrayBuffer(await asset('terrain.bin'))),
  1440,
  720,
  arrayBuffer(gunzipSync(await asset('spills.gz'))),
);
const cell = (lat, lon) => cellAt(terrain, lat, lon);
const atlantic = cell(29.125, -41.125);
const ionian = cell(36, 18);
const westernMed = cell(37.5, 3);
const redSea = cell(20, 38.5);
const blackSea = cell(43, 34);
const model = computeDrainage(terrain, atlantic);

// Guard against resampling away shallow passages and changing whole-basin behavior.
for (const [i, low, high] of [
  [ionian, -295, -250],
  [redSea, -145, -105],
  [blackSea, -40, -5],
]) {
  assert.equal(terrain.ocean[i], 1);
  assert.ok(model.floor[i] >= low && model.floor[i] <= high, 'Pass outside expected elevation range');
  assert.equal(Math.max(-1000, model.floor[i]), model.floor[i]); // Water remains behind the sill.
}
assert.equal(model.floor[westernMed], -291, 'Western Mediterranean independently derived sill');
assert.equal(model.floor[redSea], -137, 'Surveyed Hanish passage');
assert.equal(model.floor[blackSea], -35, 'Surveyed Bosporus passage');
const opposite = computeDrainage(terrain, ionian);
assert.equal(opposite.floor[atlantic], model.floor[ionian]);
assert.equal(opposite.floor[ionian], terrain.elevation[ionian]);
assert.equal(model.floor[atlantic], terrain.elevation[atlantic]);
assert.equal(terrain.ocean[cell(41.7, 51)], 0, 'Caspian Sea must stay separate');
assert.equal(getMetrics(model, 0).removedKm3, 0);
assert.ok(getMetrics(model, 1000).exposedKm2 > getMetrics(model, 500).exposedKm2);
assert.ok(getMetrics(model, 1000).removedKm3 > getMetrics(model, 500).removedKm3);
assert.equal(getMetrics(model, 11000).drop, model.plugDepth);
console.log('Passed basin spill, reciprocal plug, ocean mask, area and volume checks.');
