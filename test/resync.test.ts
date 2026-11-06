// Resynchronisation after a sync loss (src/device/link.js PacketParser).
//
// After bytes are lost on the link the parser is in the middle of a packet.
// It looks for the next packet start in the bytes it has, and accepts one
// only when the whole packet is there and its CRC passes, so payload bytes
// that look like a header are not taken for a packet, and a reply further on
// is not thrown away (before 2026-11-06 a sync loss dropped everything
// buffered, which lost the restart's replies: 1 s timeouts,
// docs/soak-test-2026-11-06.md).

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { PacketParser } from '../src/device/link.js';
import { crc16 } from '../src/device/crc16.js';
import { FakeBoard, withCrc } from './fake_board.js';

const dataPacket = (type: number, ch: number, counter: number, payload: number[]) =>
  Array.from(withCrc([type, ch, counter & 0xFF, counter >> 8, payload.length & 0xFF, payload.length >> 8, ...payload]));
const controlPacket = (type: number, status: number, payload: number[]) =>
  Array.from(withCrc([type, status, payload.length & 0xFF, payload.length >> 8, ...payload]));
const bytes = (n: number, seed: number) => Array.from({ length: n }, (_, i) => (i * 37 + seed * 101 + (i >> 3)) & 0x7F);   // never a packet type

function parse(stream: number[], chunk: number) {
  const data: { counter: number; offset: number; crcOk: boolean }[] = [], control: { type: number; payload: number[]; crcOk: boolean }[] = [];
  let lost = 0;
  const parser = new PacketParser({
    onControl: p => control.push({ type: p.type, payload: [...p.payload], crcOk: p.crcOk }),
    onData: p => data.push({ counter: p.counter, offset: p.offset, crcOk: p.crcOk }),
    onSyncLost: () => lost++,
  });
  const u = Uint8Array.from(stream);
  for (let i = 0; i < u.length; i += chunk) parser.push(u.subarray(i, i + chunk));
  return { data, control, lost, parser };
}

// Payload bytes with a header in them: a data packet start (type 0xD0, the
// stream's channel, the next counter, a small length) whose CRC does not pass.
function fakeHeader(counter: number, wLength: number) {
  const fake = [0xD0, 0, counter & 0xFF, counter >> 8, wLength & 0xFF, wLength >> 8, ...bytes(wLength, 7), 0x12, 0x34];
  assert.notEqual(crc16(Uint8Array.from(fake)), 0, 'the fake packet must fail its CRC');
  return fake;
}

const CHUNKS = [1, 2, 3, 7, 64, 1 << 20];

test('resync: a header inside payload bytes is not taken for a packet', () => {
  const A = dataPacket(0xD1, 0, 1, bytes(20, 1));
  const Q = dataPacket(0xD0, 0, 3, bytes(30, 2)), R = controlPacket(0xC0, 0, [9, 9]), S = dataPacket(0xD2, 0, 4, bytes(10, 3));
  // A, then the stream picks up inside a payload (bytes lost) that holds a fake header, then Q, a reply R and S
  const misaligned = [...bytes(13, 4), ...fakeHeader(2, 8), ...bytes(5, 5)];
  const stream = [...A, ...misaligned, ...Q, ...R, ...S];
  for (const chunk of CHUNKS) {
    const { data, control, lost, parser } = parse(stream, chunk);
    assert.deepEqual(data.map(d => [d.counter, d.crcOk]), [[1, true], [3, true], [4, true]], `chunk ${chunk}`);
    assert.deepEqual(data.map(d => d.offset), [0, A.length + misaligned.length, A.length + misaligned.length + Q.length + R.length]);
    assert.deepEqual(control, [{ type: 0xC0, payload: [9, 9], crcOk: true }]);
    assert.equal(lost, 1, 'one sync loss for the one place the stream was out of step');
    assert.equal(parser.resyncSkipped, misaligned.length);
    assert.equal(parser.offset, stream.length);
  }
});

