import { stftSpectrogram as kernel } from '../stft_spectrogram.ts';
import type { StftOptions } from '../stft.ts';
import { frameList, nestTransposed, type Frames } from './arrays.ts';

/**
 * SensDSv2's STFT spectrogram (processing.py spectrogram_from_frames, the
 * training-image method): slowTimeSignal, Hanning STFT, fftshift, magnitude.
 *
 * @param frames a recording or frames of one antenna (see Frames)
 * @param options.mti MTI high-pass (default true); antenna (0); nfft, window, noverlap
 * @returns magnitude [frequency][column] (1024 rows; centre row is zero Doppler)
 */
export function stftSpectrogram(frames: Frames, options: StftOptions & { mti?: boolean; antenna?: number } = {}): number[][] {
  const { antenna = 0, ...rest } = options;
  const { frames: list, nChirp, nSample } = frameList(frames, antenna);
  const { spectrogram, nCols, nfft } = kernel(list, nChirp, nSample, rest);
  return nestTransposed(spectrogram, nCols, nfft);
}
