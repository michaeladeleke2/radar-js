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
- `tools/make_stft_fixtures.py` runs SensDSv2's code, read only,
  on `test/fixtures/radar/python_frames.npy` and writes
  `test/fixtures/stft/`. `test/stft.test.js` (15 tests): the MTI
  coefficients, `lfilter` and the dB image match exactly; the slow-time signal
  and spectrogram (after FFTs) to ~5e-14 of the peak; `hanning` and other
  `butter` orders to 1e-15 (libm rounding). 68/68 pass.
- New TypeScript files import each other with `.ts`; Node strips the types
  in tests, so `engines` is now Node >= 22.18.

## 2026-10-21: library phase (offline first, golden data, data, simulate)

Done
- Tests moved to `test/` and Vitest (`npm test`).
- Golden data: `tools/make_golden.py` imports SensDSv2's
  `doppler_spectrogram_live.py`, `processing.py` and `range_map_v1.py` (read
  only) and saves every stage for 10 real SDK frames and 10 synthetic frames to
  `test/golden/` (SensDSv2 commit 85f0517, numpy 2.4.3, scipy 1.17.1). Where a
  stage sits inside a SensDSv2 function, the script repeats those lines and
  checks they chain back to the function's output exactly.
- `radar.dsp` is now pure functions (`src/dsp/api/`): arrays in, plain nested
  arrays out in SensDSv2's layouts, settings passed in. The stateful live
  processors moved to `radar.stream`.
- `radar.data`: .npy (byte-identical to numpy.save), CSV (one row per time
  step: `spectrogramTable`, `trackTable`), JSON recordings; File/Blob based.
- `radar.simulate.frames(config, { targets })`: FMCW frames in the device's
  layout and scale.
- Demo: Live, File (offline playback, track CSV) and Simulate modes, and
  Record (.npy, up to 60 s). Checked in the browser with File and Simulate;
  Live mode's code is unchanged from the version tested on the board.
- 134 tests pass.

Fixed along the way
- The golden script's own synthetic input used the centre frequency for the
  carrier phase, so its Doppler read 4.5% high (-0.53 m/s for -0.50). Fixed
  (start frequency) and regenerated; only `test/golden/synthetic/` changed.
  No SensDSv2 function or real-data golden file was affected.

Verified against golden data (SensDSv2's own output; tolerances in
`test/golden.test.ts`; worst measured error over both inputs)

| radar.js | SensDSv2 | Worst error |
|---|---|---|
| `dsp.blackmanharris`, `dsp.chebwin` | `_range_doppler_windows` | 1e-16 |
| `dsp.rangeFft` | range-FFT lines of `compute_rdm_db` | 6e-16 of peak |
| `dsp.rangeDopplerMap` | `compute_rdm_db` | 2e-10 dB |
| `dsp.selectRangeBin`, `dsp.smoothRangeBins` | `select_range_bin_raw`, `smooth_range_bins` | exact |
| `dsp.dopplerSpectrogram` | `compute_recorded` | 6e-10 dB, bins exact |
| `stream.LiveSpectrogram` | `LiveDopplerProcessor` | 3e-11 dB, bins exact |
| `dsp.butter`, `dsp.mtiHighpass` | `_MTI_B`, `_MTI_A`, `lfilter` | exact |
| `dsp.slowTimeSignal` | `spectrogram_from_frames` steps 1-7 | 3e-14 of peak |
| `dsp.stft` | `_stft_hanning` | 7e-16 of peak |
| `dsp.stftSpectrogram` | `spectrogram_from_frames` | 2e-13 of peak |
| `dsp.spectrogramToDb` | `spectrogram_to_db` | exact (float32) |
| `dsp.rangeAxis` | `range_axis_m` | exact |
| `dsp.rangeProfile`, `dsp.rangeMap` (raw, mti) | `frame_profile`, `compute_range_map` | 1e-12 dB |

