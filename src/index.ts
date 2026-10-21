// radar-js: one object, `radar`, like bci.js exposes `bci`.
//
//   import radar from 'radar-js';
//   await radar.connect();            // Web Serial picker + handshake
//   radar.onFrame(cube => ...);       // Float32Array (3 x 128 x 256)
//   await radar.start();
//
// The device, config, viz and DSP kernels are copied from sensds-web (see
// CLAUDE.md); radar.dsp wraps the kernels as pure functions (src/dsp/api).

import {
  connectRadar, startRadar, stopRadar, disconnectRadar, subscribeFrames, onRadarState,
  isConnected, isStreaming, boardInfo, radarStats, hasWebSerial,
} from './device/session.js';
import { RadarDevice, INFINEON_VID, FrameAcquisitionFailed, FifoOverflow, FrameSizeNotSupported } from './device/device.js';
import { unpackPacked12, rawToCube, frameBytesToCube } from './device/unpack.js';
import { SENSDS_CONFIG, deriveAcquisition, calculateSliceSize } from './config/config.js';
import { configure } from './config/configure.js';
import { parseRegisterFile } from './config/registers.js';
import { REGISTERS, EXPORT_INFO } from './config/registers_tr13c.js';
import { dsp } from './dsp/api/index.ts';
import { stream } from './stream/index.ts';
import { LiveSpectrogramPlot } from './viz/live_plot.js';
import { RangeMapPlot } from './viz/range_plot.js';
import { JET_LUT, JET_LUT_BYTES } from './viz/jet.js';
import { parseNpy, framesFromNpy, writeNpy, writeNpyFloat32 } from './data/npy.js';

/** Frame callback: one radar frame, Float32Array laid out [rx][chirp][sample] (3 x 128 x 256). */
export type FrameCallback = (cube: Float32Array) => void;

export interface BoardInfo {
  /** Board name the firmware reports, e.g. "Radar Baseboard MCU7". */
  board: string;
  /** Firmware version, "major.minor.build". */
  firmware: string;
  /** Decoded CHIP_ID register. */
  chip: { rfId: number; digitalId: number; stepId: number; techId: number; isBGT60TR13C: boolean };
}

export const radar = {
  /**
   * Open the browser's Web Serial picker (Infineon boards only) and do the
   * board handshake. Does not start the radar.
   * @returns board info, or false if no board was picked or the handshake failed
   */
  connect: (): Promise<BoardInfo | false> => connectRadar(),

  /**
   * Check radar settings (Infineon SDK names). Only the SensDSv2
   * configuration is supported for now; anything else throws.
   */
  configure,

  /** Start streaming frames. Resolves true once the radar is running. */
  start: (): Promise<boolean> => startRadar(),

  /** Stop streaming; the board stays connected. */
  stop: (): Promise<void> => stopRadar(),

  /** Stop and close the serial port. */
  disconnect: (message?: string): Promise<void> => disconnectRadar(message),

  /**
   * Receive every raw frame (Float32Array, 3 x 128 x 256, the same values as
   * the SDK's get_next_frame()[0] in Python).
   * @returns a function that unsubscribes
   */
  onFrame: (callback: FrameCallback): (() => boolean) => subscribeFrames(callback),

  /** Connection state changes: { connected, streaming, message, restarted }. */
  onState: onRadarState,

  isConnected,
  isStreaming,
  /** Board info from the last handshake, or null. */
  boardInfo: (): BoardInfo | null => boardInfo(),
  /** { frames, drops } since the last start. */
  stats: radarStats,
  /** True in browsers with Web Serial (Chrome, Edge on a computer). */
  hasWebSerial,

  /** Radar settings and derived acquisition sizes. */
  config: { SENSDS_CONFIG, deriveAcquisition, calculateSliceSize, parseRegisterFile, REGISTERS, EXPORT_INFO },

  /**
   * Signal processing as pure functions: arrays in, plain arrays out, settings
   * passed in, no device or page needed. Matches SensDSv2's Python output
   * (test/golden.test.ts).
   */
  dsp,

  /** Stateful live helpers (rolling spectrogram and range map, Web Worker versions). */
  stream,

  /** Canvas plots drawn the way SensDSv2's matplotlib figures look. */
  viz: { LiveSpectrogramPlot, RangeMapPlot, JET_LUT, JET_LUT_BYTES },

  /** Recording and export (.npy, the format SensDSv2 saves). */
  data: { parseNpy, framesFromNpy, writeNpy, writeNpyFloat32 },

  /** Lower level: the device class and frame decoding. */
  device: { RadarDevice, INFINEON_VID, unpackPacked12, rawToCube, frameBytesToCube, FrameAcquisitionFailed, FifoOverflow, FrameSizeNotSupported },
};

export default radar;
