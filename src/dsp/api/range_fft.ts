import { rangeSpectrum } from '../range_map.js';
import { blackmanharris } from '../windows.js';
import { flatMatrix, nestTransposed, type ComplexMatrix, type Frame } from './arrays.ts';

/**
 * Range FFT of one frame, as SensDSv2's Doppler spectrogram and range map do
 * it: each chirp's mean removed, Blackman-Harris window, zero padded to
 * `rangeFftSize`, first half of the bins kept.
 *
 * @param frame one antenna, [chirp][sample] (e.g. 128 x 256)
 * @param options.rangeFftSize FFT length (default 4 x samples, as SensDSv2)
 * @returns complex spectrum [rangeBin][chirp] (512 x 128 by default)
 */
export function rangeFft(frame: Frame, { rangeFftSize }: { rangeFftSize?: number } = {}): ComplexMatrix {
  const { data, rows: nChirp, cols: nSample } = flatMatrix(frame);
  const size = rangeFftSize ?? nSample * 4;
  const { re, im, nBins } = rangeSpectrum(data, nChirp, nSample, blackmanharris(nSample), size);
  return { re: nestTransposed(re, nChirp, nBins), im: nestTransposed(im, nChirp, nBins) };
}
