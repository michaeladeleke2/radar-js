// STRATA DERIVED: packet framing and control/data dispatch ported from
// Strata platform/serial/BridgeSerial.cpp (Infineon Evaluation Software License).
// Publishing permitted (permission confirmed 2026-10-05). See LICENSING.md.
//
// Serial link to the board. Starts from the Step 1 Link class, with the byte
// queue replaced by a packet parser, because once data is started control
// responses and data packets share one stream.
//
// Control response: bmReqType(echo), bStatus, wLength(LE), payload, CRC16(BE)
// Data packet:      bmPktType(0xDx), bChannel, wCounter(LE), wLength(LE), payload, CRC16(BE)
// Request:          bmReqType, bRequest, wValue(LE), wIndex(LE), wLength(LE), payload, CRC16(BE)

import { crc16 } from './crc16.js';

export const VENDOR_REQ_WRITE = 0x40;
export const VENDOR_REQ_READ = 0xC0;
export const VENDOR_REQ_TRANSFER = 0x43;
export const DATA_FRAME_PACKET = 0xD0;

export const DEFAULT_BAUD = 921600;   // same order the SDK tries
export const FALLBACK_BAUD = 1000000;
export const TIMEOUT_MS = 1000;       // BridgeSerial defaultTimeout
// While bytes are still arriving (a backlog of radar data queued in front of
// the reply after the page was busy), a reply is waited for up to this long.
export const BACKLOG_TIMEOUT_MS = 10000;

// SERIAL_MAX_PACKET_SIZE (universal/link_definitions.h)
export const MAX_PACKET_SIZE = 1024 * 4 - 1;
const COMMAND_HEADER_SIZE = 8;
const RESPONSE_HEADER_SIZE = 4;
const DATA_HEADER_SIZE = 6;
const CRC_SIZE = 2;
// radar-js: loss trace sizes (read() chunks remembered, traces kept, chunks listed per trace)
const CHUNK_HISTORY = 512, TRACE_LIMIT = 100, TRACE_LAST_CHUNKS = 20;
// radar-js: stream bytes kept for the trace, bytes looked at past a bad packet, and of those saved as hex
const TAIL_BYTES = 1 << 18, TRACE_LOOKAHEAD = 8192, TRACE_AFTER_HEX = 256;
// BridgeSerial::getMaxTransfer()
export const MAX_TRANSFER = MAX_PACKET_SIZE - COMMAND_HEADER_SIZE - CRC_SIZE;

export const STATUS_NAMES = {
  0x80: 'header incomplete', 0x81: 'payload incomplete', 0x82: 'payload too long',
  0x83: 'payload fragmented', 0x84: 'CRC error', 0x85: 'request type invalid',
  0x86: 'request invalid', 0x87: 'not implemented', 0x88: 'wLength invalid',
  0x89: 'wValue invalid', 0x8A: 'wIndex invalid', 0x8B: 'payload invalid', 0x8C: 'not available'
};

export const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ');

const isControlType = t => t === VENDOR_REQ_READ || t === VENDOR_REQ_WRITE || t === VENDOR_REQ_TRANSFER;

// Growable byte FIFO. Data arrives at about 1.5 MB/s, so no per-byte arrays.
export class ByteQueue {
  constructor(capacity = 1 << 16) { this.buf = new Uint8Array(capacity); this.start = 0; this.end = 0; }
  get length() { return this.end - this.start; }
  push(bytes) {
    if (this.end + bytes.length > this.buf.length) {
      const live = this.length;
      if (live + bytes.length > this.buf.length) {
        let cap = this.buf.length;
        while (cap < live + bytes.length) cap *= 2;
        const next = new Uint8Array(cap);
        next.set(this.buf.subarray(this.start, this.end));
        this.buf = next;
      } else {
        this.buf.copyWithin(0, this.start, this.end);
      }
      this.start = 0; this.end = live;
    }
    this.buf.set(bytes, this.end);
    this.end += bytes.length;
  }
  peek(i) { return this.buf[this.start + i]; }
  take(n) { const out = this.buf.slice(this.start, this.start + n); this.start += n; if (this.start === this.end) this.start = this.end = 0; return out; }
  clear() { this.start = this.end = 0; }
}

// Splits the byte stream into packets. Pure logic, no I/O, so it can be tested.
// onControl(packet) and onData(packet) receive whole packets with the CRC checked.
export class PacketParser {
  constructor({ onControl, onData, onSyncLost }) {
    this.queue = new ByteQueue();
    this.onControl = onControl;
    this.onData = onData;
    this.onSyncLost = onSyncLost;
    this.offset = 0;   // radar-js: stream position of the queue's first byte (bytes pushed and consumed so far)
  }

  // radar-js: drop what is buffered, keeping the stream position
  clear() { this.offset += this.queue.length; this.queue.clear(); }

