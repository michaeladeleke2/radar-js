import { parseNpy, writeNpy } from './npy.js';
import { readBytes, type Source } from './source.ts';
import type { Recording } from './recording.ts';

/**
 * Load a .npy recording: (frames, rx, chirps, samples), as SensDSv2 reads
 * recordings and its Collect tab saves sample_NNN_raw.npy. A single frame
 * (rx, chirps, samples) becomes a one-frame recording. float32 and float64.
 *
 * @param source a File or Blob (browser), or bytes (e.g. Node's fs.readFileSync)
 */
export async function loadNpy(source: Source): Promise<Recording> {
  const { data, shape } = parseNpy(await readBytes(source));
  const s = shape.length === 3 ? [1, ...shape] : shape;
  if (s.length !== 4) throw new Error(`Expected (frames, rx, chirps, samples), got (${shape.join(', ')})`);
  if (!(data instanceof Float32Array || data instanceof Float64Array)) throw new Error('Expected float32 or float64 samples');
  return { data, shape: s as Recording['shape'] };
}

/**
 * Save a recording as .npy (version 1.0, little endian, C order), readable
 * with numpy.load. float32 data stays float32.
 *
 * @returns a Blob to download or upload
 */
export function saveNpy(recording: Pick<Recording, 'data' | 'shape'>): Blob {
  const bytes = writeNpy(recording.data, recording.shape);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' });
}
