# Progress

## 2026-10-21: project start

Done
- Created the repo (TypeScript + Vite, npm, Node 22 in CI, same as sensds-web).
- Copied from sensds-web (commit f4759f3), unchanged except import paths:
  device (Web Serial link, Strata data path, Avian protocol, RadarDevice,
  frame unpacking, session loop), config (SensDSv2 settings with SDK names,
  register list), DSP (FFT, windows, range-Doppler map, live and recorded
  spectrogram, range map raw/MTI, worker clients), viz (jet, ticks, image
  resampling, live spectrogram and range map plots), data (.npy).
- Copied the matching tests and their Python-generated fixtures: they pass
  unchanged (52 tests) in the new layout.
- Two intentional changes (listed in CLAUDE.md): the handshake also reads the
  board name; the session is split into connect / start / stop. One new test
  (session.test.js) covers connect, start, stop, start again, disconnect on the
  simulated board. 53/53 pass.
- `src/index.ts` exports `radar` (connect, configure, start, stop, onFrame,
  dsp, viz, data, device). Builds: ES module and plain-script IIFE.
- Demo page (demo/): Connect, board info, Start/Stop, live spectrogram with
  sensds-web's settings and look. Deployed to GitHub Pages on push to main
  (https://michaeladeleke2.github.io/radar-js/). The repository is public:
  the GitHub plan does not allow Pages on a private repository. Steps in
  docs/DEPLOY.md.

Checked on hardware
- The demo with the radar plugged in (reported by the project owner,
  2026-10-21): Connect and handshake, board info, Start/Stop and the live
  spectrogram all work.

## 2026-10-21: STFT spectrogram method (merged into main)

Done
- Ported SensDSv2's other spectrogram method from `core/processing.py`
  (`spectrogram_from_frames` with MTI, `_stft_hanning`, `spectrogram_to_db`)
  into `src/dsp/`, one function per TypeScript file: `slowTimeSignal`
  (range FFT, clutter removal, MTI, upper range bins summed), `stft`,
  `stftSpectrogram`, `spectrogramToDb`, `mtiHighpass`, plus scipy's `butter`
  and `lfilter` and numpy's `hanning`. All on `radar.dsp`.
- `reference/python/make_stft_fixtures.py` runs SensDSv2's code, read only,
  on `tests/fixtures/radar/python_frames.npy` and writes
  `tests/fixtures/stft/`. `tests/stft.test.js` (15 tests): the MTI
  coefficients, `lfilter` and the dB image match exactly; the slow-time signal
  and spectrogram (after FFTs) to ~5e-14 of the peak; `hanning` and other
  `butter` orders to 1e-15 (libm rounding). 68/68 pass.
- New TypeScript files import each other with `.ts`; Node strips the types
  in tests, so `engines` is now Node >= 22.18.

## Next

1. Compare a live capture with SensDSv2 frame by frame (sensds-web's
   `scripts/compare_frames.mjs` approach), and show the STFT spectrogram
   in the demo next to the live one.
2. `configure()` for other chirp settings: port the SDK's register
   calculation (lib_avian), so the register list is no longer fixed.
3. `src/data/`: recording to .npy from the live stream (sensds-web Visualize
   tab's `saveFrames`).
4. `src/simulate/`: synthetic frames (tests/synthetic.js is a start).
5. Type declarations (`.d.ts`) for npm, and an npm publish once licensing for
   the Strata-derived files is settled for package distribution.
