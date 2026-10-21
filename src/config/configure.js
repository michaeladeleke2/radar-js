// radar-js: checks radar settings against the one configuration the board can
// be given today. The register list (registers_tr13c.js) was exported by the
// Radar SDK for SensDSv2's configuration, so any other chirp or sequence value
// would need the SDK's register calculation, which is not ported yet.

import { SENSDS_CONFIG, deriveAcquisition } from './config.js';

/**
 * Check radar settings and return the full configuration that will be used.
 *
 * Settings use the Infineon Radar SDK parameter names, e.g.
 * `{ num_chirps: 128, num_samples: 256, frame_repetition_time_s: 0.1 }`.
 * Settings left out keep their SensDSv2 value.
 *
 * @param {Partial<typeof SENSDS_CONFIG>} [settings]
 * @returns {{ config: typeof SENSDS_CONFIG, acquisition: ReturnType<typeof deriveAcquisition> }}
 * @throws {Error} for an unknown name, or a value other than the supported one
 */
export function configure(settings = {}) {
  for (const [name, value] of Object.entries(settings)) {
    if (!(name in SENSDS_CONFIG)) throw new Error(`Unknown radar setting '${name}'. Known: ${Object.keys(SENSDS_CONFIG).join(', ')}`);
    if (value !== SENSDS_CONFIG[name]) {
      throw new Error(`${name} = ${value} is not supported yet; this version runs the SensDSv2 configuration only (${name} = ${SENSDS_CONFIG[name]}).`);
    }
  }
  return { config: SENSDS_CONFIG, acquisition: deriveAcquisition(SENSDS_CONFIG) };
}
