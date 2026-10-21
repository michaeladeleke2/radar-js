// radar.capture and radar.bench.summarize.

import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

import radar from '../src/index.ts';
import type { Sink } from '../src/capture/index.ts';

const config = radar.config.SENSDS_CONFIG;
const frame = (v: number) => new Float32Array(3 * 128 * 256).fill(v);

test('Recorder keeps only frames inside the capture window and counts drops and restarts', async () => {
  vi.useFakeTimers();
  let drops = 5;
  const rec = new radar.capture.Recorder(() => drops);
  rec.push(frame(9));                       // before start: ignored
  const done = rec.start(0.3, 0.1);
  rec.push(frame(1)); rec.push(frame(2));
  drops = 6; rec.noteRestart();
  vi.advanceTimersByTime(300);
  const r = await done;
  rec.push(frame(3));                       // after the end: ignored
  vi.useRealTimers();
  assert.equal(r.frames.length, 2);
  assert.equal(r.frames[0][0], 1);
  assert.equal(r.expected, 3);
  assert.equal(r.dropped, 1);
  assert.equal(r.restarts, 1);
  assert.equal(r.frameTimesMs.length, 2);
});

test('sidecar carries label, distance, frame counts, config, board, device and build', async () => {
  const capture = { frames: [frame(0), frame(0)], frameTimesMs: [0, 100], startedAt: new Date('2026-10-21T15:00:00Z'), endedAt: new Date('2026-10-21T15:00:03Z'), durationS: 3, expected: 30, dropped: 0, restarts: 0 };
  const device = await radar.capture.deviceInfo('test bench');
  const s = radar.capture.sidecar({
    type: 'dataset', file: 'push_0.6m_x.npy', capture, config, shape: [3, 128, 256], device,
    board: { board: 'Radar Baseboard MCU7', firmware: '2.9.0', chip: { isBGT60TR13C: true } }, label: 'push', distance_m: 0.6,
  });
  assert.equal(s.format, 'radar-js-capture');
  assert.deepEqual(s.frames, { expected: 30, received: 2, dropped: 0, restarts: 0, shape: [2, 3, 128, 256] });
  assert.equal(s.label, 'push');
  assert.equal(s.distance_m, 0.6);
  assert.deepEqual(s.config, config);
  assert.deepEqual(s.board, { board: 'Radar Baseboard MCU7', firmware: '2.9.0', chip: 'BGT60TR13C' });
  assert.equal(s.device.name, 'test bench');
  assert.match(s.radar_js.commit, /^[0-9a-f]{12}$/);
  assert.equal(s.started_at, '2026-10-21T15:00:00.000Z');
});

test('captureName: label, distance and local time', () => {
  const at = new Date(2026, 9, 21, 14, 30, 5);
  assert.equal(radar.capture.captureName('push', 0.6, at), 'push_0.6m_20261021-143005');
  assert.equal(radar.capture.captureName('live_worker', null, at), 'live_worker_20261021-143005');
});

test('saveCapture writes a .npy that loads back and its sidecar', async () => {
  const files: Record<string, Blob> = {};
  const sink: Sink = { name: 'memory', async write(f, b) { files[f] = b; } };
  const frames = [frame(0.25), frame(-0.5)];
  const meta = { format: 'radar-js-capture', file: 'x.npy' } as never;
  await radar.capture.saveCapture(sink, 'x', frames, [3, 128, 256], meta);
  const rec = await radar.data.loadNpy(files['x.npy']);
  assert.deepEqual(rec.shape, [2, 3, 128, 256]);
  assert.equal(rec.data[3 * 128 * 256], -0.5);
  assert.equal(JSON.parse(await files['x.json'].text()).format, 'radar-js-capture');
});

test('summarize: mean, median, p95 (nearest rank)', () => {
  const s = radar.bench.summarize(Array.from({ length: 100 }, (_, i) => i + 1));
  assert.deepEqual(s, { n: 100, mean: 50.5, median: 50.5, p95: 95, min: 1, max: 100 });
  assert.equal(radar.bench.summarize([]).n, 0);
});
