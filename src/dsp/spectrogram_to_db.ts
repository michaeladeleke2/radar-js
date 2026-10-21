// spectrogram_to_db from SensDSv2 core/processing.py.

/** dB range of SensDSv2's STFT spectrogram image (DB_MIN, DB_MAX). */
export const STFT_DB_RANGE = { min: -20, max: 0 } as const;

/**
 * Magnitude spectrogram to dB, normalised to its own peak, as SensDSv2's
 * spectrogram_to_db: 20 log10(spect / max + 1e-10), clipped to [-20, 0],
 * float32.
 * @param spect magnitude spectrogram (any layout, e.g. stftSpectrogram's)
 * @returns Float32Array of the same length and layout
 */
export function spectrogramToDb(spect: ArrayLike<number>): Float32Array {
  let maxVal = -Infinity;
  for (let i = 0; i < spect.length; i++) if (spect[i] > maxVal) maxVal = spect[i];
  if (maxVal <= 0) maxVal = 1.0;
  const out = new Float32Array(spect.length);
  const { min, max } = STFT_DB_RANGE;
  for (let i = 0; i < spect.length; i++) {
    const db = 20.0 * Math.log10(spect[i] / maxVal + 1e-10);
    out[i] = db < min ? min : db > max ? max : db;
  }
  return out;
}
