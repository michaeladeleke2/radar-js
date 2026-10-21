import { slowTimeSignal as kernel } from '../slow_time.ts';
import { frameList, plain, type ComplexVector, type Frames } from './arrays.ts';

/**
 * The slow-time signal of SensDSv2's STFT method (processing.py
 * spectrogram_from_frames steps 1-7): frames joined along slow time, range FFT
 * (2 x samples, upper half, / samples), slow-time mean removed, MTI high-pass,
 * range rows samples/2 .. samples-2 summed. One complex value per chirp.
 *
 * @param frames a recording or frames of one antenna (see Frames)
 * @param options.mti apply the MTI high-pass (default true)
 * @param options.antenna rx antenna for 4-D input (default 0)
 */
export function slowTimeSignal(frames: Frames, { mti = true, antenna = 0 }: { mti?: boolean; antenna?: number } = {}): ComplexVector {
  const { frames: list, nChirp, nSample } = frameList(frames, antenna);
  const { re, im } = kernel(list, nChirp, nSample, { mti });
  return { re: plain(re), im: plain(im) };
}
