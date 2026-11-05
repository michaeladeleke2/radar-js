// The loss trace (src/device/link.js): a CRC error from missing bytes is
// traced with how many bytes went missing and the stream window they were in,
// placed against the read() chunks the page received.
//
// Added 2026-11-05 to find where the CRC-error drops seen with radar-js (and
// not with the Infineon SDK on the same board and hub) lose their bytes.

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { FakeBoard } from './fake_board.js';
import { PacketParser } from '../src/device/link.js';

const FRAME_BYTES = 147456;
const frameOf = (seed: number) => new Uint8Array(FRAME_BYTES).map((_, i) => (i * 7 + seed * 31 + ((i >> 9) * seed)) & 0xFF);

type Cut = { at: number; bytes?: number; insert?: number; chunk: number };
// default: frame 1 loses 512 bytes from the payload of its first packet (header 6 bytes)
async function run(chunk: number, load: () => Promise<any>, cut: Cut = { at: 1000, bytes: 512, chunk }) {
  const board = new FakeBoard(frameOf(1));
  board.frameList = [frameOf(1), frameOf(2), frameOf(3)];
  board.cut = { trigger: 1, frame: 1, ...cut };
  Object.defineProperty(globalThis.navigator, 'serial', { configurable: true, value: { requestPort: async () => board } });
  const s = await load();
  const got: Float32Array[] = [];
  s.subscribeFrames((c: Float32Array) => got.push(c));
  await s.connectRadar();
  await s.startRadar();
  const t0 = Date.now();
  while (got.length < 3 && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 20));
  const stats = s.radarStats();
  await s.disconnectRadar();
  return stats;
}

test('loss trace: bytes lost inside one received chunk are placed inside it', async () => {
  const stats = await run(0, () => import('../src/device/session.js?trace-one-chunk'));
  // after the loss the parser reads a "packet" from payload bytes (a length past
  // the largest packet): traced too, but marked as not a plausible header
  const crc = stats.lossTraces.filter((t: { kind: string; header_plausible: boolean }) => t.kind === 'crc_error' && t.header_plausible);
  assert.equal(stats.diagnostics.crc_error, 1);
  assert.equal(crc.length, 1);
  const t = crc[0];
  assert.equal(t.bytes_missing, 512);
  assert.equal(t.bytes_inserted, null);
  assert.equal(t.shift, -512);
  assert.equal(t.counter_step, 1);
  assert.equal(t.declared_bytes, 4092);
  assert.equal(t.next_header_at, 4092 - 512);
  assert.equal(t.bytes_hex.length, 2 * 4092);
  assert.equal(t.after_hex.length, 2 * 256);
  assert.deepEqual(t.gap_window, [t.offset + 6, t.offset + 4092 - 512]);
  assert.deepEqual(t.chunk_starts_in_window, []);
  assert.equal(t.gap_inside_one_chunk, true);
  assert.ok(t.chunks.length >= 1 && t.last_chunks.length >= 1);
  // the stream offsets agree with the bytes the link read
  assert.ok(t.offset < t.bytes_read);
  // the loss after the CRC error is a sync loss, traced too, with where the stream was picked up again
  const sync = stats.lossTraces.find((x: { kind: string }) => x.kind === 'sync_lost');
  assert.ok(sync);
  assert.ok(sync.resync && sync.resync.offset > sync.offset && sync.resync.bytes_skipped === sync.resync.offset - sync.offset);
}, 15000);

test('loss trace: added bytes give a positive shift', async () => {
  // 37 bytes of the first packet's payload sent twice (as on the board: the
  // stream picked up 37 bytes past the bad packet's end)
  const stats = await run(0, () => import('../src/device/session.js?trace-inserted'), { at: 1000, insert: 37, chunk: 0 });
  const t = stats.lossTraces.find((x: { kind: string; header_plausible: boolean }) => x.kind === 'crc_error' && x.header_plausible);
  assert.ok(t, 'a crc_error trace');
  assert.equal(t.next_header_at, 4092 + 37);
  assert.equal(t.shift, 37);
  assert.equal(t.bytes_inserted, 37);
  assert.equal(t.bytes_missing, null);
  assert.equal(t.counter_step, 1);
  // the repeat is in the saved bytes: payload bytes 994..1030 appear twice
  const b = Buffer.from(t.bytes_hex, 'hex');
  assert.deepEqual(b.subarray(1000, 1037), b.subarray(963, 1000));
}, 15000);

test('loss trace: a loss that takes the next header too shows a counter step over 1', async () => {
  // 2000 bytes from 3000: the end of packet 0 and the header of packet 1 (at 4092)
  const stats = await run(0, () => import('../src/device/session.js?trace-spanning'), { at: 3000, bytes: 2000, chunk: 0 });
  const t = stats.lossTraces.find((x: { kind: string; header_plausible: boolean }) => x.kind === 'crc_error' && x.header_plausible);
  assert.ok(t, 'a crc_error trace');
  assert.equal(t.counter_step, 2);
  assert.equal(t.next_header_at, 2 * 4092 - 2000);   // packet 2 starts at 8184 originally
  assert.equal(t.bytes_missing, null);
  assert.equal(t.bytes_inserted, null);
}, 15000);

test('loss trace: with chunk boundaries in the window, the gap is not claimed to be inside one chunk', async () => {
  const stats = await run(500, () => import('../src/device/session.js?trace-chunked'));
  const t = stats.lossTraces.find((x: { kind: string; header_plausible: boolean }) => x.kind === 'crc_error' && x.header_plausible);
  assert.ok(t, 'a crc_error trace');
  assert.equal(t.bytes_missing, 512);
  assert.equal(t.gap_inside_one_chunk, false);
  assert.ok(t.chunk_starts_in_window.length > 0);
  for (const b of t.chunk_starts_in_window) assert.ok(b >= t.gap_window[0] && b <= t.gap_window[1]);
  for (const c of t.chunks) if (c.start + c.bytes > t.gap_window[0] && c.start <= t.gap_window[1]) assert.ok(c.bytes <= 500);
}, 15000);

test('packet parser: stream offsets of packets, across a sync loss and a clear', () => {
  const seen: { offset: number }[] = [];
  const lost: number[] = [];
  const parser = new PacketParser({ onControl: () => {}, onData: p => seen.push(p), onSyncLost: (_h, o) => lost.push(o) });
  const pkt = (len: number) => [0xD0, 0, 0, 0, len & 0xFF, len >> 8, ...new Array(len).fill(1), 0, 0];
  parser.push(Uint8Array.from(pkt(10)));                 // 18 bytes at 0
  parser.push(Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x55]));   // junk at 18: sync lost, 5 bytes dropped
  parser.push(Uint8Array.from(pkt(4)));                  // 12 bytes at 23
  parser.push(Uint8Array.from([0xD0, 0, 0]));            // partial header at 35, then cleared
  parser.clear();
  parser.push(Uint8Array.from(pkt(2)));                  // 10 bytes at 38
  assert.deepEqual(seen.map(p => p.offset), [0, 23, 38]);
  assert.deepEqual(lost, [18]);
  assert.equal(parser.offset, 48);
});
