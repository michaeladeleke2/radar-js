// The live spectrogram (LiveDopplerProcessor, the same code as
// radar.stream.LiveSpectrogram) in a worker, timing each frame's processing
// inside the worker. Used by the live benchmark; the copied live_worker.js is
// unchanged.
//
// in:  { type: 'init', nSample, nChirp, historyLength } | { type: 'frame', id, frame }
// out: { id, history, rangeBin, dopplerBins, procMs }

import { LiveDopplerProcessor } from '../dsp/doppler_live.js';

let proc: InstanceType<typeof LiveDopplerProcessor> | null = null;
self.onmessage = ({ data }: MessageEvent) => {
  if (data.type === 'init') {
    proc = new LiveDopplerProcessor({ nSample: data.nSample, nChirp: data.nChirp, historyLength: data.historyLength });
  } else if (data.type === 'frame' && proc) {
    const t = performance.now();
    const { history, rangeBin } = proc.processFrame(data.frame);
    const procMs = performance.now() - t;
    (self as unknown as Worker).postMessage({ id: data.id, history, rangeBin, dopplerBins: proc.dopplerFftSize, procMs }, [history.buffer]);
  }
};
