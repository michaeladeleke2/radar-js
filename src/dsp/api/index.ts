// radar.dsp: pure functions. Plain or typed arrays in, plain nested arrays
// out, every setting passed in; no device, DOM or shared state. Array layouts
// follow SensDSv2's, so results compare one to one with its Python output
// (test/golden.test.ts).

import { rangeFft } from './range_fft.ts';
import { rangeDopplerMap } from './range_doppler_map.ts';
import { selectRangeBin } from './select_range_bin.ts';
import { smoothRangeBins } from './smooth_range_bins.ts';
import { dopplerSpectrogram } from './doppler_spectrogram.ts';
import { rangeProfile } from './range_profile.ts';
import { rangeMap } from './range_time_map.ts';
import { rangeAxis } from './range_axis.ts';
import { velocityAxis } from './velocity_axis.ts';
import { slowTimeSignal } from './slow_time_signal.ts';
import { stft } from './stft.ts';
import { stftSpectrogram } from './stft_spectrogram.ts';
import { spectrogramToDb } from './spectrogram_to_db.ts';
import { mtiHighpass } from './mti_highpass.ts';
import { fft } from './fft.ts';
import { blackmanharris, chebwin, hanning } from './windows.ts';
import { butter, lfilter } from './filters.ts';

export type { Frames, Frame, Matrix, ComplexMatrix, ComplexVector } from './arrays.ts';
export type { RangeMode } from './range_profile.ts';

export const dsp = {
  // Doppler spectrogram method (SensDSv2 core/doppler_spectrogram_live.py)
  /** Range FFT of one frame: complex [rangeBin][chirp]. */
  rangeFft,
  /** Range-Doppler map of one frame in dB: [rangeBin][dopplerBin]. */
  rangeDopplerMap,
  /** Strongest range bin of a range-Doppler map (from bin 15). */
  selectRangeBin,
  /** Median-smoothed range bins (window 5). */
  smoothRangeBins,
  /** Doppler spectrogram of a recording: { spectrogram [frame][dopplerBin], rangeBins }. */
  dopplerSpectrogram,
  // Range map (SensDSv2 core/range_map_v1.py)
  /** Range profile of one frame in dB, mode 'mti' or 'raw'. */
  rangeProfile,
  /** Range-time map of a recording in dB: [frame][rangeBin]. */
  rangeMap,
  // Axes from the radar settings
  /** Metres per range bin. */
  rangeAxis,
  /** m/s per Doppler bin (negative: toward the radar). */
  velocityAxis,
  // STFT spectrogram method (SensDSv2 core/processing.py)
  /** Slow-time signal (range FFT, clutter removal, MTI, range rows summed). */
  slowTimeSignal,
  /** Hanning STFT: complex [frequency][column], not shifted. */
  stft,
  /** STFT spectrogram of a recording: magnitude [frequency][column]. */
  stftSpectrogram,
  /** Magnitude spectrogram to dB, peak normalised, clipped to [-20, 0]. */
  spectrogramToDb,
  /** MTI high-pass along slow time (butter(1, 0.01, 'high')). */
  mtiHighpass,
  // Building blocks
  /** FFT (numpy convention), returns { re, im }. */
  fft,
  /** scipy blackmanharris window. */
  blackmanharris,
  /** scipy chebwin window. */
  chebwin,
  /** numpy hanning window. */
  hanning,
  /** scipy butter (low/high pass): { b, a }. */
  butter,
  /** scipy lfilter. */
  lfilter,
};
