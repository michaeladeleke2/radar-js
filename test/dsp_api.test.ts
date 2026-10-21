// radar.dsp as an API: pure (inputs untouched, same answer for nested and
// typed inputs, no shared state) and the velocity axis, which SensDSv2 has no
// function for at the radar's real chirp time (see test/golden/README.md).

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import radar from '../src/index.ts';
import { parseNpy } from '../src/data/npy.js';

const npy = (p: string) => { const b = readFileSync(new URL(`./golden/${p}.npy`, import.meta.url)); return parseNpy(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const input = npy('synthetic/input');
const frame0 = (input.data as Float32Array).slice(0, 128 * 256);
const nested = Array.from({ length: 128 }, (_, c) => Array.from(frame0.subarray(c * 256, (c + 1) * 256)));
const config = radar.config.SENSDS_CONFIG;

test('nested arrays and typed arrays with a shape give the same result', () => {
  assert.deepEqual(radar.dsp.rangeProfile(nested), radar.dsp.rangeProfile({ data: frame0, shape: [128, 256] }));
  const frames3 = [nested, nested];
  const typed3 = { data: Float32Array.from([...frame0, ...frame0]), shape: [2, 128, 256] as [number, number, number] };
  assert.deepEqual(radar.dsp.rangeMap(frames3), radar.dsp.rangeMap(typed3));
});

test('inputs are not changed, and repeated calls agree (no hidden state)', () => {
  const before = frame0.slice();
  const a = radar.dsp.rangeDopplerMap({ data: frame0, shape: [128, 256] });
  const b = radar.dsp.rangeDopplerMap({ data: frame0, shape: [128, 256] });
  assert.deepEqual(frame0, before);
  assert.deepEqual(a, b);
  const re = [1, 2, 3, 4], im = [0, 0, 0, 0];
  radar.dsp.fft(re, im);
  assert.deepEqual(re, [1, 2, 3, 4]);
});

test('outputs are plain arrays', () => {
  const rdm = radar.dsp.rangeDopplerMap(nested);
  assert.ok(Array.isArray(rdm) && Array.isArray(rdm[0]));
  assert.ok(Array.isArray(radar.dsp.rangeAxis(config)));
});

test('bad shapes are rejected with a clear message', () => {
  assert.throws(() => radar.dsp.rangeProfile({ data: frame0, shape: [100, 256] }), /shape needs/);
  assert.throws(() => radar.dsp.rangeMap({ data: input.data, shape: input.shape as [number, number, number, number] }, { antenna: 3 }), /antenna 3 out of range/);
});

test('velocityAxis: +/-4.11 m/s for the SensDSv2 settings, zero at the centre bin', () => {
  const v = radar.dsp.velocityAxis(config);
  assert.equal(v.length, 512);
  assert.equal(v[256], 0);
  // wavelength at the nominal 60.75 GHz centre / (4 x 0.3 ms)
  assert.ok(Math.abs(-v[0] - 299_792_458 / 60.75e9 / (4 * 0.0003)) < 1e-12, String(v[0]));
  // SensDSv2's REF_MAX_SPEED_M_S (core/reference_image.py) is 4.112380411522634,
  // which implies a 60.749985 GHz centre (presumably the SDK's own figure after
  // frequency rounding): the two agree to 0.25 ppm.
  assert.ok(Math.abs(-v[0] - 4.112380411522634) / 4.112380411522634 < 1e-6, String(v[0]));
});

test('velocityAxis puts the synthetic target (-0.50 m/s, toward the radar) in the right Doppler bin', () => {
  const { spectrogram } = radar.dsp.dopplerSpectrogram({ data: input.data, shape: input.shape as [number, number, number, number] });
  const v = radar.dsp.velocityAxis(config), step = v[1] - v[0];
  for (const row of spectrogram) {
    const peak = row.indexOf(Math.max(...row));
    // within 2 bins; the target's range changes within a frame, which smears it slightly
    assert.ok(Math.abs(v[peak] - -0.5) <= 2 * step, `peak at ${v[peak]} m/s`);
  }
});
