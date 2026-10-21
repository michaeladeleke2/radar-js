// spectrogram_from_frames from SensDSv2 core/processing.py, the "STFT"
// spectrogram method: the slow-time signal (slow_time.ts), Hanning STFT
// (nfft 1024, window 256, noverlap 200), fftshift over frequency, magnitude.
// spectrogram_to_db (spectrogram_to_db.ts) turns it into the dB image.

import { slowTimeSignal } from './slow_time.ts';
import { stft, type StftOptions } from './stft.ts';

/**
 * SensDSv2's STFT micro-Doppler spectrogram of a recording (magnitude, not
 * dB; pass it to spectrogramToDb for the image SensDSv2 saves).
 * @param frames antenna-0 frames, each nChirp x nSample, row major (chirp, sample)
 * @param nChirp chirps per frame (128)
 * @param nSample samples per chirp (256)
 * @param options mti (default true) and the STFT options (SensDSv2's by default)
 * @returns { spectrogram, nCols, nfft }: spectrogram is a Float64Array laid out
 *   [column][frequency] (nCols x nfft), frequency fftshifted so index nfft / 2
 *   is zero Doppler; the transpose of Python's (nfft, n_cols)
 */
export function stftSpectrogram(frames: ArrayLike<number>[], nChirp: number, nSample: number, options: StftOptions & { mti?: boolean } = {}): { spectrogram: Float64Array; nCols: number; nfft: number } {
  const { mti = true, ...stftOptions } = options;
  const sig = slowTimeSignal(frames, nChirp, nSample, { mti });
  const { re, im, nCols, nfft } = stft(sig.re, sig.im, stftOptions);
  const spectrogram = new Float64Array(nCols * nfft);
  const half = Math.floor(nfft / 2);
  for (let c = 0; c < nCols; c++) {
    const o = c * nfft;
    for (let k = 0; k < nfft; k++) {
      const j = o + ((k - half + nfft) % nfft);       // numpy.fft.fftshift
      spectrogram[o + k] = Math.hypot(re[j], im[j]);
    }
  }
  return { spectrogram, nCols, nfft };
}
