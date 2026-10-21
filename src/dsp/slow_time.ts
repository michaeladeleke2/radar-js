// Steps 1-7 of SensDSv2 core/processing.py spectrogram_from_frames: the
// slow-time signal the STFT method takes its spectrogram of.
//   antenna 0, every chirp of every frame in order (the transpose + Fortran
//   reshape); range FFT zero padded to 2 n_sample, upper half kept, / n_sample;
//   slow-time mean removed per range bin; MTI high-pass (optional); summed over
//   range bins n_sample // 2 .. n_sample - 2.
// Only the summed range bins are computed: each bin is filtered on its own,
// so the others do not change the result.

import { fft, pairwiseSum } from './fft.js';
import { mtiHighpass } from './mti_highpass.ts';

/**
 * The slow-time signal of SensDSv2's STFT spectrogram: one complex value per
 * chirp, the sum of the upper range bins after clutter removal and MTI.
 * @param frames antenna-0 frames, each nChirp x nSample, row major (chirp, sample)
 * @param nChirp chirps per frame
 * @param nSample samples per chirp (a power of two)
 * @param options mti: apply the MTI high-pass (default true, as SensDSv2)
 * @returns { re, im }, Float64Array of length frames.length * nChirp
 */
export function slowTimeSignal(frames: ArrayLike<number>[], nChirp: number, nSample: number, { mti = true }: { mti?: boolean } = {}): { re: Float64Array; im: Float64Array } {
  const n = frames.length * nChirp;
  const r0 = Math.floor(nSample / 2), r1 = nSample - 1, nRows = Math.max(r1 - r0, 0);
  const rowsRe = new Float64Array(nRows * n), rowsIm = new Float64Array(nRows * n);
  const bufRe = new Float64Array(2 * nSample), bufIm = new Float64Array(2 * nSample);
  const scale = 1 / nSample;      // numpy's complex / n multiplies by 1 / n
  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f];
    for (let c = 0; c < nChirp; c++) {
      bufRe.fill(0); bufIm.fill(0);
      for (let s = 0; s < nSample; s++) bufRe[s] = frame[c * nSample + s];
      fft(bufRe, bufIm);
      const col = f * nChirp + c;
      for (let r = r0; r < r1; r++) {
        rowsRe[(r - r0) * n + col] = bufRe[nSample + r] * scale;
        rowsIm[(r - r0) * n + col] = bufIm[nSample + r] * scale;
      }
    }
  }
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let r = 0; r < nRows; r++) {
    let rowRe: Float64Array = rowsRe.subarray(r * n, (r + 1) * n), rowIm: Float64Array = rowsIm.subarray(r * n, (r + 1) * n);
    const mr = pairwiseSum(rowRe, 0, n) * (1 / n), mi = pairwiseSum(rowIm, 0, n) * (1 / n);
    for (let i = 0; i < n; i++) { rowRe[i] -= mr; rowIm[i] -= mi; }
    if (mti) ({ re: rowRe, im: rowIm } = mtiHighpass(rowRe, rowIm));
    for (let i = 0; i < n; i++) { re[i] += rowRe[i]; im[i] += rowIm[i]; }
  }
  return { re, im };
}
