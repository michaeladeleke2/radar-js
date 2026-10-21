import { frameProfile, windows } from '../range_map.js';
import { flatMatrix, plain, type Frame } from './arrays.ts';

export type RangeMode = 'raw' | 'mti';

/**
 * Range profile of one frame in dB (SensDSv2 range_map_v1 frame_profile).
 * 'raw': mean range-FFT magnitude over chirps (static reflections stay).
 * 'mti': moving targets only, Doppler power summed without the zero-velocity bin.
 *
 * @param frame one antenna, [chirp][sample]
 * @param options.mode 'mti' (default, as compute_range_map) or 'raw'
 * @returns dB per range bin (512 for 256 samples); see rangeAxis for metres
 */
export function rangeProfile(frame: Frame, { mode = 'mti' }: { mode?: RangeMode } = {}): number[] {
  const { data, rows: nChirp, cols: nSample } = flatMatrix(frame);
  const { rangeWindow, dopplerWindow } = windows(nSample, nChirp);
  return plain(frameProfile(data, { mode, nChirp, nSample, rangeWindow, dopplerWindow, rangeFftSize: nSample * 4, dopplerFftSize: nChirp * 4 }));
}
