import { computeRangeMap } from '../range_map.js';
import { frameList, nest, type Frames } from './arrays.ts';
import type { RangeMode } from './range_profile.ts';

/**
 * Range-time map of a recording (SensDSv2 range_map_v1 compute_range_map):
 * one range profile per frame.
 *
 * @param frames a recording or frames of one antenna (see Frames)
 * @param options.mode 'mti' (default) or 'raw'
 * @param options.antenna rx antenna for 4-D input (default 0)
 * @returns dB values [frame][rangeBin]
 */
export function rangeMap(frames: Frames, { mode = 'mti', antenna = 0 }: { mode?: RangeMode; antenna?: number } = {}): number[][] {
  const { frames: list, nChirp, nSample } = frameList(frames, antenna);
  const { map, nBins } = computeRangeMap((i: number) => list[i], list.length, nChirp, nSample, mode);
  return nest(map, list.length, nBins);
}
