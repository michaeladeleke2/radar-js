import { selectRangeBinRaw, MIN_RANGE_BIN } from '../doppler_live.js';
import { flatMatrix, type Matrix } from './arrays.ts';

/**
 * The range bin whose loudest Doppler cell is the loudest, from `minBin` on
 * (SensDSv2 select_range_bin_raw; the first maximum wins).
 *
 * @param rangeDopplerDb a range-Doppler map in dB, [rangeBin][dopplerBin]
 * @param options.minBin first bin considered (default 15, about 10 cm)
 */
export function selectRangeBin(rangeDopplerDb: Matrix, { minBin = MIN_RANGE_BIN }: { minBin?: number } = {}): number {
  const { data, rows, cols } = flatMatrix(rangeDopplerDb);
  return selectRangeBinRaw(data, rows, cols, minBin);
}
