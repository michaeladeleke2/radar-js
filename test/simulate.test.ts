// radar.simulate: layout and scale, targets at the right range and speed, and
// agreement with the Python generator behind the golden synthetic input.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import radar from '../src/index.ts';

const config = radar.config.SENSDS_CONFIG;
const ranges = radar.dsp.rangeAxis(config);
const speeds = radar.dsp.velocityAxis(config);
// Frame f, antenna 0, as radar.dsp's one-frame functions take it
const frameOf = (rec: { data: Float32Array | Float64Array }, f = 0) => ({ data: rec.data.subarray(f * 3 * 128 * 256, (f * 3 + 1) * 128 * 256), shape: [128, 256] as [number, number] });
const argmax = (a: number[], from = 0) => { let k = from; for (let i = from; i < a.length; i++) if (a[i] > a[k]) k = i; return k; };

test('frames come out in the device layout and the SDK scale', () => {
  const rec = radar.simulate.frames(config, { targets: [{ range_m: 1 }], nFrames: 2 });
  assert.deepEqual(rec.shape, [2, 3, 128, 256]);
  for (const v of rec.data.subarray(0, 1000)) {
    assert.ok(v >= -1 && v <= 1);
    const raw = Math.round((v + 1) * 4095 / 2);
    assert.equal(Math.fround(Math.fround(raw * 2 / 4095) - 1), v);   // a 12-bit code, scaled as the SDK does
  }
});

test('the same seed gives the same frames; another seed does not', () => {
  const a = radar.simulate.frames(config, { targets: [{ range_m: 1 }], seed: 7 });
  const b = radar.simulate.frames(config, { targets: [{ range_m: 1 }], seed: 7 });
  const c = radar.simulate.frames(config, { targets: [{ range_m: 1 }], seed: 8 });
  assert.deepEqual(a.data, b.data);
  assert.notDeepEqual(a.data, c.data);
});

for (const range of [0.3, 0.8, 1.5, 2.5, 3.2]) {
  test(`a still target at ${range} m peaks at its range bin (raw range profile)`, () => {
    const rec = radar.simulate.frames(config, { targets: [{ range_m: range }] });
    const profile = radar.dsp.rangeProfile(frameOf(rec), { mode: 'raw' });
    const expected = Math.round(range / (ranges[1] - ranges[0]));
    const peak = argmax(profile, 5);
    assert.ok(Math.abs(peak - expected) <= 1, `peak bin ${peak} (${ranges[peak].toFixed(3)} m), expected ${expected}`);
  });
}

test('a moving target shows in the MTI range profile; a still one does not', () => {
  const moving = radar.dsp.rangeProfile(frameOf(radar.simulate.frames(config, { targets: [{ range_m: 1.2, speed_m_s: 1 }], noise: 0 })), { mode: 'mti' });
  const still = radar.dsp.rangeProfile(frameOf(radar.simulate.frames(config, { targets: [{ range_m: 1.2 }], noise: 0 })), { mode: 'mti' });
  // at 1 m/s the target moves 3.8 cm during the frame's 128 chirps: its mid-frame range
  const bin = Math.round((1.2 + 1 * 64 * config.chirp_repetition_time_s) / (ranges[1] - ranges[0]));
  assert.ok(Math.abs(argmax(moving, 5) - bin) <= 2, `moving peak at bin ${argmax(moving, 5)}`);
  assert.ok(moving[bin] - still[bin] > 40, `MTI suppresses the still target by ${(moving[bin] - still[bin]).toFixed(1)} dB`);
});

// The loudest cell of each frame's range-Doppler map. (The spectrogram's
// 5-frame median range smoothing, SensDSv2's behaviour, lags a target that
// moves several range bins per frame, so it is not used here.)
for (const speed of [-3.5, -2.5, -0.5, 0.7, 2.0, 3.5]) {
  test(`a target at ${speed} m/s peaks at its Doppler bin`, () => {
    const rec = radar.simulate.frames(config, { targets: [{ range_m: 1.0, speed_m_s: speed }], nFrames: 3 });
    const step = speeds[1] - speeds[0];
    for (let f = 0; f < 3; f++) {
      const rdm = radar.dsp.rangeDopplerMap(frameOf(rec, f));
      let best = -Infinity, k = 0;
      for (const row of rdm.slice(15)) for (let j = 0; j < row.length; j++) if (row[j] > best) { best = row[j]; k = j; }
      assert.ok(Math.abs(speeds[k] - speed) <= step, `frame ${f}: peak at ${speeds[k].toFixed(3)} m/s, expected ${speed}`);
    }
  });
}

test('matches the Python generator of the golden synthetic input up to its noise', async () => {
  const golden = await radar.data.loadNpy(readFileSync(new URL('./golden/synthetic/input.npy', import.meta.url)));
  // tools/make_golden.py: rx phase steps of 0.7 rad = pi sin(angle)
  const angle_deg = Math.asin(0.7 / Math.PI) * 180 / Math.PI;
  const sim = radar.simulate.frames(config, {
    targets: [{ range_m: 0.8, speed_m_s: -0.5, amplitude: 600, angle_deg }, { range_m: 1.6, amplitude: 300, angle_deg }],
    nFrames: 10, noise: 0,
  });
  let sum = 0, max = 0;
  for (let i = 0; i < sim.data.length; i++) { const d = Math.abs(sim.data[i] - golden.data[i]); sum += d; max = Math.max(max, d); }
  const mean = sum / sim.data.length, sd = 8 * 2 / 4095;
  // Python's noise has sd 8 counts: mean |noise| = 0.8 sd, peaks within ~6 sd
  assert.ok(mean < sd, `mean |difference| ${mean}`);
  assert.ok(max < 7 * sd, `max |difference| ${max}`);
});
