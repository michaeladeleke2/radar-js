import { rangeAxisM } from '../range_map.js';
import type { RadarConfig } from '../../config/types.ts';

/**
 * Distance of each range bin in metres (SensDSv2 range_axis_m): bin k is beat
 * frequency k * Fs / rangeFftSize, divided by the chirp slope
 * bandwidth / (num_samples / Fs), times c / 2.
 *
 * @param config radar settings (Infineon SDK names)
 * @param options.rangeFftSize FFT length (default 4 x num_samples)
 * @returns metres per bin, rangeFftSize / 2 values (0 to 3.48 m for the SensDSv2 settings)
 */
export function rangeAxis(config: RadarConfig, { rangeFftSize }: { rangeFftSize?: number } = {}): number[] {
  const nSample = config.num_samples, size = rangeFftSize ?? nSample * 4;
  return Array.from(rangeAxisM(size / 2, size, {
    sampleRateHz: config.sample_rate_Hz, startFrequencyHz: config.start_frequency_Hz,
    endFrequencyHz: config.end_frequency_Hz, nSample,
  }) as Float64Array);
}
