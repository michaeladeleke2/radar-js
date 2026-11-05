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

async function run(chunk: number, load: () => Promise<any>) {
  const board = new FakeBoard(frameOf(1));
  board.frameList = [frameOf(1), frameOf(2), frameOf(3)];
  // frame 1 loses 512 bytes from the payload of its first packet (header 6 bytes)
  board.cut = { trigger: 1, frame: 1, at: 1000, bytes: 512, chunk };
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
  assert.equal(t.declared_bytes, 4092);
  assert.equal(t.next_header_at, 4092 - 512);
  assert.deepEqual(t.gap_window, [t.offset + 6, t.offset + 4092 - 512]);
  assert.deepEqual(t.chunk_starts_in_window, []);
  assert.equal(t.gap_inside_one_chunk, true);
  assert.ok(t.chunks.length >= 1 && t.last_chunks.length >= 1);
  // the stream offsets agree with the bytes the link read
  assert.ok(t.offset < t.bytes_read);
  // the loss after the CRC error is a sync loss, traced too
  assert.ok(stats.lossTraces.some((x: { kind: string }) => x.kind === 'sync_lost'));
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