test('resync: a fake header claiming a long packet does not hold up a reply that ends the stream', () => {
  // the fake says 4000 bytes follow; only Q and the reply do, then the stream goes quiet
  const fake = [0xD0, 0, 2, 0, 4000 & 0xFF, 4000 >> 8, ...bytes(40, 6)];
  const Q = dataPacket(0xD0, 0, 3, bytes(30, 2)), R = controlPacket(0x40, 0, []);
  const stream = [...bytes(9, 8), ...fake, ...Q, ...R];
  for (const chunk of CHUNKS) {
    const { data, control } = parse(stream, chunk);
    assert.deepEqual(data.map(d => d.counter), [3], `chunk ${chunk}`);
    assert.deepEqual(control.map(c => c.type), [0x40], `chunk ${chunk}: the reply arrives`);
  }
});

test('resync: a packet whose CRC fails is not a resync point; the next good one is', () => {
  const bad = dataPacket(0xD0, 0, 2, bytes(16, 9)); bad[10] ^= 0x55;   // header intact, payload corrupt
  const Q = dataPacket(0xD0, 0, 3, bytes(16, 2));
  const stream = [...bytes(6, 1), ...bad, ...Q];
  for (const chunk of CHUNKS) {
    const { data, lost } = parse(stream, chunk);
    assert.deepEqual(data.map(d => [d.counter, d.crcOk]), [[3, true]], `chunk ${chunk}`);
    assert.equal(lost, 1);
  }
});

test('resync: a header with a length no packet has is a sync loss, not a 64 kB wait', () => {
  const huge = [0xD0, 0, 1, 0, 0xF4, 0xF3, ...bytes(20, 3)];   // 62452 bytes claimed (seen on the board)
  const Q = dataPacket(0xD0, 0, 2, bytes(12, 2));
  const { data, lost } = parse([...huge, ...Q], 5);
  assert.deepEqual(data.map(d => d.counter), [2]);
  assert.equal(lost, 1);
});

test('without a loss, packets parse exactly as before (every chunking)', () => {
  const stream = [...dataPacket(0xD1, 0, 7, [1, 2, 3, 4]), ...controlPacket(0x40, 0, []), ...dataPacket(0xD2, 0, 8, [5, 6])];
  for (const chunk of CHUNKS) {
    const { data, control, lost, parser } = parse(stream, chunk);
    assert.deepEqual(data.map(d => [d.counter, d.crcOk, d.offset]), [[7, true, 0], [8, true, 18]]);
    assert.equal(control.length, 1);
    assert.equal(lost, 0);
    assert.equal(parser.resyncSkipped, 0);
  }
});

test('session: after lost bytes, the restart\'s reply behind misaligned bytes is found (no 1 s timeout)', async () => {
  const FRAME = 147456;
  const frameOf = (seed: number) => new Uint8Array(FRAME).map((_, i) => (i * 7 + seed * 31 + ((i >> 9) * seed)) & 0xFF);
  const board = new FakeBoard(frameOf(1));
  board.frameList = [frameOf(1), frameOf(2), frameOf(3)];
  board.cut = { trigger: 1, frame: 1, at: 1000, bytes: 512, chunk: 0 };   // bytes lost in frame 1
  // the reply to the next commands (the restart's data stop, ...) comes right behind bytes from mid-packet
  board.junkBeforeReply = Array.from(frameOf(4).subarray(5000, 5300));
  const sendFrame = board.streamFrame.bind(board);
  board.streamFrame = (...a: unknown[]) => { const r = sendFrame(...(a as [])); if ((a as unknown[])[2]) board.junkRepliesLeft = 3; return r; };
  Object.defineProperty(globalThis.navigator, 'serial', { configurable: true, value: { requestPort: async () => board } });
  const s = await import('../src/device/session.js?resync');
  const got: number[] = [];
  s.subscribeFrames(() => got.push(Date.now()));
  await s.connectRadar();
  const t0 = Date.now();
  await s.startRadar();
  while (got.length < 3 && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 10));
  const stats = s.radarStats();
  await s.disconnectRadar();
  assert.ok(got.length >= 3, `${got.length} frames`);
  assert.equal(stats.drops, 1);
  assert.equal(stats.restarts, 1);
  assert.ok(board.junkRepliesLeft < 3, 'the junk was sent in front of a reply');
  assert.ok(got[got.length - 1] - t0 < 900, `restart took ${got[got.length - 1] - t0} ms: a reply was lost and timed out`);
}, 15000);
