/** What a finished capture holds. */
export interface CaptureResult {
  /** Frames in arrival order, each nRx x nChirp x nSample. */
  frames: Float32Array[];
  /** Arrival time of each frame, ms after the capture started. */
  frameTimesMs: number[];
  startedAt: Date;
  endedAt: Date;
  durationS: number;
  /** Frames the duration should hold at the frame rate. */
  expected: number;
  /** Dropped-frame count and restarts reported by the device during the capture. */
  dropped: number;
  restarts: number;
}

/**
 * Records every frame a live session streams for a fixed time. Feed it with
 * push(frame) from radar.onFrame; it keeps frames that arrive between start()
 * and the end of the duration.
 *
 *   const rec = new radar.capture.Recorder();
 *   radar.onFrame(f => rec.push(f));
 *   const result = await rec.start(3, 0.1);   // 3 s at 10 frames per second
 */
export class Recorder {
  private frames: Float32Array[] = [];
  private times: number[] = [];
  private t0 = 0;
  private active = false;
  private dropsAtStart = 0;
  private restarts = 0;
  private dropCounter: () => number = () => 0;
  /** Called after each kept frame with the count so far. */
  onProgress: ((count: number, elapsedS: number) => void) | null = null;

  /** @param dropCounter returns the device's dropped-frame count (radar.stats().drops) */
  constructor(dropCounter?: () => number) { if (dropCounter) this.dropCounter = dropCounter; }

  get recording(): boolean { return this.active; }

  /** Hand every streamed frame in; ignored unless a capture is running. */
  push(frame: Float32Array, now = performance.now()): void {
    if (!this.active) return;
    this.frames.push(frame);
    this.times.push(now - this.t0);
    this.onProgress?.(this.frames.length, (now - this.t0) / 1000);
  }

  /** Count a device restart (radar.onState with restarted: true) during the capture. */
  noteRestart(): void { if (this.active) this.restarts++; }

  /**
   * Capture for durationS seconds.
   * @param frameTimeS frame_repetition_time_s, for the expected frame count
   */
  start(durationS: number, frameTimeS: number): Promise<CaptureResult> {
    if (this.active) return Promise.reject(new Error('A capture is already running'));
    this.frames = []; this.times = []; this.restarts = 0;
    this.dropsAtStart = this.dropCounter();
    this.t0 = performance.now();
    const startedAt = new Date();
    this.active = true;
    return new Promise(resolve => {
      setTimeout(() => {
        this.active = false;
        resolve({
          frames: this.frames, frameTimesMs: this.times.map(t => +t.toFixed(2)), startedAt, endedAt: new Date(), durationS,
          expected: Math.round(durationS / frameTimeS),
          dropped: this.dropCounter() - this.dropsAtStart, restarts: this.restarts,
        });
      }, durationS * 1000);
    });
  }

  /** End a running capture early, discarding it. */
  cancel(): void { this.active = false; }
}
