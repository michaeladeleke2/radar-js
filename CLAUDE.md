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
- Live golden data: `make_golden.py ~/SensDSv2 --input test/captures/<name>.npy
  --frames a:b` writes `test/golden/live/<name>/` (all stages for antennas 0
  and 1; SensDSv2 commit, capture SHA-256 and conditions in its manifest).
  Its `.npy` files are not committed (over 50 MB, like the captures); the
  manifests are, with every file's SHA-256, and `golden.test.ts` runs the
  live checks when the files are present and skips them otherwise.
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
- Velocity sign: negative = toward the radar, everywhere (`radar.dsp.velocityAxis`,
  `radar.simulate`, the plot, which draws it below the centre line). Checked on
  the board (PROGRESS.md) and pinned by `test/velocity_sign.test.ts` with a
  live recording.
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
- `src/device/strata.js`, `device.js`, `session.js`: per-frame device
  metadata. `SliceAssembler` passes the packet counter of each slice's first
  packet with the slice (it already parsed the firmware timestamp);
  `RawFrameReader` keeps the counter and timestamp of the slice holding each
  frame's first byte (`lastMeta`); `RadarDevice.nextFrame` copies it to
  `lastFrameMeta`; the session hands `{ index, counter, timestamp }` to
  `onFrame` subscribers as a second argument. Frame data and timing are
  unchanged. Tested in `test/frame_meta.test.ts`.
- `src/device/session.js`: a dropped slice (`FrameAcquisitionFailed`) now
  restarts the acquisition instead of being skipped. Skipping (sensds-web,
  SensDSv2 and the SDK's `get_next_raw_frame`) leaves every later frame
  starting mid-stream: antennas rotated and chirps cut in the wrong place.
  Found on the board 2026-11-04; `test/frame_alignment.test.ts`.
- `src/device/strata.js`, `link.js`, `device.js`, `session.js`: loss
  diagnostics. Each `SliceAssembler` error says why (`reason`: packet_gap
  with the packets `lost`, crc_error, channel_mismatch, pool_depleted,
  size_exceeded, firmware_error); `Link` counts sync losses; `RadarDevice`
  tallies them (`diagnostics()`); `radarStats()` returns them with the
  restart total. A drop's restart does not count toward `MAX_RESTARTS`.
- `src/device/link.js`, `device.js`, `session.js`: loss trace. `PacketParser`
  gives each packet its stream position (`offset`, and `raw` for data
  packets; its `clear()` keeps the position); `Link` records every `read()`
  chunk (position, size, time; the last 512) and the last 256 KB of the
  stream, and traces each CRC error and sync loss (the last 100). A CRC trace
  finds the next header (same channel, counter +1 to +8) inside the bad packet
  or in the 8 KB after it: the signed `shift` from where it should be
  (negative: bytes missing; positive: bytes added), `counter_step` (over 1:
  whole packets gone), whether the change lies inside one received chunk, and
  the packet and the 256 bytes after it as hex. A sync-loss trace gets the
  first good packet after it (`resync`). `Link.lossTraces()`,
  `RadarDevice.lossTraces()`, `radarStats().lossTraces`. The demo saves them
  in the session log and the recording sidecar (`loss_traces`). Added
  2026-11-05 for the CRC-error drops seen with radar-js and not the SDK;
  `test/loss_trace.test.ts` (the fake board's `cut` option: bytes lost or
  sent twice).
- `src/device/link.js`: resynchronisation (2026-11-06). On a sync loss
  BridgeSerial drops everything buffered; `PacketParser` instead looks
  through the buffered bytes for the next packet start and accepts it only
  when the whole packet is there and its CRC passes (a header in payload
  bytes is not taken for one; an undecided position does not hold up a later
  verified packet, so a reply that ends the stream is not stuck). A header
  with a length no packet has (over `SERIAL_MAX_PACKET_SIZE`) is a sync loss
  too, not a 64 kB wait. One sync loss is reported per place the stream was
  out of step (it was one per dropped chunk). `clear()` still takes the next
  bytes as a packet start, as BridgeSerial does before a command. Without a
  loss, parsing is unchanged. Why: the soak test
  (`docs/soak-test-2026-11-06.md`) showed most missing frames were 1 s reply
  timeouts in the restart, the replies thrown away with the buffer.
  `test/resync.test.ts` (fake headers in payload, a fake long header before a
  final reply, a corrupt packet, an impossible length, a session whose
  restart replies come behind misaligned bytes: the fake board's
  `junkBeforeReply`). `test/loss_trace.test.ts`'s offsets test now builds
  its packets with valid CRCs (its expected results are unchanged).
- `src/viz/image.js`: `historyToPlotData` reverses the Doppler rows, so the
  most positive velocity is drawn at the top beside the +max label. SensDSv2's
  figure (and the sensds-web copy) draws toward-the-radar at the top, against
  its own labels; found with the board on 2026-10-21. `test/viz.test.js` still
  compares `makeImage` with matplotlib using SensDSv2's unreversed data.
- `test/fake_board.js`: the simulated board, moved out of `device.test.js`
  and taught the board-info request, several frames per trigger, a lost
  packet (`lose`), lost or repeated bytes sent in set chunk sizes (`cut`),
  and junk bytes in front of its replies (`junkBeforeReply`).

Not from sensds-web (new ports, no copied file changed):

- STFT spectrogram method from SensDSv2 `core/processing.py`
  (`spectrogram_from_frames`, `_stft_hanning`, `spectrogram_to_db`):
  `src/dsp/slow_time.ts`, `stft.ts`, `stft_spectrogram.ts`,
  `spectrogram_to_db.ts`, `mti_highpass.ts`, with scipy's `butter` and
  `lfilter` (`butter.ts`, `lfilter.ts`) and numpy's `hanning` (`hanning.ts`).
  These kernels lay 2-D results out [column][frequency]; the public
  `radar.dsp` versions return SensDSv2's [frequency][column].
