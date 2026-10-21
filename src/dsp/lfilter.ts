// scipy.signal.lfilter(b, a, x) for a 1-D real signal with zero initial
// state: direct form II transposed, the loop of scipy's _linear_filter
// (scipy/signal/_lfilter.c), coefficients normalised by a[0] first.
// For a complex signal and real coefficients with a[0] = 1 (any filter from
// butter), filtering the real and imaginary parts separately gives exactly
// scipy's complex result.

/**
 * Filter a signal with an IIR or FIR filter, as scipy.signal.lfilter(b, a, x)
 * (zero initial conditions).
 * @param b numerator coefficients
 * @param a denominator coefficients, a[0] != 0
 * @param x input signal
 * @returns Float64Array, same length as x
 */
export function lfilter(b: ArrayLike<number>, a: ArrayLike<number>, x: ArrayLike<number>): Float64Array {
  const a0 = a[0];
  if (!a0) throw new Error('a[0] must be nonzero');
  const n = Math.max(b.length, a.length);
  const bn = new Float64Array(n), an = new Float64Array(n);
  for (let i = 0; i < b.length; i++) bn[i] = b[i] / a0;
  for (let i = 0; i < a.length; i++) an[i] = a[i] / a0;
  const y = new Float64Array(x.length);
  const z = new Float64Array(Math.max(n - 1, 0));
  for (let k = 0; k < x.length; k++) {
    const xn = x[k];
    if (n > 1) {
      const yn = z[0] + bn[0] * xn;
      for (let i = 0; i < n - 2; i++) z[i] = z[i + 1] + xn * bn[i + 1] - yn * an[i + 1];
      z[n - 2] = xn * bn[n - 1] - yn * an[n - 1];
      y[k] = yn;
    } else {
      y[k] = xn * bn[0];
    }
  }
  return y;
}
