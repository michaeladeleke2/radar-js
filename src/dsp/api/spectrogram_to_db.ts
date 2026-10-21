import { spectrogramToDb as kernel } from '../spectrogram_to_db.ts';
import { flatMatrix, nest, type Matrix } from './arrays.ts';

/**
 * A magnitude spectrogram in dB as SensDSv2 saves training images
 * (processing.py spectrogram_to_db): 20 log10(x / peak + 1e-10), clipped to
 * [-20, 0], rounded to float32.
 *
 * @param spectrogram magnitudes, any 2-D layout
 * @returns dB values, same shape
 */
export function spectrogramToDb(spectrogram: Matrix): number[][] {
  const { data, rows, cols } = flatMatrix(spectrogram);
  return nest(kernel(data), rows, cols);
}
