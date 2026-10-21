# Licensing

radar-js contains code from sensds-web, which was ported from the Infineon
Radar SDK 3.6.5 source and from the project owner's SensDSv2. The parts come
under different licences:

| Origin | Licence | Files in this project |
|---|---|---|
| Strata (`external/strata/library`) | Infineon Evaluation Software License (restricted) | `src/device/link.js`, `src/device/strata.js`, `src/device/protocol.js`, `src/device/device.js` |
| lib_avian (`external/lib_avian`) | BSD 3-Clause (per file headers) | `src/config/registers.js` |
| Radar SDK device layer (`sdk/c/ifxFmcw`) | BSD 3-Clause (per file headers) | `src/device/unpack.js`, `src/config/config.js` (slice size) |
| SensDSv2 (`core/doppler_spectrogram_live.py`) | The project owner's own code | `src/dsp/doppler_live.js`, `src/dsp/recorded.js`, `src/viz/live_plot.js` |
| Range map scripts (`range_map_v1.py`, `range_map_live.py`) | The project owner's own code | `src/dsp/range_map.js`, `src/dsp/range_worker.js`, `src/viz/range_plot.js` |
| scipy (window functions) | BSD 3-Clause | `src/dsp/windows.js` |
| matplotlib (jet colormap, tick placement, image resampling) | Matplotlib License (BSD-style) | `src/viz/jet.js`, `src/viz/ticks.js`, `src/viz/image.js` |

Every Strata-derived file starts with a `STRATA DERIVED` comment:

    grep -rl "STRATA DERIVED" src

## Publishing

Permission to publish the Strata-derived code was granted for sensds-web
(confirmed by the project owner on 2026-10-05). The project owner confirmed on
2026-10-21 that radar-js proceeds on the same basis.

No Infineon source file is copied into this repository. The SDK source is used
only as a read-only reference.
