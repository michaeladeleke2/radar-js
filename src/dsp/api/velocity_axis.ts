import { C_MPS, type RadarConfig } from '../../config/types.ts';

/**
 * Radial speed of each Doppler bin of a range-Doppler map or Doppler
 * spectrogram, in m/s. Bin k (after fftshift) is Doppler frequency
 * (k - D/2) / (D * chirp_repetition_time_s), times wavelength / 2 at the
 * centre frequency. Negative speeds are targets moving toward the radar.
 *
 * @param config radar settings (Infineon SDK names)
 * @param options.dopplerFftSize Doppler FFT length (default 4 x num_chirps)
 * @returns m/s per bin; the range is +/- wavelength / (4 * chirp time),
 *   +/-4.11 m/s for the SensDSv2 settings
 */
export function velocityAxis(config: RadarConfig, { dopplerFftSize }: { dopplerFftSize?: number } = {}): number[] {
  const d = dopplerFftSize ?? config.num_chirps * 4;
  const wavelength = C_MPS / ((config.start_frequency_Hz + config.end_frequency_Hz) / 2);
  const step = wavelength / (2 * d * config.chirp_repetition_time_s);
  return Array.from({ length: d }, (_, k) => (k - d / 2) * step);
}
