// A slice lost in the middle of a frame must not shift every later frame.
//
// Found on the board (2026-11-04): a live session whose frames all started one
// slice late (8192 samples): antennas rotated by one and every chirp cut about
// 86 samples from its true start (PROGRESS.md). After a dropped slice the
// reader starts its next "frame" at whatever slice comes next, as the SDK's
// get_next_raw_frame does; the session then has to realign.

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { FakeBoard } from './fake_board.js';
import { unpackPacked12, rawToCube } from '../src/device/unpack.js';

const FRAME_BYTES = 147456;
const frameOf = (seed: number) => new Uint8Array(FRAME_BYTES).map((_, i) => (i * 7 + seed * 31 + ((i >> 9) * seed)) & 0xFF);
const cube = (bytes: Uint8Array) => rawToCube(unpackPacked12(bytes), 3, 128, 256);

test('session: after a slice is lost mid-frame, every delivered frame is a whole, aligned frame', async () => {
  const frames = [frameOf(1), frameOf(2), frameOf(3)];
  const truth = frames.map(cube);
  const board = new FakeBoard(frames[0]);
  board.frameList = frames;
  board.lose = { trigger: 1, frame: 0, slice: 4 };   // first start: frame 0 loses a packet in its 5th slice
  Object.defineProperty(globalThis.navigator, 'serial', { configurable: true, value: { requestPort: async () => board } });
  const s = await import('../src/device/session.js?alignment');

  const got: Float32Array[] = [];
  s.subscribeFrames((c: Float32Array) => got.push(c));
  await s.connectRadar();
  await s.startRadar();
  const t0 = Date.now();
  while (got.length < 3 && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 20));
  const stats = s.radarStats();
  await s.disconnectRadar();
  // the diagnostics name the cause: one packet skipped by the counter
  assert.equal(stats.diagnostics.packet_gap, 1);
  assert.equal(stats.diagnostics.packets_lost, 1);
  assert.equal(stats.restarts, 1);

  got.forEach((c, i) => {
    const match = truth.findIndex(t => t.length === c.length && t.every((v, j) => v === c[j]));
    assert.ok(match >= 0, `delivered frame ${i} of ${got.length} is not one of the frames the board sent (misaligned)`);
  });
  assert.ok(got.length >= 3, `only ${got.length} frames delivered`);
  assert.equal(s.radarStats().drops, 1);
}, 15000);
