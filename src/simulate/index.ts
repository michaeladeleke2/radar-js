// radar.simulate: synthetic radar data with known targets, no board needed.

import { frames } from './frames.ts';

export type { Target, SimulateOptions } from './frames.ts';

export const simulate = {
  /**
   * Synthetic raw frames for targets at given distances and radial speeds:
   * `radar.simulate.frames(config, { targets: [{ range_m: 0.8, speed_m_s: -0.5 }], nFrames: 10 })`.
   * Returns a Recording in the device's layout and scale.
   */
  frames,
};
