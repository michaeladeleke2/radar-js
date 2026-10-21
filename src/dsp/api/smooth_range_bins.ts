import { smoothRangeBins as smooth } from '../recorded.js';
import { SMOOTH_WINDOW } from '../doppler_live.js';

/**
 * Median-smooths a sequence of range bins (SensDSv2 smooth_range_bins:
 * scipy median_filter, reflect mode, rounded half to even, clipped).
 *
 * @param bins one range bin per frame
 * @param nRangeBins number of range bins (results are clipped to 0..nRangeBins-1)
 * @param window median window, made odd (default 5)
 */
export function smoothRangeBins(bins: ArrayLike<number>, nRangeBins: number, window: number = SMOOTH_WINDOW): number[] {
  return Array.from(smooth(Array.from(bins), nRangeBins, window) as Int32Array);
}