Verified another way (no SensDSv2 function to compare with)
- `dsp.velocityAxis`: zero at the centre bin, +/-4.1124 m/s; SensDSv2's
  REF_MAX_SPEED_M_S (4.112380411522634) agrees to 0.25 ppm (it implies a
  60.749985 GHz centre, presumably the SDK's own figure). Puts simulated and
  golden synthetic targets at their speed within one bin.
- `simulate.frames`: targets peak at their range bin (+/-1) and Doppler bin
  (+/-1); MTI removes still targets; matches the golden script's Python
  generator to within its noise.
- `data`: .npy bytes equal numpy.save's; CSV and JSON round trips exact;
  `trackTable` follows the synthetic target.

Not verified
- ~~Velocity sign on the real board~~: checked and fixed, see the section
  "velocity sign, checked on the board".
- The .npy layout against a real Radar Fusion GUI file (none on this
  machine); it matches what SensDSv2 reads.
- Record and Live mode together on the board (Record was checked with the
  simulated stream).
- The intermediate 2-D STFT stages (range FFT of length 2N, clutter removal)
  have no public function of their own; they are covered through
  `mtiHighpass` and `slowTimeSignal`.

## 2026-10-21: velocity sign, checked on the board

The spectrogram plot was upside down; radar.dsp was right.

- Test: a hand moved toward the radar and away, recorded live with radar-js
  (23 s, 230 frames). The owner saw "toward" go **above** the centre line.
- Objective check: over the recording, the range trend (loudest cell of each
  frame's range-Doppler map) and the sign of its Doppler velocity agreed in
  89 of 90 moving frames: range falling with negative velocity, rising with
  positive. So negative = toward the radar, as `radar.dsp.velocityAxis` and
  `radar.simulate` already had it.
- The copied plot drew Doppler bin 0 (most negative) at the top beside the
  +4.11 m/s label, because SensDSv2's figure uses `origin="upper"` with
  extent [-max, +max] (`core/doppler_spectrogram_live.py:362-373`; the
  recorded plot at :288-293 has the same layout). Fixed in radar-js
  (`historyToPlotData` reverses the rows): toward the radar now shows below the
  centre, with negative labels.
- **sensds-web's readout is wrong** about its own plot: `src/app/visualize.js:112`
  says "Toward radar below the center", but its plot (the same code) draws
  toward above the centre. Not edited (read only). SensDSv2's plots carry the
  same inversion.
- Pinned by `test/velocity_sign.test.ts` with 10 frames of that recording
  (`test/fixtures/sign/hand_away_toward.npy`).

## 2026-10-21: capture layer, Dataset mode, benchmark (merged into main)

- `radar.capture`: timed recordings with a timing sidecar (`<name>.timing.json`:
  arrival times, board, browser, radar-js build), saved to a chosen folder
  (File System Access, remembered) or downloaded. `radar.bench`: timed
  processing in a worker and summary statistics.
- Demo: Dataset mode for labeled clips (`data/README.md`, the recording
  protocol; `tools/check_captures.ts` writes `data/manifest.csv`), and a Live
  benchmark.

## 2026-11-04: frame alignment, loss diagnostics, SDK A/B (branch eval/live-verification)

- **Frame metadata** from the device: each frame's packet counter and
  firmware timestamp reach `onFrame` (`test/frame_meta.test.ts`), so the
  board's own clock times every frame.
- **Frames misaligned after a dropped slice.** A live session had every frame
  starting one slice late (antennas rotated, chirps cut 86 samples off).
  After a lost slice the reader starts its next frame at whatever slice
  comes next, as the SDK's `get_next_raw_frame` does; SensDSv2
  (`core/radar.py`, `_TRANSIENT_ERRORS`) and sensds-web also skip and go on.
  radar-js now restarts the acquisition on a drop
  (`test/frame_alignment.test.ts`). `tools/check_capture.py` checks the
  alignment of every capture.
- **Loss diagnostics**: why each drop happened (packet gap, CRC error, sync
  lost, ...), per phase (idle, recording, saving), in a session log.
  Stopping the radar while saving removed save-time losses.
- **Antenna 0 clips** about 18–20% of samples at ADC code 0; the same with
  the Infineon SDK on the same placement, and the same register values for
  all three channels. Antenna 1 is used for figures and sanity checks.
- **A/B with the SDK** (`tools/sdk_capture.py`, SensDSv2's `build_config`):
  per-antenna means within 8 codes, mean chirps r ≥ 0.9995, registers equal
  apart from the FIFO field written at start.

## 2026-11-05: live verification (branch eval/live-verification)

Results in `docs/verification-summary.md`; capture checksums in
`docs/verification-captures.sha256`. Summary:

- **Level 1 decoder check** against the Infineon SDK
  (`tools/compare_ab.py`): pan at 1.0 m 21/21 checks, at 2.0 m back to back
  20/21 (same range bins, levels within 0.33 dB); hand motion 4/5 (the second
  hand motion was slower).
- **Five live captures** (`empty_room`, `static_target`, `hand_gesture`,
  `walking`, `mixed`): 4 with no drop; frame period 100.011 ms on the board
  clock (9.9989 frames/s); the browser clock within 62–297 ppm.
- **Sanity checks** (`tools/sanity_checks.ts`, radar.dsp, antenna 1): the pan
  at 1.0 m reads 0.933 m (6–8 cm short at 1 and 2 m in both readers: a fixed
  offset); toward is negative in 96.6–98.9% of moving frames.
- **Live golden data** (`make_golden.py --input`): hand_gesture 0:50,
  walking 0:50, empty_room 100:150, antennas 0 and 1, from SensDSv2
  `f693dd1`. 240 golden checks pass (SDK, synthetic and 6 live inputs);
  worst live error 4.1e-10 dB (`rangeDopplerMap`). The live `.npy` files are
  not committed (112 MB); their manifests and SHA-256 sums are.
- **Loss trace** (`src/device/link.js`): each CRC error placed in the byte
  stream. During captures 4b–4e all 123 drops were while idle (none while
  recording or saving); the traced losses are bytes missing, not added. Where they are lost is open.
- Fixed: the Live recorder counted no restarts (`98c02a9`).
- Open items: `docs/verification-summary.md` section 6.

## Next

0. From the verification (`docs/verification-summary.md` section 6): the USB
   loss soak test, realignment time, a third range distance, Level 2
   (same bytes through both decoders), the Session B benchmark page.

1. ~~Velocity sign~~ (done 2026-10-21).
2. Compare a live capture with SensDSv2 frame by frame, and show the STFT
   spectrogram in the demo next to the Doppler one.
3. `configure()` for other chirp settings: port the SDK's register
   calculation (lib_avian), so the register list is no longer fixed.
4. Golden data for more inputs (a recorded gesture from the board, once
   recorded with the demo's Record button).
5. Type declarations (`.d.ts`) for npm, and an npm publish once licensing for
   the Strata-derived files is settled for package distribution.
6. `src/ml/`: still a placeholder.
