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

Not checked yet
- The demo against a real board (no board was attached while building it).
  The spectrogram path was checked in the browser with synthetic frames.

## Next

1. Try the demo with the board; compare a capture with SensDSv2 (sensds-web's
   `scripts/compare_frames.mjs` approach).
2. Port the STFT method from SensDSv2 `core/processing.py` (Butterworth MTI
   high-pass + Hanning STFT, nfft 1024, window 256, overlap 200) into
   `src/dsp/`, with Python fixtures.
3. `configure()` for other chirp settings: port the SDK's register
   calculation (lib_avian), so the register list is no longer fixed.
4. `src/data/`: recording to .npy from the live stream (sensds-web Visualize
   tab's `saveFrames`).
5. `src/simulate/`: synthetic frames (tests/synthetic.js is a start).
6. Type declarations (`.d.ts`) for npm, and an npm publish once licensing for
   the Strata-derived files is settled for package distribution.
