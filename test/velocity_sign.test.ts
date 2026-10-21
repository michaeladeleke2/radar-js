// The velocity sign, pinned with real radar data: a hand moving away from and
// toward the board, recorded live with radar-js on 2026-10-21
// (test/fixtures/sign/hand_away_toward.npy, antenna 0 of frames 26-30 and
// 48-52 of that recording). Over the whole 23 s recording the range trend and
// the Doppler sign agreed in 89 of 90 moving frames (PROGRESS.md).
//
// Convention: negative velocity = toward the radar; the plot draws it below
// the centre line.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import radar from '../src/index.ts';
import { historyToPlotData } from '../src/viz/image.js';

const config = radar.config.SENSDS_CONFIG;
const v = radar.dsp.velocityAxis(config);
const r = radar.dsp.rangeAxis(config);
const rec = await radar.data.loadNpy(readFileSync(new URL('./fixtures/sign/hand_away_toward.npy', import.meta.url)));
const frame = (i: number) => ({ data: rec.data.subarray(i * 128 * 256, (i + 1) * 128 * 256), shape: [128, 256] as [number, number] });

// The loudest moving cell (away from zero Doppler) of a frame's range-Doppler map
function peak(i: number) {
  const rdm = radar.dsp.rangeDopplerMap(frame(i));
  let best = -Infinity, bin = 0, k = 0;
  for (let b = 15; b < 300; b++) for (let j = 0; j < 512; j++) if (Math.abs(j - 256) > 2 && rdm[b][j] > best) { best = rdm[b][j]; bin = b; k = j; }
  return { range: r[bin], velocity: v[k], dopplerBin: k };
}

const away = [0, 1, 2, 3, 4].map(peak);      // recording frames 26-30
const toward = [5, 6, 7, 8, 9].map(peak);    // recording frames 48-52

test('moving away: range rises and the Doppler velocity is positive', () => {
  assert.ok(away[4].range > away[0].range, `range ${away[0].range} -> ${away[4].range}`);
  for (const p of away) assert.ok(p.velocity > 0.1, `velocity ${p.velocity}`);
});

test('moving toward: range falls and the Doppler velocity is negative', () => {
  assert.ok(toward[4].range < toward[0].range, `range ${toward[0].range} -> ${toward[4].range}`);
  for (const p of toward) assert.ok(p.velocity < -0.1, `velocity ${p.velocity}`);
});

test('the plot draws toward the radar below the centre line', () => {
  // One history row per frame; the plot's row 0 is the top of the image
  const D = 512;
  for (const p of toward) {
    const history = new Float64Array(D).fill(-120);
    history[p.dopplerBin] = 0;
    const row = historyToPlotData(history, 1, D).indexOf(0);
    assert.ok(row > D / 2, `drawn at row ${row} of ${D} (row 0 = top)`);
  }
});