  push(bytes) {
    this.queue.push(bytes);
    const q = this.queue;
    for (;;) {
      if (q.length < 4) return;
      const type = q.peek(0);
      if ((type & 0xF0) === DATA_FRAME_PACKET) {
        if (q.length < DATA_HEADER_SIZE) return;
        const wLength = q.peek(4) | (q.peek(5) << 8);
        const total = DATA_HEADER_SIZE + wLength + CRC_SIZE;
        if (q.length < total) return;
        const offset = this.offset;
        const raw = q.take(total);
        this.offset += total;
        this.onData({
          offset, raw,   // radar-js: for the loss trace
          type,
          channel: raw[1],
          counter: raw[2] | (raw[3] << 8),
          payload: raw.subarray(DATA_HEADER_SIZE, DATA_HEADER_SIZE + wLength),
          crcOk: crc16(raw) === 0,
        });
      } else if (isControlType(type)) {
        const wLength = q.peek(2) | (q.peek(3) << 8);
        const total = RESPONSE_HEADER_SIZE + wLength + CRC_SIZE;
        if (q.length < total) return;
        const raw = q.take(total);
        this.offset += total;
        this.onControl({
          type,
          status: raw[1],
          payload: raw.subarray(RESPONSE_HEADER_SIZE, RESPONSE_HEADER_SIZE + wLength),
          crcOk: crc16(raw) === 0,
          raw,
        });
      } else {
        // BridgeSerial::readPacketStart: unknown packet type, synchronization lost.
        // The SDK marks the link for resynchronisation and clears the input
        // buffer before the next command; we drop what is buffered now.
        const offset = this.offset;
        const head = q.take(Math.min(4, q.length));
        this.clear();
        this.offset += head.length;
        if (this.onSyncLost) this.onSyncLost(head, offset);
      }
    }
  }
}

export class Link {
  // port: a Web Serial SerialPort (or anything with the same open/readable/writable shape)
  constructor(port, { log = () => {} } = {}) {
    this.port = port;
    this.log = log;
    this.closed = true;
    this.pending = null;           // the one outstanding command, as in BridgeSerial
    this.lastRx = 0;               // performance.now() of the last bytes read
    this.onData = null;            // set by the data path; data packets are dropped while null
    this.parser = new PacketParser({
      onControl: p => this._onControl(p),
      onData: p => {   // radar-js: loss trace
        if (!p.crcOk) this._traceCrc(p);
        else if (this.awaitingResync.length) this._resynced(p);
        if (this.onData) this.onData(p);
      },
      onSyncLost: (head, offset) => {   // radar-js: counted and traced
        this.syncLost = (this.syncLost || 0) + 1;
        const trace = { kind: 'sync_lost', offset, head: hex(head), resync: null };
        this.awaitingResync.push(trace);
        this._pushTrace(trace);
        this.log('Sync lost, unknown packet start ' + hex(head));
      },
    });
    // radar-js: loss trace. Every read() chunk's stream position, size and
    // time (the last CHUNK_HISTORY), the last TAIL_BYTES of the stream itself,
    // and a record of each CRC error and sync loss (the last TRACE_LIMIT), so
    // a loss can be placed against the reads and its bytes looked at.
    this.bytesRead = 0;
    this.chunks = [];
    this.tail = new Uint8Array(TAIL_BYTES);   // stream byte x is at x % TAIL_BYTES while x >= bytesRead - TAIL_BYTES
    this.traces = [];
    this.traceSeq = 0;
    this.pendingCrc = [];       // CRC traces still waiting for the bytes after the bad packet
    this.awaitingResync = [];   // sync-loss traces waiting for the next good data packet
  }

  // radar-js: stream bytes [from, to) from the tail, or as much of it as is still held
  _bytes(from, to) {
    from = Math.max(from, this.bytesRead - TAIL_BYTES);
    to = Math.min(to, this.bytesRead);
    const out = new Uint8Array(Math.max(0, to - from));
    for (let i = 0; i < out.length; i++) out[i] = this.tail[(from + i) % TAIL_BYTES];
    return out;
  }

  _keep(bytes) {
    const skip = Math.max(0, bytes.length - TAIL_BYTES);
    let src = bytes.subarray(skip), at = (this.bytesRead + skip) % TAIL_BYTES;
    while (src.length) {
      const n = Math.min(src.length, TAIL_BYTES - at);
      this.tail.set(src.subarray(0, n), at);
      src = src.subarray(n); at = 0;
    }
  }

