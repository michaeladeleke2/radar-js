import { C_MPS, type RadarConfig } from '../config/types.ts';
import { popcount } from '../config/config.js';
import type { Recording } from '../data/recording.ts';

/** A point target. */
export interface Target {
  /** Distance at time startTime_s, metres. */
  range_m: number;
  /** Radial speed, m/s; negative moves toward the radar. Default 0. */
  speed_m_s?: number;
  /** Signal amplitude in ADC counts (12-bit ADC, 0-4095). Default 600. */
  amplitude?: number;
  /** Angle from boresight, degrees: shifts the phase between receive antennas (half-wavelength spacing). Default 0. */
  angle_deg?: number;
}

export interface SimulateOptions {
  targets: Target[];
  /** Number of frames. Default 1. */
  nFrames?: number;
  /** Gaussian noise, standard deviation in ADC counts. Default 8. */
  noise?: number;
  /** Time of the first frame, seconds (frames follow every frame_repetition_time_s). Default 0. */
  startTime_s?: number;
  /** Seed for the noise, so a simulation repeats exactly. Default 1. */
  seed?: number;
}

/**
 * Synthetic raw radar frames, in the same layout and scale as the device
 * delivers them, for targets at a given distance and radial speed.
 *
 * Model (the same as tools/make_golden.py's synthetic input): a real IF
 * signal per receive antenna, beat frequency 2 R S / c with chirp slope
 * S = bandwidth / (num_samples / sample_rate_Hz), carrier phase 4 pi f_start R / c
 * (the fast-time term adds the sweep, so the mean is the centre frequency),
 * R moving with the target's speed along slow time (chirp_repetition_time_s
 * between chirps, frame_repetition_time_s between frames); a 12-bit ADC with
 * mid-scale offset 2048 and Gaussian noise; then the SDK's scaling
 * raw * 2 / 4095 - 1 in float32.
 *
 * @param config radar settings, the format radar.configure checks
 * @param options targets, nFrames, noise, startTime_s, seed
 * @returns a Recording (frames, rx, chirps, samples), usable by radar.dsp and radar.data
 */
export function frames(config: RadarConfig, options: SimulateOptions): Recording {
  const { targets, nFrames = 1, noise = 8, startTime_s = 0, seed = 1 } = options;
  const nRx = popcount(config.rx_mask), nChirp = config.num_chirps, nSample = config.num_samples;
  const fs = config.sample_rate_Hz;
  const bw = config.end_frequency_Hz - config.start_frequency_Hz;
  const f0 = config.start_frequency_Hz;
  const slope = bw / (nSample / fs);
  const gauss = gaussian(seed);
  const data = new Float32Array(nFrames * nRx * nChirp * nSample);
  const sig = new Float64Array(nSample);
  const tmp = new Float32Array(1);
  let p = 0;
  for (let f = 0; f < nFrames; f++) {
    for (let rx = 0; rx < nRx; rx++) {
      for (let c = 0; c < nChirp; c++) {
        const t = startTime_s + f * config.frame_repetition_time_s + c * config.chirp_repetition_time_s;
        sig.fill(0);
        for (const tg of targets) {
          const r = tg.range_m + (tg.speed_m_s ?? 0) * t;
          const fb = 2 * r * slope / C_MPS;
          const phase0 = 4 * Math.PI * f0 * r / C_MPS + rx * Math.PI * Math.sin(((tg.angle_deg ?? 0) * Math.PI) / 180);
          const amp = tg.amplitude ?? 600;
          for (let s = 0; s < nSample; s++) sig[s] += amp * Math.cos(2 * Math.PI * fb * (s / fs) + phase0);
        }
        for (let s = 0; s < nSample; s++) {
          const raw = Math.min(4095, Math.max(0, Math.round(2048 + sig[s] + (noise ? noise * gauss() : 0))));
          tmp[0] = (raw * 2) / 4095;     // float32 steps, as the SDK
          tmp[0] = tmp[0] - 1;
          data[p++] = tmp[0];
        }
      }
    }
  }
  return { data, shape: [nFrames, nRx, nChirp, nSample], config };
}

// Seeded standard normal numbers (mulberry32 + Box-Muller).
function gaussian(seed: number): () => number {
  let a = seed >>> 0, spare: number | null = null;
  const uniform = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0;
    while (u === 0) u = uniform();
    const v = uniform(), m = Math.sqrt(-2 * Math.log(u));
    spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
}
