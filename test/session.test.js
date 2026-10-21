// The session split (connect, start, stop, start again, disconnect) against
// the simulated board, with navigator.serial replaced by a picker that
// returns it.

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { FakeBoard } from './fake_board.js';
import { unpackPacked12, rawToCube } from '../src/device/unpack.js';

test('session: connect does the handshake only; start and stop control streaming', async () => {
  const frameBytes = new Uint8Array(147456).map((_, i) => (i * 3 + 7) & 0xFF);
  const board = new FakeBoard(frameBytes);
  Object.defineProperty(globalThis.navigator, 'serial', { configurable: true, value: { requestPort: async () => board } });
  const s = await import('../src/device/session.js');

  const states = [];
  s.onRadarState(st => states.push(st));
  const frames = [];
  let gotFrame;
  s.subscribeFrames(cube => { frames.push(cube); gotFrame?.(); });
  const nextFrame = () => new Promise(res => { gotFrame = res; });

  const info = await s.connectRadar();
  assert.equal(info.board, 'Radar Baseboard MCU7');
  assert.equal(info.firmware, '2.9.0');
  assert.ok(s.isConnected());
  assert.ok(!s.isStreaming());
  assert.equal(frames.length, 0);
  assert.equal(board.triggers ?? 0, 0, 'connect must not start the radar');

  const expected = rawToCube(unpackPacked12(frameBytes), 3, 128, 256);
  let wait = nextFrame();
  assert.equal(await s.startRadar(), true);
  await wait;
  assert.deepEqual(frames[0], expected);

  await s.stopRadar();
  assert.ok(!s.isStreaming());
  assert.ok(s.isConnected());

  wait = nextFrame();
  assert.equal(await s.startRadar(), true);
  await wait;
  assert.equal(frames.length, 2);
  assert.equal(board.triggers, 2);

  await s.disconnectRadar();
  assert.ok(!s.isConnected());
  assert.equal(s.boardInfo(), null);
  assert.deepEqual(states.map(st => [st.connected, st.streaming]), [
    [false, false], [true, false], [true, true], [true, false], [true, true], [false, false],
  ]);
});
