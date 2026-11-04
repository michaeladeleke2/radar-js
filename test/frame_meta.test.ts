// The device frame metadata radar-js adds (strata.js, device.js, session.js):
// each frame carries the 16-bit packet counter of its first data packet, which
// steps by the same amount every frame (the packets per frame), and the
// firmware timestamp when the firmware sends one.

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { FakeBoard } from './fake_board.js';
import { RadarDevice } from '../src/device/device.js';
import { SliceAssembler } from '../src/device/strata.js';

test('RadarDevice: each frame reports the counter of its first packet', async () => {
  const board = new FakeBoard(new Uint8Array(147456).map((_, i) => i & 0xFF));
  const dev = new RadarDevice(board);
  await dev.open();
  await dev.start();
  await dev.nextFrame();
  const first = dev.lastFrameMeta;
  assert.equal(first.counter, 0x1234);                 // FakeBoard's first data packet
  assert.equal(first.timestamp, 0n);                    // FakeBoard sends no timestamp flag
  await dev.close();
});

test('SliceAssembler passes the first packet counter and a firmware timestamp', () => {
  const slices: { counter: number; timestamp: bigint }[] = [];
  const asm = new SliceAssembler(4, { onSlice: s => slices.push(s), onError: () => {} });
  // FIRST packet (counter 100) with 4 bytes, LAST+TIMESTAMP packet (counter 101) with 8 timestamp bytes
  asm.push({ type: 0xD1, channel: 0, counter: 100, payload: Uint8Array.of(1, 2, 3, 4), crcOk: true });
  asm.push({ type: 0xD6, channel: 0, counter: 101, payload: Uint8Array.of(0x10, 0x27, 0, 0, 0, 0, 0, 0), crcOk: true });
  assert.equal(slices.length, 1);
  assert.equal(slices[0].counter, 100);
  assert.equal(slices[0].timestamp, 10000n);
});
