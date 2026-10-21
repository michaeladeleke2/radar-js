import type { RadarConfig } from '../config/types.ts';
import type { CaptureResult } from './recorder.ts';
import type { DeviceInfo } from './device_info.ts';
import { BUILD } from './build_info.ts';

/** The JSON saved beside every capture's .npy. */
export interface Sidecar {
  format: 'radar-js-capture';
  version: 1;
  /** 'dataset' (a labeled clip), 'live' (a live benchmark run), or 'session'. */
  type: string;
  file: string;
  label: string | null;
  distance_m: number | null;
  notes: string;
  started_at: string;
  ended_at: string;
  duration_s: number;
  frames: { expected: number; received: number; dropped: number; restarts: number; shape: number[] };
  frame_times_ms: number[];
  config: RadarConfig;
  board: { board: string; firmware: string; chip: string } | null;
  device: DeviceInfo;
  radar_js: typeof BUILD;
  [extra: string]: unknown;
}

export interface SidecarInput {
  type: string;
  file: string;
  capture: CaptureResult;
  config: RadarConfig;
  shape: [number, number, number];
  board: { board: string; firmware: string; chip: { isBGT60TR13C: boolean } } | null;
  device: DeviceInfo;
  label?: string | null;
  distance_m?: number | null;
  notes?: string;
}

/** Describe a capture: what, when, how many frames, the radar settings, the board, the computer and the radar-js build. */
export function sidecar(input: SidecarInput): Sidecar {
  const { capture: c } = input;
  return {
    format: 'radar-js-capture', version: 1, type: input.type, file: input.file,
    label: input.label ?? null, distance_m: input.distance_m ?? null, notes: input.notes ?? '',
    started_at: c.startedAt.toISOString(), ended_at: c.endedAt.toISOString(), duration_s: c.durationS,
    frames: { expected: c.expected, received: c.frames.length, dropped: c.dropped, restarts: c.restarts, shape: [c.frames.length, ...input.shape] },
    frame_times_ms: c.frameTimesMs,
    config: input.config,
    board: input.board ? { board: input.board.board, firmware: input.board.firmware, chip: input.board.chip.isBGT60TR13C ? 'BGT60TR13C' : 'unknown' } : null,
    device: input.device,
    radar_js: { ...BUILD },
  };
}

/** A file name stem: label_distance_YYYYMMDD-HHMMSS (or type_YYYYMMDD-HHMMSS). */
export function captureName(prefix: string, distance_m: number | null, at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return distance_m == null ? `${prefix}_${stamp}` : `${prefix}_${distance_m}m_${stamp}`;
}
