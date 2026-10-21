import { fft as kernel } from '../fft.js';
import { plain, type ComplexVector } from './arrays.ts';

/**
 * Discrete Fourier transform, unnormalised, same sign convention as
 * numpy.fft.fft. Radix-2 for power-of-two lengths, direct DFT otherwise.
 * The inputs are not changed.
 *
 * @param re real part (or a real signal)
 * @param im imaginary part (default zeros)
 */
export function fft(re: ArrayLike<number>, im?: ArrayLike<number>): ComplexVector {
  const r = Float64Array.from(re), i = im ? Float64Array.from(im) : new Float64Array(r.length);
  if (i.length !== r.length) throw new Error('re and im must have the same length');
  kernel(r, i);
  return { re: plain(r), im: plain(i) };
}