  // radar-js: a CRC error on a data packet. The next packet's header (same
  // channel, counter + 1 to + 8) is looked for inside the bad packet and in
  // the bytes after it. Where it sits against where it should be (right
  // after the bad packet's declared length) is the shift: negative, that many
  // bytes are missing; positive, that many bytes were added; a counter step
  // over 1 means whole packets vanished too. The bytes changed somewhere
  // between this packet's header and that next header (gap_window); if no
  // read() chunk starts inside that window, they were already wrong within a
  // single chunk the page received, i.e. before the page read them.
  _traceCrc(p) {
    const trace = { kind: 'crc_error', offset: p.offset, counter: p.counter, channel: p.channel, declared_bytes: p.raw.length,
      // header_plausible false: a "packet" read from payload bytes after an earlier loss (length past the largest packet)
      header_plausible: p.raw.length <= MAX_PACKET_SIZE, next_header_at: null, complete: false };
    this._pushTrace(trace);
    if (trace.header_plausible) { this.pendingCrc.push(trace); this._completeCrc(); }
    else this._finishCrc(trace);
  }

  _completeCrc(force = false) {
    this.pendingCrc = this.pendingCrc.filter(t => {
      if (!force && this.bytesRead < t.offset + t.declared_bytes + TRACE_LOOKAHEAD) return true;
      this._finishCrc(t);
      return false;
    });
  }

  _finishCrc(t) {
    const end = t.offset + t.declared_bytes;
    const bytes = this._bytes(t.offset, end + TRACE_LOOKAHEAD);
    let at = -1, step = 0;
    for (let i = DATA_HEADER_SIZE; i + 5 < bytes.length && at < 0; i++) {
      if ((bytes[i] & 0xF0) !== DATA_FRAME_PACKET || bytes[i + 1] !== t.channel) continue;
      const k = ((bytes[i + 2] | (bytes[i + 3] << 8)) - t.counter) & 0xFFFF;
      const len = bytes[i + 4] | (bytes[i + 5] << 8);
      if (k >= 1 && k <= 8 && len <= MAX_PACKET_SIZE - DATA_HEADER_SIZE - CRC_SIZE) { at = i; step = k; }
    }
    t.complete = true;
    t.bytes_looked_at = bytes.length;
    t.chunks = this.chunks.filter(c => c.start + c.n > t.offset - 4096 && c.start < end + 4096).slice(-40)
      .map(c => ({ start: c.start, bytes: c.n, t_ms: c.t }));
    t.bytes_hex = hex(bytes.subarray(0, Math.min(bytes.length, t.declared_bytes))).replace(/ /g, '');
    t.after_hex = hex(bytes.subarray(t.declared_bytes, t.declared_bytes + TRACE_AFTER_HEX)).replace(/ /g, '');
    if (at < 0) return;
    const shift = at - t.declared_bytes;
    const from = t.offset + DATA_HEADER_SIZE, to = t.offset + at;
    const starts = this.chunks.filter(c => c.start >= from && c.start <= to).map(c => c.start);
    const first = this._chunkAt(from);
    Object.assign(t, {
      next_header_at: at,
      next_counter: (t.counter + step) & 0xFFFF,
      counter_step: step,
      shift,
      bytes_missing: step === 1 && shift < 0 ? -shift : null,
      bytes_inserted: step === 1 && shift > 0 ? shift : null,
      gap_window: [from, to],
      chunk_starts_in_window: starts,
      gap_inside_one_chunk: starts.length === 0 && first !== null && to < first.start + first.n,
    });
  }

  // radar-js: the first good data packet after sync losses: where the stream was picked up again
  _resynced(p) {
    for (const t of this.awaitingResync) t.resync = { offset: p.offset, counter: p.counter, bytes_skipped: p.offset - t.offset, t_ms: +performance.now().toFixed(1) };
    this.awaitingResync = [];
  }

  // radar-js: the traces so far, finishing any CRC trace still waiting for bytes
  lossTraces() { this._completeCrc(true); return this.traces; }

  _chunkAt(pos) {
    for (let i = this.chunks.length - 1; i >= 0; i--) { const c = this.chunks[i]; if (pos >= c.start && pos < c.start + c.n) return c; }
    return null;
  }

  _pushTrace(trace) {
    trace.seq = ++this.traceSeq;
    trace.t_ms = +performance.now().toFixed(1);
    trace.bytes_read = this.bytesRead;
    trace.last_chunks = this.chunks.slice(-TRACE_LAST_CHUNKS).map(c => ({ start: c.start, bytes: c.n, t_ms: c.t }));
    this.traces.push(trace);
    if (this.traces.length > TRACE_LIMIT) this.traces.shift();
  }

