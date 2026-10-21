// radar.stream: stateful helpers for live data, one frame at a time. They keep
// a rolling history and work on typed arrays for speed; the processing inside
// is the same code as radar.dsp (checked against the same golden data).

import { LiveDopplerProcessor } from '../dsp/doppler_live.js';
import { LiveRangeProcessor } from '../dsp/range_map.js';
import { LiveProcessorClient } from '../dsp/live_client.js';
import { RangeMapClient } from '../dsp/range_client.js';

export const stream = {
  /**
   * Live Doppler spectrogram (SensDSv2 LiveDopplerProcessor):
   * `new LiveSpectrogram({ nSample, nChirp, historyLength })`, then
   * `processFrame(antenna0)` -> { history (historyLength x 512, oldest first), rangeBin }.
   */
  LiveSpectrogram: LiveDopplerProcessor,
  /**
   * The live spectrogram in a Web Worker (browser): `new LiveSpectrogramWorker(onResult)`,
   * `reset({ nSample, nChirp, historyLength })`, `push(antenna0)`.
   */
  LiveSpectrogramWorker: LiveProcessorClient,
  /** Live range map (range_map_live.py): `processFrame(antenna0)` -> { history, nFilled }. */
  LiveRangeMap: LiveRangeProcessor,
  /** The live range map in a Web Worker (browser). */
  LiveRangeMapWorker: RangeMapClient,
};
