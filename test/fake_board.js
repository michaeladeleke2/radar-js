// A simulated MCU7 board for the device and session tests (moved here from
// device.test.js, unchanged, so both tests can use it).

import assert from 'node:assert/strict';
import { crc16 } from '../src/device/crc16.js';

export const withCrc = bytes => { const c = crc16(bytes); return Uint8Array.from([...bytes, c >> 8, c & 0xFF]); };

// A fake Web Serial port that behaves like the MCU7 firmware for the requests we send.
export class FakeBoard {
  constructor(frameBytes) {
    this.frameBytes = frameBytes;
    this.requests = [];
    this.counter = 0x1234;
    this.inbox = [];
    const self = this;
    this.readable = new ReadableStream({ start(c) { self.rx = c; } });
    this.writable = new WritableStream({ write(chunk) { self.inbox.push(...chunk); self.handle(); } });
  }
  async open(opts) { this.openOpts = opts; }
  async close() {}
  send(bytes) { this.rx.enqueue(Uint8Array.from(bytes)); }

  handle() {
    for (;;) {
      if (this.inbox.length < 8) return;
      const [type, req, wv0, wv1, wi0, wi1, wl0, wl1] = this.inbox;
      const wLength = wl0 | (wl1 << 8);
      const payloadLen = type === 0xC0 ? 0 : wLength;
      if (this.inbox.length < 8 + payloadLen + 2) return;
      const raw = Uint8Array.from(this.inbox.splice(0, 8 + payloadLen + 2));
      assert.equal(crc16(raw), 0, 'request CRC');
      const r = { type, req, wValue: wv0 | (wv1 << 8), wIndex: wi0 | (wi1 << 8), wLength, payload: raw.subarray(8, 8 + payloadLen), raw };
      this.requests.push(r);
      this.respond(r);
    }
  }

  respond(r) {
    let payload = [];
    if (r.type === 0xC0 && r.req === 0x80 && r.wValue === 0x01) payload = [2, 0, 9, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0];
    if (r.type === 0x43 && r.req === 0x80 && r.wValue === 0x00) payload = [0x8B, 0x05, 0x51, 0x02, ...new TextEncoder().encode('Radar Baseboard MCU7'), 0];
    if (r.type === 0x43 && r.req === 0x20 && r.wIndex === 0x0130) {
      // SPI transfer: CHIP_ID read returns 0x000303, little endian per word
      payload = [];
      for (let i = 0; i < r.payload.length; i += 4) payload.push(0x03, 0x03, 0x00, 0x00);
    }
    this.send(withCrc([r.type, 0, payload.length & 0xFF, payload.length >> 8, ...payload]));
    // The trigger word (MAIN with FRAME_START) starts the radar: stream one frame.
    if (r.type === 0x40 && r.req === 0x20 && r.wIndex === 0x0130) {
      const last = r.payload.subarray(r.payload.length - 4);
      if (last[0] === 0x01 && (last[3] & 1)) {
        this.triggers = (this.triggers || 0) + 1;
        setTimeout(() => (this.overflowOnTrigger === this.triggers ? this.sendOverflow() : this.streamFrame()), 0);
      }
    }
  }

  // An error data packet carrying E_OVERFLOW, as the firmware reports a FIFO overflow
  sendOverflow() {
    const c = this.counter++ & 0xFFFF;
    this.send(withCrc([0xDB, 0, c & 0xFF, c >> 8, 4, 0, 0x07, 0, 0, 0]));
  }

  streamFrame() {
    const sliceBytes = 12288;
    for (let s = 0; s < this.frameBytes.length; s += sliceBytes) {
      const slice = this.frameBytes.subarray(s, s + sliceBytes);
      for (let p = 0; p < slice.length; p += 4084) {
        const chunk = slice.subarray(p, p + 4084);
        const type = 0xD0 | (p === 0 ? 1 : 0) | (p + 4084 >= slice.length ? 2 : 0);
        const c = this.counter++ & 0xFFFF;
        this.send(withCrc([type, 0, c & 0xFF, c >> 8, chunk.length & 0xFF, chunk.length >> 8, ...chunk]));
      }
    }
  }
}

