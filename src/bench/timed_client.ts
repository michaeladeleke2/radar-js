/** One processed frame from the timed worker. */
export interface TimedResult { id: number; history: Float64Array; rangeBin: number; dopplerBins: number; procMs: number }

/**
 * The live spectrogram in a Web Worker that reports how long each frame took
 * to process inside the worker. push(frame, id) -> onResult({ id, history, procMs, ... }).
 */
export class TimedSpectrogramWorker {
  private worker: Worker;
  onResult: (r: TimedResult) => void;
  constructor(onResult: (r: TimedResult) => void) {
    this.onResult = onResult;
    this.worker = new Worker(new URL('./timed_worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => this.onResult(data as TimedResult);
  }
  reset({ nSample, nChirp, historyLength }: { nSample: number; nChirp: number; historyLength: number }): void {
    this.worker.postMessage({ type: 'init', nSample, nChirp, historyLength });
  }
  /** frame: antenna 0, (nChirp x nSample). Copied, so the caller keeps its array. */
  push(frame: ArrayLike<number>, id: number): void {
    const copy = Float32Array.from(frame);
    this.worker.postMessage({ type: 'frame', id, frame: copy }, [copy.buffer]);
  }
  terminate(): void { this.worker.terminate(); }
}
