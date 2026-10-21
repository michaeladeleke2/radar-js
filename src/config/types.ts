/**
 * Radar settings, with the Infineon Radar SDK's parameter names (the same
 * object radar.configure() checks and radar.simulate uses).
 */
export interface RadarConfig {
  frame_repetition_time_s: number;
  chirp_repetition_time_s: number;
  num_chirps: number;
  tdm_mimo: boolean;
  start_frequency_Hz: number;
  end_frequency_Hz: number;
  sample_rate_Hz: number;
  num_samples: number;
  rx_mask: number;
  tx_mask: number;
  tx_power_level: number;
  lp_cutoff_Hz: number;
  hp_cutoff_Hz: number;
  if_gain_dB: number;
}

/** Speed of light used by SensDSv2's range axis (m/s). */
export const C_MPS = 299_792_458.0;
