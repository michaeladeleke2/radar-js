# radar-js

## Goal

A JavaScript library for the Infineon BGT60TR13C radar on the Radar Baseboard
MCU7, modeled on [bci.js](https://github.com/pwstegman/bci.js): small,
single-purpose functions, one exported object (`radar`, like bci.js's `bci`),
usable from npm or a single `<script>` tag. Browser first: the board is reached
over Web Serial (Chrome or Edge, on HTTPS or localhost). Offline first: every
processing function works on recorded or simulated data with no board.

## Reference projects (read only)

- `~/sensds-web`: the working web app. Source of the device, config, DSP and
  plotting code in `src/`, copied from commit `f4759f3`.
- `~/SensDSv2`: the PyQt6 desktop app. Source of truth for the signal pipeline
  and its parameters (`core/doppler_spectrogram_live.py`, `core/processing.py`,
  `core/range_map_v1.py`, `core/radar.py`).

Never edit, build, install or run git in either. New files that read SensDSv2
code or data go in `tools/` here and never write inside SensDSv2 (load modules
by file path with `sys.dont_write_bytecode = True`, as `tools/make_golden.py`
does). To check SensDSv2 is untouched, compare file times; do not run git there.

## The rule for DSP

DSP output must match SensDSv2's Python output.

- `tools/make_golden.py ~/SensDSv2` runs SensDSv2's own functions on a real
  SDK capture and a synthetic capture and saves every stage to `test/golden/`
  (`README.md` and `manifest.json` there list shapes, parameters and the
  SensDSv2 function behind each file). Never edit golden files by hand.
- `test/golden.test.ts` checks every `radar.dsp` function (and
  `radar.stream.LiveSpectrogram`) against them, with stated tolerances: exact
  for range bins and the float32 dB image, 1e-12 for windows/coefficients/axes,
  1e-9 of the peak after FFTs, 1e-8 dB for dB values. It prints the measured
  worst case of every check.
- A new DSP function gets golden data (extend `make_golden.py`) and a golden
  test before it is called done. If a golden test fails, fix radar.js, not the
  golden data, unless the golden script itself is wrong; then say so.
- Older fixture tests (`test/viz.test.js`, `range_map.test.js`, from
  sensds-web's generators; `stft.test.js`, from `tools/make_stft_fixtures.py`)
  stay as extra coverage.

## Layout

- `src/device/` Web Serial, Strata protocol, `RadarDevice`, the session
  (connect / start / stop / onFrame). Copied from sensds-web.
- `src/config/` settings with the Infineon SDK names (`SENSDS_CONFIG`,
  `configure`, `RadarConfig` in `types.ts`), the exported register list.
- `src/dsp/` the processing kernels (copied `.js`, and the STFT port in `.ts`).
  `src/dsp/api/` holds the public `radar.dsp`: one pure function per file,
  nested or typed arrays in, plain nested arrays out, SensDSv2's array layouts,
  settings passed in; no device, DOM or shared state.
- `src/stream/` `radar.stream`: the stateful live processors and their Web
  Worker clients (typed arrays, for speed).
- `src/viz/` canvas plots in SensDSv2's matplotlib look. Copied.
- `src/data/` `radar.data`: `.npy` (frames, rx, chirps, samples), CSV (one row
  per time step), JSON; loads take File/Blob/bytes, saves return a Blob;
  `download()` is the only page function.
- `src/simulate/` `radar.simulate.frames(config, { targets })`: FMCW model,
  the same one as `make_golden.py`'s synthetic input.
- `src/ml/` placeholder.
- `demo/` the demo page (Live, File, Simulate, Record). `tools/` Python tools
  that read SensDSv2. `test/` Vitest.

## Conventions

- ES modules, `"type": "module"`. TypeScript for new code; the files copied
  from sensds-web stay `.js` (with `allowJs`) so they remain identical to the
  originals apart from the changes listed below.
- One function (or one small class) per file where practical.
- JSDoc on every public function and on every member of the `radar` object.
- Everything public goes through `src/index.ts`.
- TypeScript files import each other with the `.ts` extension
  (`allowImportingTsExtensions`); only erasable TypeScript (no enums,
  namespaces or parameter properties).
- Velocity sign in `radar.dsp.velocityAxis` and `radar.simulate`: negative is
  toward the radar. The copied plot (`LiveSpectrogramPlot`, as SensDSv2's
  matplotlib figure) labels the vertical axis the other way round; which sign
  the real board gives is not yet checked (see PROGRESS.md).
- Strata-derived files keep their `STRATA DERIVED` header (see LICENSING.md).
- npm, Node 22 (CI). `npm test` (Vitest, `test/`), `npm run build` (typecheck +
  demo), `npm run build:lib` (dist-lib/radar.js and radar.iife.js).
- Small logical commits. Pushing to `main` deploys the demo (docs/DEPLOY.md).

## Changes from the sensds-web originals

Keep this list current when a copied file has to change.

- All copied files: import paths.
- `src/device/device.js`: `open()` also reads the board name (Strata
  BOARD_INFO, copied from sensds-web's `tools/sensds_web_step1_connect.html`)
  and returns `{ firmware, chip, board }`.
- `src/device/session.js` (was `src/app/radar_session.js`): `connectRadar()`
  split into `connectRadar()` / `startRadar()` / `stopRadar()`, with a loop
  generation number; adds `isStreaming()`, `boardInfo()`, `streaming` in the
  state event.
- `src/dsp/range_map.js`: `rangeSpectrum` is exported (one word), for
  `radar.dsp.rangeFft`.
- `test/fake_board.js`: the simulated board, moved out of `device.test.js`
  and taught the board-info request.

Not from sensds-web (new ports, no copied file changed):

- STFT spectrogram method from SensDSv2 `core/processing.py`
  (`spectrogram_from_frames`, `_stft_hanning`, `spectrogram_to_db`):
  `src/dsp/slow_time.ts`, `stft.ts`, `stft_spectrogram.ts`,
  `spectrogram_to_db.ts`, `mti_highpass.ts`, with scipy's `butter` and
  `lfilter` (`butter.ts`, `lfilter.ts`) and numpy's `hanning` (`hanning.ts`).
  These kernels lay 2-D results out [column][frequency]; the public
  `radar.dsp` versions return SensDSv2's [frequency][column].
