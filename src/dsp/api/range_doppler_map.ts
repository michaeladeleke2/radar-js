import { RdmComputer } from '../doppler_live.js';
import { flatMatrix, nest, type Frame } from './arrays.ts';

/**
 * Range-Doppler map of one frame in dB (SensDSv2 compute_rdm_db): range FFT
 * (see rangeFft), then per range bin the slow-time mean removed, Chebyshev
 * window (100 dB), zero padded to 4 x chirps, fftshift, power in dB with a
 * -120 dB floor.
 *
 * @param frame one antenna, [chirp][sample]
 * @returns dB values [rangeBin][dopplerBin] (512 x 512 for 128 x 256 frames);
 *   Doppler bin dopplerBins / 2 is zero velocity
 */
export function rangeDopplerMap(frame: Frame): number[][] {
  const { data, rows: nChirp, cols: nSample } = flatMatrix(frame);
  const rangeFftSize = nSample * 4, dopplerFftSize = nChirp * 4;     // RdmComputer's defaults
  const rdm = new RdmComputer(nSample, nChirp, rangeFftSize, dopplerFftSize);
  return nest(rdm.compute(data), rangeFftSize / 2, dopplerFftSize);
}
