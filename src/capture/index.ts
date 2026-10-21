// radar.capture: save what a live session streamed, with everything needed to
// trust and repeat it later (sidecar JSON beside each .npy).

import { Recorder } from './recorder.ts';
import { sidecar, captureName } from './sidecar.ts';
import { saveCapture, folderSink, downloadSink, chooseFolder, restoreFolder, canChooseFolder } from './sinks.ts';
import { deviceInfo } from './device_info.ts';
import { BUILD } from './build_info.ts';

export type { CaptureResult } from './recorder.ts';
export type { Sidecar } from './sidecar.ts';
export type { Sink } from './sinks.ts';
export type { DeviceInfo } from './device_info.ts';

export const capture = {
  /** Records every streamed frame for a fixed time: `new Recorder(() => radar.stats().drops)`. */
  Recorder,
  /** The sidecar JSON for a capture. */
  sidecar,
  /** File stem: label_distance_YYYYMMDD-HHMMSS. */
  captureName,
  /** Write <stem>.npy and <stem>.json to a sink. */
  saveCapture,
  /** Ask for a folder to save into (Chrome, Edge). */
  chooseFolder,
  /** The folder chosen last time, if still allowed. */
  restoreFolder,
  /** True where folders can be chosen. */
  canChooseFolder,
  /** Sink for a folder handle. */
  folderSink,
  /** Sink that downloads each file. */
  downloadSink,
  /** Browser, OS and hardware details. */
  deviceInfo,
  /** The running radar-js version and git commit. */
  BUILD,
};
