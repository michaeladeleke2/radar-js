// End-to-end test of RadarDevice against a simulated board: request framing,
// the open/start/stop command sequence, data packet reassembly and frame decode.

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { FakeBoard } from './fake_board.js';
import { RadarDevice } from '../src/device/device.js';
import { unpackPacked12, rawToCube } from '../src/device/unpack.js';

const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join(' ');

test('RadarDevice: open, start, one frame, stop against a simulated board', async () => {
  const frameBytes = new Uint8Array(147456);
  for (let i = 0; i < frameBytes.length; i++) frameBytes[i] = (i * 7 + 3) & 0xFF;
  const board = new FakeBoard(frameBytes);
  const dev = new RadarDevice(board);

  const info = await dev.open();
  assert.equal(board.openOpts.baudRate, 921600);
  assert.equal(info.firmware, '2.9.0');
  assert.ok(info.chip.isBGT60TR13C);
  assert.equal(info.board, 'Radar Baseboard MCU7');

  await dev.start();
  const cube = await dev.nextFrame();
  const expected = rawToCube(unpackPacked12(frameBytes), 3, 128, 256);
  assert.deepEqual(cube, expected);

  await dev.close();

  const seq = board.requests.map(r => `${r.type.toString(16)} req=${r.req.toString(16)} wValue=${r.wValue.toString(16)} wIndex=${r.wIndex.toString(16)} len=${r.wLength}`);
  // The command sequence, in order
  assert.deepEqual(seq, [
    'c0 req=80 wValue=1 wIndex=0 len=16',          // version info (protocol check)
    '43 req=80 wValue=0 wIndex=0 len=0',           // board info (name), radar-js addition
    '40 req=20 wValue=103 wIndex=520 len=0',       // pins reset sequence
    '40 req=20 wValue=103 wIndex=130 len=4',       // SPI write SFCTL
    '43 req=20 wValue=103 wIndex=130 len=4',       // SPI read CHIP_ID
    '40 req=d wValue=1 wIndex=0 len=12',           // data configure
    '40 req=d wValue=3 wIndex=0 len=0',            // data start
    '40 req=20 wValue=103 wIndex=130 len=152',     // 38 registers, MAIN + trigger last
    '40 req=d wValue=4 wIndex=0 len=0',            // data stop
    '40 req=20 wValue=103 wIndex=130 len=4',       // soft reset
  ]);
  if (process.env.SHOW_BYTES) for (const r of board.requests) console.log(hex(r.raw));
});

test('RadarDevice: a FIFO overflow raises FifoOverflow, and restart() streams again', async () => {
  const { FifoOverflow } = await import('../src/device/device.js');
  const frameBytes = new Uint8Array(147456).map((_, i) => (i * 5 + 1) & 0xFF);
  const board = new FakeBoard(frameBytes);
  board.overflowOnTrigger = 1;                 // the first start reports an overflow
  const dev = new RadarDevice(board);
  await dev.open();
  await dev.start();
  await assert.rejects(dev.nextFrame(), FifoOverflow);
  await dev.restart();                         // data stop, soft reset, configure, start, registers
  const cube = await dev.nextFrame();
  assert.deepEqual(cube, rawToCube(unpackPacked12(frameBytes), 3, 128, 256));
  await dev.close();
  const kinds = board.requests.map(r => `${r.req.toString(16)}:${r.wValue.toString(16)}`);
  assert.equal(kinds.filter(k => k === 'd:3').length, 2, 'data started twice');
  assert.equal(kinds.filter(k => k === 'd:4').length, 2, 'data stopped twice (restart, close)');
});

test('RadarDevice: restart() still starts again when the board does not answer the stop', async () => {
  const frameBytes = new Uint8Array(147456).map((_, i) => (i * 3 + 7) & 0xFF);
  const board = new FakeBoard(frameBytes);
  const dev = new RadarDevice(board);
  await dev.open();
  await dev.start();
  await dev.nextFrame();
  // The next data stop gets no reply, as when the reply is lost behind a backlog
  const respond = board.respond.bind(board);
  let swallowed = false;
  board.respond = r => { if (!swallowed && r.req === 0x0d && r.wValue === 4) { swallowed = true; return; } respond(r); };
  await dev.restart();
  assert.ok(swallowed);
  const cube = await dev.nextFrame();
  assert.deepEqual(cube, rawToCube(unpackPacked12(frameBytes), 3, 128, 256));
  await dev.close();
});
