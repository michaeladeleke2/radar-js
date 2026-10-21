import { mtiHighpass as kernel } from '../mti_highpass.ts';
import { plain, type ComplexVector } from './arrays.ts';

/**
 * SensDSv2's MTI high-pass along slow time: scipy lfilter with
 * butter(1, 0.01, 'high'), zero initial state.
 *
 * @param signal a complex signal { re, im } or a real one
 * @returns the filtered signal { re, im }
 */
export function mtiHighpass(signal: { re: ArrayLike<number>; im?: ArrayLike<number> } | ArrayLike<number>): ComplexVector {
  const { re, im } = 're' in signal ? signal : { re: signal as ArrayLike<number>, im: undefined };
  const out = kernel(re, im);
  return { re: plain(out.re), im: plain(out.im) };
}
