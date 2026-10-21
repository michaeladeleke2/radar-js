// _stft_hanning from SensDSv2 core/processing.py: Hanning-windowed STFT,
// column count (len - window - 1) // shift as the reference script's stft().

import { fft, isPow2 } from './fft.js';
import { hanning } from './hanning.ts';

/** SensDSv2's STFT parameters (core/processing.py STFT_NFFT, STFT_WINDOW, STFT_NOVERLAP). */
export const STFT_DEFAULTS = { nfft: 1024, window: 256, noverlap: 200 } as const;

export interface StftOptions {
  /** FFT length per column, a power of two (default 1024). */
  nfft?: number;
  /** Hanning window length in samples (default 256). */
  window?: number;
  /** Overlap between columns in samples (default 200, so a 56-sample hop). */
  noverlap?: number;
}

/**
 * Short-time Fourier transform with a Hanning window, as SensDSv2's
 * _stft_hanning: columns start every window - noverlap samples, and there are
 * floor((n - window - 1) / (window - noverlap)) of them (one column of zeros
 * if that is not positive). Not shifted, not magnitude.
 * @param re real part of the signal
 * @param im imaginary part (omit for a real signal)
 * @param options nfft, window, noverlap (SensDSv2's by default)
 * @returns { re, im, nCols, nfft }: Float64Array laid out [column][frequency]
 *   (nCols x nfft), the transpose of Python's (nfft, n_cols)
 */
export function stft(re: ArrayLike<number>, im?: ArrayLike<number>, options: StftOptions = {}): { re: Float64Array; im: Float64Array; nCols: number; nfft: number } {
  const { nfft, window, noverlap } = { ...STFT_DEFAULTS, ...options };
  const shift = window - noverlap;
  if (shift <= 0) throw new Error('noverlap must be less than window');
  if (!isPow2(nfft) || nfft < window) throw new Error('nfft must be a power of two, at least window');
  const nCols = Math.floor((re.length - window - 1) / shift);
  if (nCols <= 0) return { re: new Float64Array(nfft), im: new Float64Array(nfft), nCols: 1, nfft };
  const win = hanning(window);
  const outRe = new Float64Array(nCols * nfft), outIm = new Float64Array(nCols * nfft);
  for (let c = 0; c < nCols; c++) {
    const bufRe = outRe.subarray(c * nfft, (c + 1) * nfft), bufIm = outIm.subarray(c * nfft, (c + 1) * nfft);
    for (let k = 0; k < window; k++) {
      bufRe[k] = re[c * shift + k] * win[k];
      bufIm[k] = im ? im[c * shift + k] * win[k] : 0;
    }
    fft(bufRe, bufIm);
  }
  return { re: outRe, im: outIm, nCols, nfft };
}
