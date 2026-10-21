import { stft as kernel, type StftOptions } from '../stft.ts';
import { nestTransposed, type ComplexMatrix, type ComplexVector } from './arrays.ts';

/**
 * Hanning-window STFT as SensDSv2's _stft_hanning: (n - window - 1) // hop
 * columns, each zero padded to nfft, not fftshifted.
 *
 * @param signal a complex signal { re, im } or a real one
 * @param options nfft (1024), window (256), noverlap (200)
 * @returns complex [frequency][column], nfft rows
 */
export function stft(signal: ComplexVector | { re: ArrayLike<number>; im?: ArrayLike<number> } | ArrayLike<number>, options: StftOptions = {}): ComplexMatrix {
  const { re, im } = 're' in signal ? signal : { re: signal as ArrayLike<number>, im: undefined };
  const out = kernel(re, im, options);
  return { re: nestTransposed(out.re, out.nCols, out.nfft), im: nestTransposed(out.im, out.nCols, out.nfft) };
}
