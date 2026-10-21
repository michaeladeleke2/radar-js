// radar.data: .npy, CSV and JSON round trips, the numpy file layout, tables.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import radar from '../src/index.ts';

const config = radar.config.SENSDS_CONFIG;
const goldenBytes = readFileSync(new URL('./golden/synthetic/input.npy', import.meta.url));

test('loadNpy reads a numpy-written recording from a Blob, bytes or ArrayBuffer', async () => {
  for (const source of [new Blob([goldenBytes]), goldenBytes, goldenBytes.buffer.slice(goldenBytes.byteOffset, goldenBytes.byteOffset + goldenBytes.byteLength)]) {
    const rec = await radar.data.loadNpy(source);
    assert.deepEqual(rec.shape, [10, 3, 128, 256]);
    assert.ok(rec.data instanceof Float32Array);
  }
});

test('saveNpy writes the same bytes numpy.save wrote (header and data)', async () => {
  const rec = await radar.data.loadNpy(goldenBytes);
  const out = new Uint8Array(await radar.data.saveNpy(rec).arrayBuffer());
  assert.deepEqual(out, new Uint8Array(goldenBytes));
});

test('a single frame (rx, chirps, samples) loads as a one-frame recording', async () => {
  const one = radar.data.saveNpy({ data: new Float32Array(3 * 4 * 5), shape: [3, 4, 5] as unknown as [number, number, number, number] });
  const rec = await radar.data.loadNpy(one);
  assert.deepEqual(rec.shape, [1, 3, 4, 5]);
});

test('fromFrames joins frames as radar.onFrame delivers them', () => {
  const a = new Float32Array(3 * 128 * 256).fill(0.25), b = new Float32Array(3 * 128 * 256).fill(-0.5);
  const rec = radar.data.fromFrames([a, b], [3, 128, 256], config);
  assert.deepEqual(rec.shape, [2, 3, 128, 256]);
  assert.equal(rec.data[0], 0.25);
  assert.equal(rec.data[3 * 128 * 256], -0.5);
  assert.throws(() => radar.data.fromFrames([new Float32Array(5)]), /expected/);
});

test('JSON round trip of a recording is exact', async () => {
  const golden = await radar.data.loadNpy(goldenBytes);
  const rec = { data: golden.data.slice(0, 2 * 3 * 128 * 256), shape: [2, 3, 128, 256] as [number, number, number, number], config };
  const back = await radar.data.loadJson(radar.data.saveJson(rec)) as typeof rec;
  assert.deepEqual(back.shape, rec.shape);
  assert.deepEqual(back.data, rec.data);
  assert.deepEqual(back.config, config);
  assert.deepEqual(await radar.data.loadJson(radar.data.saveJson({ a: [1, 2] })), { a: [1, 2] });
});

test('CSV round trip, including quoting', async () => {
  const rows = [{ time_s: 0, label: 'wave, hand', note: 'said "hi"' }, { time_s: 0.1, label: 'idle', note: '' }];
  const text = radar.data.toCsv(rows);
  assert.equal(text.split('\r\n')[0], 'time_s,label,note');
  assert.deepEqual(await radar.data.loadCsv(radar.data.saveCsv(rows)), rows);
});

test('spectrogramTable: one row per time step, one column per velocity bin', async () => {
  const rec = await radar.data.loadNpy(goldenBytes);
  const { spectrogram } = radar.dsp.dopplerSpectrogram(rec);
  const rows = radar.data.spectrogramTable(spectrogram, config);
  assert.equal(rows.length, 10);
  assert.equal(Object.keys(rows[0]).length, 2 + 512);
  assert.equal(rows[3].time_s, 0.3);
  assert.equal(rows[0]['v_0.000'], spectrogram[0][256]);
});

test('trackTable follows the synthetic target (0.80 m at -0.50 m/s)', async () => {
  const rows = radar.data.trackTable(await radar.data.loadNpy(goldenBytes), config);
  assert.deepEqual(Object.keys(rows[0]), ['time_s', 'frame', 'range_m', 'velocity_m_s', 'power_db']);
  rows.forEach((r, i) => {
    assert.ok(Math.abs((r.velocity_m_s as number) + 0.5) < 0.02, `frame ${i}: ${r.velocity_m_s} m/s`);
    // Range: the target moves 5 cm per frame and the 5-frame median smoothing
    // (SensDSv2's) lags at the ends of a recording, so check the middle frames.
    if (i >= 2 && i <= 7) {
      const expected = 0.8 - 0.5 * (i * 0.1);
      assert.ok(Math.abs((r.range_m as number) - expected) < 0.04, `frame ${i}: ${r.range_m} m, expected about ${expected}`);
    }
  });
});
