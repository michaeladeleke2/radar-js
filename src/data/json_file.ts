import { readText, type Source } from './source.ts';
import type { Recording } from './recording.ts';

const FORMAT = 'radar-js-recording';

/**
 * Save a recording as JSON: { format, version, shape, config, frames }, frames
 * nested [frame][rx][chirp][sample]. Readable anywhere, but about 2 MB of text
 * per frame: use it for short clips; use .npy for longer recordings. Any other
 * value (e.g. a radar.dsp result) is saved as plain JSON.
 */
export function saveJson(value: Recording | unknown): Blob {
  const rec = value as Recording;
  const isRecording = rec && typeof rec === 'object' && ArrayBuffer.isView((rec as Recording).data) && Array.isArray(rec.shape) && rec.shape.length === 4;
  const body = isRecording ? {
    format: FORMAT, version: 1, shape: rec.shape, config: rec.config ?? null,
    frames: nestFrames(rec.data, rec.shape),
  } : value;
  return new Blob([JSON.stringify(body)], { type: 'application/json' });
}

/**
 * Load JSON. A file written by saveJson for a recording comes back as a
 * Recording (Float32Array data); anything else is returned as parsed.
 */
export async function loadJson(source: Source | string): Promise<Recording | unknown> {
  const parsed = JSON.parse(await readText(source));
  if (!parsed || parsed.format !== FORMAT) return parsed;
  const shape = parsed.shape as Recording['shape'];
  const data = Float32Array.from((parsed.frames as number[][][][]).flat(3));
  if (data.length !== shape.reduce((a, b) => a * b, 1)) throw new Error('Recording JSON: frames do not match shape');
  return { data, shape, ...(parsed.config ? { config: parsed.config } : {}) };
}

function nestFrames(data: ArrayLike<number>, [nf, nr, nc, ns]: Recording['shape']): number[][][][] {
  const out: number[][][][] = [];
  let p = 0;
  for (let f = 0; f < nf; f++) {
    const frame: number[][][] = [];
    for (let r = 0; r < nr; r++) {
      const rx: number[][] = [];
      for (let c = 0; c < nc; c++) { rx.push(Array.prototype.slice.call(data, p, p + ns) as number[]); p += ns; }
      frame.push(rx);
    }
    out.push(frame);
  }
  return out;
}
