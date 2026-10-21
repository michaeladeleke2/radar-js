// radar.bench: pieces for measuring live performance (used by the demo's
// Live benchmark).

import { summarize } from './stats.ts';
import { TimedSpectrogramWorker } from './timed_client.ts';

export type { Summary } from './stats.ts';
export type { TimedResult } from './timed_client.ts';

export const bench = {
  /** n, mean, median, p95, min, max of a list of measurements. */
  summarize,
  /** The live spectrogram in a Web Worker, timing each frame inside the worker. */
  TimedSpectrogramWorker,
};
