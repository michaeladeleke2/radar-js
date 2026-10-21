import { computeRecorded } from '../recorded.js';
import { frameList, nest, plain, type Frames } from './arrays.ts';

/**
 * Doppler spectrogram of a recording (SensDSv2 compute_recorded, the method
 * the live view uses): for each frame the range-Doppler map, the range bin
 * with the strongest return (median-smoothed over 5 frames), and that bin's
 * Doppler row in dB.
 *
 * @param frames a recording or frames of one antenna (see Frames)
 * @param options.antenna rx antenna for 4-D input (default 0)
 * @returns spectrogram [frame][dopplerBin] in dB and the range bin used per frame
 */
export function dopplerSpectrogram(frames: Frames, { antenna = 0 }: { antenna?: number } = {}): { spectrogram: number[][]; rangeBins: number[] } {
  const { frames: list, nChirp, nSample } = frameList(frames, antenna);
  const { spectrogram, rangeBins, dopplerBins } = computeRecorded(list, nChirp, nSample);
  return { spectrogram: nest(spectrogram, list.length, dopplerBins), rangeBins: plain(rangeBins) };
}
