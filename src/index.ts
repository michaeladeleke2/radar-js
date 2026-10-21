// radar-js: one object, `radar`, like bci.js exposes `bci`.
//
//   import radar from 'radar-js';
//   await radar.connect();            // Web Serial picker + handshake
//   radar.onFrame(cube => ...);       // Float32Array (3 x 128 x 256)
//   await radar.start();
//
// The code under src/ is copied from sensds-web (see CLAUDE.md); this file
// only names it.

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
import { fft, pairwiseSum } from './dsp/fft.js';
import { blackmanharris, chebwin } from './dsp/windows.js';
import { hanning } from './dsp/hanning.ts';
import { butter } from './dsp/butter.ts';
import { lfilter } from './dsp/lfilter.ts';
import { mtiHighpass, MTI_FILTER } from './dsp/mti_highpass.ts';
import { slowTimeSignal } from './dsp/slow_time.ts';
import { stft, STFT_DEFAULTS } from './dsp/stft.ts';
import { stftSpectrogram } from './dsp/stft_spectrogram.ts';
import { spectrogramToDb, STFT_DB_RANGE } from './dsp/spectrogram_to_db.ts';
import { RdmComputer, LiveDopplerProcessor, rangeDopplerWindows, selectRangeBinRaw } from './dsp/doppler_live.js';
import { computeRecorded, smoothRangeBins } from './dsp/recorded.js';
import { computeRangeMap, frameProfile, LiveRangeProcessor, rangeAxisM } from './dsp/range_map.js';
import { LiveProcessorClient } from './dsp/live_client.js';
import { RangeMapClient } from './dsp/range_client.js';
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

  /** Signal processing, ported from SensDSv2 (matches its Python output). */
  dsp: {
    /** Spectrogram of a recording: frames (antenna 0, nChirp x nSample each) -> { spectrogram, rangeBins, dopplerBins }. */
    spectrogram: computeRecorded,
    /** Live spectrogram, one frame at a time (rolling history). */
    LiveSpectrogram: LiveDopplerProcessor,
    /** The live spectrogram in a Web Worker. */
    LiveSpectrogramWorker: LiveProcessorClient,
    /** Range FFT + Doppler FFT of one frame, in dB. */
    RangeDopplerMap: RdmComputer,
    rangeDopplerWindows,
    selectRangeBin: selectRangeBinRaw,
    smoothRangeBins,
    /** Range map of a recording, mode 'raw' or 'mti'. */
    rangeMap: computeRangeMap,
    /** Range profile of one frame, mode 'raw' or 'mti' (moving target indication). */
    rangeProfile: frameProfile,
    LiveRangeMap: LiveRangeProcessor,
    LiveRangeMapWorker: RangeMapClient,
    rangeAxis: rangeAxisM,
    /**
     * SensDSv2's other spectrogram method ("STFT"): frames (antenna 0,
     * nChirp x nSample each) -> { spectrogram (nCols x 1024, magnitude), nCols, nfft }.
     * Range FFT, clutter removal, MTI high-pass, upper range bins summed, Hanning STFT.
     */
    stftSpectrogram,
    /** Magnitude spectrogram -> dB image as SensDSv2 saves it: peak normalised, clipped to [-20, 0]. */
    spectrogramToDb,
    /** The slow-time signal stftSpectrogram transforms: one complex value per chirp. */
    slowTimeSignal,
    /** Hanning-window STFT (nfft 1024, window 256, noverlap 200 by default), not shifted. */
    stft,
    /** SensDSv2's MTI high-pass along slow time: lfilter with butter(1, 0.01, 'high'). */
    mtiHighpass,
    /** { b, a } of the MTI high-pass. */
    MTI_FILTER,
    /** STFT parameters { nfft, window, noverlap }. */
    STFT_DEFAULTS,
    /** dB range of the STFT spectrogram image { min, max }. */
    STFT_DB_RANGE,
    /** scipy.signal.butter for low- and high-pass filters: { b, a }. */
    butter,
    /** scipy.signal.lfilter (zero initial state). */
    lfilter,
    /** numpy.hanning. */
    hanning,
    fft,
    pairwiseSum,
    blackmanharris,
    chebwin,
  },

  /** Canvas plots drawn the way SensDSv2's matplotlib figures look. */
  viz: { LiveSpectrogramPlot, RangeMapPlot, JET_LUT, JET_LUT_BYTES },

  /** Recording and export (.npy, the format SensDSv2 saves). */
  data: { parseNpy, framesFromNpy, writeNpy, writeNpyFloat32 },

  /** Lower level: the device class and frame decoding. */
  device: { RadarDevice, INFINEON_VID, unpackPacked12, rawToCube, frameBytesToCube, FrameAcquisitionFailed, FifoOverflow, FrameSizeNotSupported },
};

export default radar;
