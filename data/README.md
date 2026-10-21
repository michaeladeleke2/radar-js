# radar-js live data set

Hand gestures recorded live from the Infineon BGT60TR13C radar (Radar
Baseboard MCU7) with the radar-js demo, so they can be used to verify radar-js
against SensDSv2 and to replay benchmarks. Every number in the radar-js paper
comes from recordings made this way; no simulated data is used.

## What is here

| Path | In git | What |
|---|---|---|
| `captures/` | no (about 12 MB per 3 s clip) | Each clip as `<label>_<distance>m_<YYYYMMDD-HHMMSS>.npy` plus a `.json` sidecar; live benchmark runs as `live_<main|worker>_<YYYYMMDD-HHMMSS>.npy` / `.json` |
| `manifest.csv` | yes | One row per capture: file, label, distance, frames, drops, SHA-256 (`node tools/check_captures.ts`) |
| `benchmarks/` | yes | The sidecars of live benchmark runs (results, device, build) |

The raw captures are archived outside git for the paper; `manifest.csv` lists
their checksums so a downloaded copy can be checked.

## File format

- `.npy`: float32, shape (frames, 3 receive antennas, 128 chirps, 256 samples),
  little endian, C order; values are the Infineon SDK's scale
  (`raw * 2 / 4095 - 1`, -1 to 1). This is the layout SensDSv2 reads with
  `numpy.load` and its Collect tab saves. `radar.data.loadNpy` reads it.
- `.json` sidecar (`radar.capture.sidecar`): `type` (`dataset` or `live`),
  `label`, `distance_m`, `notes`, `started_at` / `ended_at` (UTC),
  `duration_s`, `frames` (`expected` = duration / 0.1 s, `received`,
  `dropped` as reported by the device, `restarts`, `shape`),
  `frame_times_ms` (arrival time of every frame), `config` (all radar
  settings, Infineon SDK names), `board` (name, firmware, chip), `device`
  (device name, browser and version, OS and version, user agent, CPU threads,
  memory), `radar_js` (version, git commit, uncommitted changes flag); live
  benchmark sidecars add `benchmark`.

## Radar settings

The SensDSv2 configuration (`src/config/config.js`): 58.0 to 63.5 GHz,
1 MHz sample rate, 256 samples per chirp, 128 chirps per frame, chirp
repetition 0.3 ms, frame repetition 0.1 s (10 frames per second), receive
antennas 1-3, transmit antenna 1, TX power 31, IF gain 33 dB, high-pass
20 kHz, low-pass 500 kHz. Range bins are 6.8 mm apart up to 3.48 m; velocity
covers +/-4.11 m/s.

## Recording protocol

Setup
1. Radar Baseboard MCU7 with the BGT60TR13C shield, flat on a table, antenna
   side facing the person, connected by USB to the recording computer. Close
   any other program using the board (SensDSv2, the Radar Fusion GUI).
2. Clear the space in front of the radar out to about 1.5 m. Note anything
   fixed in the beam (a wall, a monitor) in the notes field.
3. Mark the distances 0.3 m, 0.6 m and 1.0 m on the table, measured from the
   front face of the board along the line straight out from it.
4. In Chrome or Edge, open the demo (https://michaeladeleke2.github.io/radar-js/,
   or `npm run dev` and http://localhost:5173), choose **Dataset**, enter a
   device name, **Choose folder…** and pick `data/captures/`, then
   **Connect** (choose the Infineon port) and **Start**. Wait until the
   spectrogram scrolls.

Gestures (one hand, palm toward the radar, hand at about the height of the
board; the distance is where the gesture starts unless stated)
- **push**: start with the hand at the distance, move the palm about 20 cm
  toward the radar, stop.
- **pull**: start about 20 cm closer than the distance, move the palm away to
  the distance, stop.
- **swipe**: one pass from left to right across the front of the radar at the
  distance, about 40 cm wide.
- **wave**: two to three side-to-side waves of the open hand at the distance.
- **empty**: nobody in front of the radar; the person stands back, out of the
  beam. Recorded during each distance's session (the distance field then only
  marks the session).

Each clip
1. Pick the label and distance; clip length 3 s.
2. Press **Record clip**. A 3-2-1 countdown runs; start the gesture at GO and
   finish within the 3 s.
3. The panel shows the frames received against the 30 expected and the drops.
   A clip with missing or dropped frames, or a gesture done wrong, is
   discarded (**Discard last clip**) and recorded again.

Sessions: for each distance (0.3, 0.6, 1.0 m), 5 clips of each gesture
(push, pull, swipe, wave) and 5 empty clips. Target: 75 clips, 15 per label.
The count table in the Dataset panel tracks it.

After each session, check the clips: open a few in **File** mode (the gesture
shows in the spectrogram), and run `node tools/check_captures.ts` (every clip
loads, 30 of 30 frames, no drops; it also prints each clip's range span and
peak speed, and rewrites `manifest.csv`).

## Live benchmark

In **Live** mode with the radar streaming, set the duration (60 s) and the
processing (main thread, then Web Worker in a second run), and press **Run
live benchmark**. Keep the page in front and the computer otherwise idle. The
run saves its frames and a sidecar of type `live` with the results; copy the
sidecar to `data/benchmarks/`.
