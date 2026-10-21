import type { RadarConfig } from '../config/types.ts';

/**
 * A radar recording: frames laid out (frame, rx, chirp, sample), row major,
 * the layout SensDSv2 reads with numpy.load and the device streams. Values are
 * the SDK's float scale, -1 to 1. Every radar.dsp function that takes frames
 * accepts a Recording (antenna chosen with { antenna }).
 */
export interface Recording {
  data: Float32Array | Float64Array;
  shape: [number, number, number, number];
  /** The radar settings it was made with, when known. */
  config?: RadarConfig;
}

/**
 * A recording from frames as radar.onFrame delivers them (each a
 * Float32Array of nRx x nChirp x nSample).
 *
 * @param frames the frames, in order
 * @param shape [nRx, nChirp, nSample] of one frame (default [3, 128, 256])
 * @param config the radar settings, kept with the recording
 */
export function fromFrames(frames: ArrayLike<number>[], shape: [number, number, number] = [3, 128, 256], config?: RadarConfig): Recording {
  const per = shape[0] * shape[1] * shape[2];
  const data = new Float32Array(frames.length * per);
  frames.forEach((f, i) => {
    if (f.length !== per) throw new Error(`Frame ${i} has ${f.length} values, expected ${per}`);
    data.set(f, i * per);
  });
  return { data, shape: [frames.length, ...shape], config };
}