  async open(baudRate) {
    // The largest receive buffer Chrome allows (16 MiB, about 11 s of radar
    // data): if the page is busy for a moment, data waits here instead of the
    // board's own buffer overflowing.
    await this.port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 16 * 1024 * 1024 });
    this.closed = false;
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.pump = this._readLoop();
  }

  async _readLoop() {
    try {
      while (!this.closed) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length) {
          this.lastRx = performance.now();
          this.chunks.push({ start: this.bytesRead, n: value.length, t: +this.lastRx.toFixed(1) });   // radar-js: loss trace
          if (this.chunks.length > CHUNK_HISTORY) this.chunks.shift();
          this._keep(value);
          this.bytesRead += value.length;
          this.parser.push(value);
          if (this.pendingCrc.length) this._completeCrc();
        }
      }
    } catch (e) { if (!this.closed) this.log('Read loop error: ' + e.message); }
  }

  clearInput() { this.parser.clear(); }

  _onControl(p) {
    // A response with no command outstanding is discarded, as the SDK does.
    if (!this.pending) { this.log('Discarding unexpected control response ' + hex(p.raw.subarray(0, 4))); return; }
    const { resolve } = this.pending;
    this.pending = null;
    resolve(p);
  }

  async close() {
    this.closed = true;
    try { await this.reader.cancel(); } catch {}
    try { this.reader.releaseLock(); } catch {}
    try { this.writer.releaseLock(); } catch {}
    try { await this.pump; } catch {}
    try { await this.port.close(); } catch {}
  }

  // One request/response exchange (BridgeSerial::sendRequest + receiveResponse).
  async request(bmReqType, bRequest, wValue, wIndex, wLength, payload, maxReceive) {
    if (this.pending) throw new Error('A command is already in progress');
    const packet = buildRequest(bmReqType, bRequest, wValue, wIndex, wLength, payload);
    this.log('TX ' + hexShort(packet));

    const response = new Promise((resolve, reject) => {
      // BridgeSerial gives up after 1 s. Here the wait is extended while data
      // keeps arriving, since the reply may be queued behind it.
      const sent = performance.now();
      const check = () => {
        const now = performance.now();
        if (now - this.lastRx < TIMEOUT_MS && now - sent < BACKLOG_TIMEOUT_MS) { timer = setTimeout(check, TIMEOUT_MS); return; }
        this.pending = null;
        reject(new Error('Timeout: request response header not received'));
      };
      let timer = setTimeout(check, TIMEOUT_MS);
      this.pending = { resolve: p => { clearTimeout(timer); resolve(p); } };
    });
    await this.writer.write(packet);
    const p = await response;
    this.log('RX ' + hexShort(p.raw));
    return checkResponse(p, bmReqType, wLength, maxReceive);
  }

  vendorWrite(bRequest, wValue, wIndex, payload) {
    const p = payload || new Uint8Array(0);
    return this.request(VENDOR_REQ_WRITE, bRequest, wValue, wIndex, p.length, p, 0);
  }
  vendorRead(bRequest, wValue, wIndex, wLength) {
    return this.request(VENDOR_REQ_READ, bRequest, wValue, wIndex, wLength, null, wLength);
  }
  vendorTransfer(bRequest, wValue, wIndex, payload, maxReceive) {
    const p = payload || new Uint8Array(0);
    return this.request(VENDOR_REQ_TRANSFER, bRequest, wValue, wIndex, p.length, p, maxReceive);
  }
}

export function buildRequest(bmReqType, bRequest, wValue, wIndex, wLength, payload) {
  const header = Uint8Array.of(bmReqType, bRequest, wValue & 0xFF, wValue >> 8, wIndex & 0xFF, wIndex >> 8, wLength & 0xFF, wLength >> 8);
  // For a read, wLength is the expected reply length and no payload is sent.
  const body = (bmReqType === VENDOR_REQ_READ || !payload) ? new Uint8Array(0) : payload;
  const crc = crc16(body, crc16(header));
  const packet = new Uint8Array(header.length + body.length + CRC_SIZE);
  packet.set(header, 0); packet.set(body, header.length);
  packet[packet.length - 2] = crc >> 8; packet[packet.length - 1] = crc & 0xFF;
  return packet;
}

// Same checks, in the same order, as BridgeSerial::receiveResponse.
export function checkResponse(p, bmReqType, wLength, maxReceive) {
  if (p.payload.length > maxReceive) throw new Error(`Request response too long for buffer (${p.payload.length} > ${maxReceive})`);
  if (!p.crcOk) throw new Error('Request response CRC error');
  if (p.type !== bmReqType) throw new Error(`Request response type error: got 0x${p.type.toString(16)}`);
  if (p.status) {
    const err = new Error(`Board returned status 0x${p.status.toString(16)} (${STATUS_NAMES[p.status] || 'error code'})`);
    err.status = p.status;
    throw err;
  }
  if (bmReqType === VENDOR_REQ_READ && p.payload.length !== wLength) throw new Error(`Read request response length error: ${p.payload.length} vs ${wLength}`);
  return p.payload;
}

const hexShort = bytes => bytes.length <= 48 ? hex(bytes) : `${hex(bytes.subarray(0, 40))} ... (${bytes.length} bytes)`;
