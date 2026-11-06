// Link.open asks for the largest Web Serial receive buffer (16 MiB) and, in a
// browser that rejects that size with a TypeError, falls back to the next
// smaller one (src/device/link.js BUFFER_SIZES), recording the size used.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Link, BUFFER_SIZES } from '../src/device/link.js';

const fakePort = (maxBuffer: number, error?: Error) => {
  const tried: number[] = [];
  return {
    tried,
    readable: new ReadableStream(), writable: new WritableStream(),
    async open(o: { bufferSize: number }) {
      tried.push(o.bufferSize);
      if (error) throw error;
      if (o.bufferSize > maxBuffer) throw new TypeError(`Requested buffer size (${o.bufferSize} bytes) exceeds the maximum`);
    },
    async close() {},
  };
};

test('opens with 16 MiB when the browser accepts it', async () => {
  const port = fakePort(16 * 1024 * 1024);
  const link = new Link(port);
  await link.open(921600);
  assert.equal(link.bufferSize, 16 * 1024 * 1024);
  assert.deepEqual(port.tried, [16 * 1024 * 1024]);
  await link.close();
});

test('falls back to the largest size the browser accepts', async () => {
  const port = fakePort(1024 * 1024);
  const link = new Link(port);
  await link.open(921600);
  assert.equal(link.bufferSize, 1024 * 1024);
  assert.deepEqual(port.tried, BUFFER_SIZES.slice(0, BUFFER_SIZES.indexOf(1024 * 1024) + 1));
  await link.close();
});

test('an error that is not about the size is not retried', async () => {
  const port = fakePort(16 * 1024 * 1024, new DOMException('Failed to open serial port.', 'NetworkError'));
  const link = new Link(port);
  await assert.rejects(link.open(921600), /Failed to open/);
  assert.equal(port.tried.length, 1);
});
