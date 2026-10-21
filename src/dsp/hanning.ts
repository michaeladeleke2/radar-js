// numpy.hanning(M), the symmetric Hann window SensDSv2's STFT uses
// (core/processing.py: _HANNING_WIN = np.hanning(STFT_WINDOW)).

/**
 * Symmetric Hann window, as numpy.hanning(M): 0.5 + 0.5 cos(pi n / (M - 1))
 * for n = 1 - M, 3 - M, ..., M - 1.
 * @param M window length
 * @returns Float64Array of length M (empty for M < 1, [1] for M = 1)
 */
export function hanning(M: number): Float64Array {
  if (M < 1) return new Float64Array(0);
  if (M === 1) return new Float64Array([1]);
  const w = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    const n = 1 - M + 2 * i;
    w[i] = 0.5 + 0.5 * Math.cos(Math.PI * n / (M - 1));
  }
  return w;
}
