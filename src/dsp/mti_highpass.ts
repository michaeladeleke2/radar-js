// SensDSv2's MTI (moving target indication) filter, core/processing.py:
// _MTI_B, _MTI_A = butter(1, 0.01, 'high'), applied with lfilter along slow
// time (one value per chirp).

import { butter } from './butter.ts';
import { lfilter } from './lfilter.ts';

/** Coefficients of SensDSv2's MTI high-pass, butter(1, 0.01, 'high'): { b, a }. */
export const MTI_FILTER = butter(1, 0.01, 'high');

/**
 * MTI high-pass along slow time: scipy lfilter(b, a, x) with SensDSv2's
 * first-order Butterworth (cutoff 0.01 of Nyquist), applied to a complex
 * signal given as real and imaginary parts.
 * @param re real part, one value per chirp
 * @param im imaginary part (omit for a real signal)
 * @param filter { b, a } to use instead of SensDSv2's
 * @returns { re, im } filtered, Float64Array each
 */
export function mtiHighpass(re: ArrayLike<number>, im?: ArrayLike<number>, filter = MTI_FILTER): { re: Float64Array; im: Float64Array } {
  const { b, a } = filter;
  return { re: lfilter(b, a, re), im: im ? lfilter(b, a, im) : new Float64Array(re.length) };
}
