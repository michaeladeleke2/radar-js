# Live verification summary

Branch `eval/live-verification`, 2026-11-04 and 2026-11-05. Every result here
comes from live radar data recorded on the board in this session, except the
two fixed golden inputs (an Infineon SDK capture from 2026-10-19 and a
synthetic recording), which are listed for comparison.

## Setup

| | |
|---|---|
| Radar | Infineon BGT60TR13C on the Radar Baseboard MCU7 (MCU B), firmware 2.9.0, board UUID 00323353-4834-4a57-3031-303037303530 |
| Connection | USB 2.0 hub (214b:7250), no other devices on it, for every capture (`connection_type` in every sidecar) |
| Computer | MacBook Pro M4 (Mac16,1), macOS 27.2.0 |
| Browser | Google Chrome 156.0.8078.48, Web Serial, demo at `http://localhost:5173` (Vite dev server) |
| Radar settings | `SENSDS_CONFIG` (SensDSv2 `core/radar.py` `build_config`): 58.0 to 63.5 GHz, 1 MHz sampling, 256 samples, 128 chirps, **chirp repetition time 0.0003 s** (as reported in every sidecar and the session log), frame repetition 0.1 s, 3 receive antennas, IF gain 33 dB, high-pass 20 kHz, low-pass 500 kHz |
| Axes | range bins 6.81 mm (1024-point FFT; native resolution c/2B = 2.73 cm), to 3.48 m; velocity ±4.11 m/s, negative = toward the radar |
| SensDSv2 | commit `f693dd1c0b477a0cf9f0da5d4a008bb998bdc999` (read from its `.git` files; SensDSv2 not modified, no git run in it) |
| Reference SDK | Infineon Radar SDK 3.6.4+4b4a6245, Python 3.13.12 (`tools/sdk_capture.py`, SensDSv2's own `build_config`) |
| Python | numpy 2.4.3, scipy 1.17.1 |

radar-js commits: each recording's sidecar names the commit it was recorded
with (`radar_js.commit`, all with a clean working tree). The SDK captures
before `675d411` have no commit field (`sdk_capture.py` added it then; the
script itself did not change before that), so their commit is derived from
capture and commit times: `ab_sdk` and `l1_static1m_sdk` at `ab416b7`,
`l1_static2m_sdk` and `l1_motion_sdk` at `98c02a9`.

## 1. DSP: radar.dsp against SensDSv2 (golden data)

`tools/make_golden.py` runs SensDSv2's own functions (loaded by file path,
read only) and saves every stage; `test/golden.test.ts` compares every
`radar.dsp` function and `radar.stream.LiveSpectrogram` with it. Inputs:

| Input | Frames | Source |
|---|---|---|
| SDK | 10 | `test/fixtures/radar/python_frames.npy`, Infineon SDK in Python, 2026-10-19 (antenna 0) |
| Synthetic | 10 | `make_golden.py` FMCW model: target 0.80 m at −0.50 m/s, reflector 1.60 m (antenna 0) |
| Live `hand_gesture` | 0:50 | live radar-js recording (antennas 0 and 1) |
| Live `walking` | 0:50 | live radar-js recording (antennas 0 and 1) |
| Live `empty_room` | 100:150 | live radar-js recording (antennas 0 and 1), clear of its drop at frame 274 |

30 checks per input, 8 inputs (6 live: 3 captures × 2 antennas), **240
checks, all pass**. Regenerating the SDK and synthetic golden data from
SensDSv2 `f693dd1` gave byte-identical files to the ones made from `85f0517`.
The live golden `.npy` files (112 MB) are not committed; their manifests,
with every file's SHA-256, are (`test/golden/live/*/manifest.json`).

Tolerances: EXACT (integers, float32 dB image), COEF ≤ 1e-12 (windows,
coefficients, axes), REL ≤ 1e-9 of the peak (after an FFT), DB ≤ 1e-8 dB.

Worst error per check:

| Check | Tolerance | SDK | Synthetic | Live (worst of 6) |
|---|---|---|---|---|
| `rangeFft` re / im | REL | 3.3e-16 / 2.9e-16 | 5.3e-16 / 5.3e-16 | 4.3e-16 / 5.1e-16 |
| `rangeDopplerMap` | DB | 1.2e-10 | 1.0e-10 | 4.1e-10 (empty_room rx1) |
| `selectRangeBin` | EXACT | 0 | 0 | 0 |
| `smoothRangeBins` | EXACT | 0 | 0 | 0 |
| `dopplerSpectrogram` (dB / range bins) | DB / EXACT | 1.5e-11 / 0 | 1.5e-10 / 0 | 8.9e-11 / 0 |
| `stream.LiveSpectrogram` (history / bins) | DB / EXACT | 1.5e-11 / 0 | 1.6e-11 / 0 | 3.7e-11 / 0 |
| `butter(1, 0.01, 'high')` b, a | COEF | 0 | 0 | 0 |
| `mtiHighpass` re / im | REL | 0 | 0 | 0 |
| `slowTimeSignal` mti re / im | REL | 1.1e-14 / 2.7e-14 | 9.1e-16 / 1.5e-15 | 2.0e-14 / 1.3e-14 |
| `slowTimeSignal` raw re / im | REL | 1.3e-14 / 3.1e-14 | 9.8e-16 / 1.6e-15 | 2.9e-14 / 1.8e-14 |
| `stftSpectrogram` mti / raw | REL | 2.3e-14 / 1.9e-13 | 4.4e-16 / 4.6e-16 | 2.2e-14 / 1.4e-13 |
| `stft` re / im | REL | 7.1e-16 / 5.3e-16 | 5.3e-16 / 5.5e-16 | 5.7e-16 / 6.4e-16 |
| `spectrogramToDb` (golden in; end to end) | EXACT | 0 | 0 | 0 |
| `blackmanharris(256)` | COEF | 1.1e-16 | 1.1e-16 | 1.1e-16 |
| `chebwin(128, 100)` / sum | COEF | 2.1e-17 | 2.1e-17 | 2.1e-17 |
| `rangeAxis` | COEF | 0 | 0 | 0 |
| `rangeProfile` raw / mti (frame 0) | DB | 7.4e-13 / 6.9e-13 | 6.4e-14 / 1.0e-13 | 1.9e-12 / 1.4e-12 |
| `rangeMap` raw / mti | DB | 8.3e-13 / 1.4e-12 | 9.2e-14 / 1.9e-13 | 2.4e-12 / 2.4e-12 |

Live data stays as far inside the tolerances as the SDK capture: the closest
is `rangeDopplerMap`, 4.1e-10 dB against 1e-8 dB.

### Coverage of the 20 radar.dsp functions

| Function | Golden test (SDK, synthetic, live) | Other check |
|---|---|---|
| `rangeFft`, `rangeDopplerMap`, `selectRangeBin`, `smoothRangeBins`, `dopplerSpectrogram` | yes | |
| `rangeProfile`, `rangeMap`, `rangeAxis` | yes | |
| `slowTimeSignal`, `stft`, `stftSpectrogram`, `spectrogramToDb`, `mtiHighpass` | yes | |
| `blackmanharris`, `chebwin`, `butter` | yes | |
| `velocityAxis` | no golden file | `test/dsp_api.test.ts`: exact against λ/(4·T_chirp) at 60.75 GHz, and within 1e-6 of SensDSv2's `REF_MAX_SPEED_M_S` (they differ by 0.25 ppm, from that constant's centre-frequency rounding); sign pinned by `test/velocity_sign.test.ts` and section 4 below |
| `fft` | inside `rangeFft`, `rangeDopplerMap`, `stft` | `test/dsp_api.test.ts` |
| `hanning` | inside `stft` / `stftSpectrogram` | `test/stft.test.js` fixtures (numpy) |
| `lfilter` | inside `mtiHighpass` | `test/stft.test.js` fixtures (scipy) |

16 of 20 are golden-tested directly on all inputs; the other 4 through the
functions that use them and their own tests.

## 2. Decoder: radar-js against the Infineon SDK (Level 1)

One board, one reader at a time: the SDK capture and the radar-js capture of
each scene were made one after the other, nothing moved. So the comparison is
statistical (`tools/compare_ab.py`, SensDSv2's range and Doppler functions,
thresholds fixed before the captures), not sample by sample. First 5 s of
each dropped.

| Scene | Pair (order) | Checks | Result |
|---|---|---|---|
| A: aluminum pan at 1.0 m | `l1_static1m_sdk` → `l1_static1m_rjs` | **21/21** | same range bin on all antennas (0.927 / 0.920 / 0.913 m), level within 0.16 dB, mean chirp r ≥ 0.99999, mean ADC code within 1.9 |
| B: pan at 2.0 m | `l1_static2m_rjs` → `l1_static2m_sdk`, 3.5 min apart | 15/21 | fails are scene change: radar-js against itself 6 min apart fails the same way (profile r 0.82, RMS 5.4 dB) |
| B repeat | `l1_static2m_sdk` → `l1_static2m_rjs2`, back to back | **20/21** | same range bin on all antennas (1.935–1.949 m), level within 0.33 dB, mean chirp r ≥ 0.99985; the one fail is rx0's profile correlation 0.966 (limit 0.98), on the clipping antenna |
| C: hand toward/away | `l1_motion_sdk` → `l1_motion_rjs` | 4/5 | toward share agrees (difference 0.15); speed fails (p95 0.64 vs 0.40 m/s) because the second hand motion was slower: within each capture the speed is steady per 5 s quarter (SDK 0.60–0.66, radar-js 0.35–0.43 m/s) |
| Pre-test (2026-11-04): seated person | `ab_sdk` → `ab_radarjs` | 12/15 | means, spread, clipping and mean chirp (r ≥ 0.9995) agree; profile checks fail where the person sat |

Registers: identical between the SDK's register file and radar-js's, apart
from SFCTL FIFO_CREF (0x1027ff saved before start vs 0x102fff set at start).
Antenna 0 clips 17–20% of samples at ADC code 0 with both readers (e.g.
17.32% SDK, 17.39% radar-js in scene A).

Not covered: a sample-by-sample comparison of the same bytes through both
decoders (Level 2). The Python SDK does not take bytes from outside; the
plan is a line-by-line port of its decoding code, so that result will be
about the port, not the SDK itself.

## 3. Captures

`test/captures/` (not committed; SHA-256 in `docs/verification-captures.sha256`).
All: shape (frames, 3, 128, 256) float32, values in −1..1, no NaN, no
repeated frames, frame alignment check passes (`tools/check_capture.py`).

| Capture | Duration | Frames | Drops | Board-clock period | Browser / board clock | rx0 clipping | radar-js | Conditions |
|---|---|---|---|---|---|---|---|---|
| `empty_room` | 60 s | 579 / 600 | 1 (realigned, 20 frames lost) | 100.011 ms | 1.000077 | 18.8% | `1265b5f` | nothing in front to 3.5 m, operator out of the room |
| `static_target` | 30 s | 300 / 300 | 0 | 100.011 ms | 1.000853 (*) | 18.7% | `675d411` | aluminum pan at 1.0 m, operator still behind the board |
| `hand_gesture` | 60 s | 600 / 600 | 0 | 100.011 ms | 1.000297 (*) | 17.9% | `675d411` | hand toward 0.3 m and away 0.6 m, about 1 s each way |
| `walking` | 70 s (set to 70, not 60) | 700 / 700 | 0 | 100.011 ms | 1.000062 | 18.4% | `675d411` | walking 3 m to 0.5 m and back, on boresight |
| `mixed` | 60 s | 600 / 600 | 0 | 100.011 ms | 1.000067 | 18.6% | `675d411` | walk in, hand motion, walk out, stand; performed faster than scripted (the operator stood near 2.8 m for most of the second half) |

Level 1 radar-js captures: `l1_static1m_rjs` 238/250 (4 drops),
`l1_static2m_rjs` 250/250, `l1_static2m_rjs2` 239/250 (1 drop, in the first
5 s), `l1_motion_rjs` 250/250. SDK captures: 250/250 each, 0 dropped.

(*) Browser-clock arrivals alternated about 80 / 120 ms from late in
`static_target` through `hand_gesture` (arrival std 10.6 and 20.2 ms, against
0.4–0.6 ms otherwise), while the board's timestamps stayed at 100 ms; no data
was lost. Browser-clock timing should therefore use the board clock or the
mean rate, not the median gap.

### Frame rate

On the board clock (firmware timestamps, µs) the frame period is
**100.011 ms (9.9989 frames/s)** in every capture, against the configured
100 ms. The browser clock agrees within 62–297 ppm in every loss-free capture
with even delivery (853 ppm in `static_target`, from the uneven arrivals at its
end). Browser-clock rate over a recording: 9.996–9.998 frames/s without drops.
SDK captures, on Python's clock: 9.999 frames/s.

### Drops and realignment

A dropped slice restarts the acquisition so later frames stay aligned (the
SDK and SensDSv2 skip the frame and continue, which misaligns every later
frame). Gaps in the recordings, on the board clock:

| Capture | Gap | Frames not received |
|---|---|---|
| `empty_room` | 2119.8 ms | 20 |
| `l1_static1m_rjs` | 1267.8 ms, 120.2 ms, 145.4 ms (4 drops) | 12, 0, 0 |
| `l1_static2m_rjs2` | 1116.4 ms | 10 |

Realignment took 0.12–0.15 s, 1.1–1.3 s or 2.1 s. The clusters near whole
seconds suggest the 1 s request timeout inside the restart; not yet checked.

Losses by phase: in 4b–4e (session log `mixed.session.json`, 18 min) **123
drops while idle, 0 while recording, 0 while saving** (4 saves, radar
stopped while saving, 0.6–1.2 s each). Across both days, 3 of the 14
radar-js recordings in `test/captures/` (all with the realignment fix) had
drops during the recording: `l1_static1m_rjs` (4), `l1_static2m_rjs2` (1, in
the first second) and `empty_room` (1). The SDK had 0 drops in 1,200 frames.

Loss trace (from `1265b5f`): every CRC error is placed in the byte stream.
Of 123 traced in 4b–4e: 88 have bytes missing (45 to 3,066 bytes, not
multiples of 64), 34 lost the next packet's header too, 1 could not be
placed; none have bytes added. 12 of the gaps lie inside one received
`read()` chunk. Where the bytes are lost (host, driver, hub or board) is not
settled; see section 6.

## 4. Sanity checks on live data (antenna 1, radar.dsp)

`tools/sanity_checks.ts`; antenna 1 because antenna 0 clips.

**static_target** (pan measured at 1.0 m): strongest raw range-profile bin
past 0.25 m is **bin 137 = 0.933 m**, 35.7 dB over the median, the same bin
in all 300 frames. Offset −6.7 cm (−9.8 bins). With scene A (0.920–0.927 m at
1.0 m) and scene B (1.935–1.949 m at 2.0 m, −5.8 cm), the radar reads 6–8 cm
short at both distances, in both readers: a fixed offset, not a scale error
(two distances; a third would confirm).

**Motion** (Doppler peak per frame, |v| ≥ 0.15 m/s, ≥ 20 dB over the median):

| | Velocity 5–95% | Speed median / p95 | Toward frames | Sign check | r |
|---|---|---|---|---|---|
| `hand_gesture` | −0.40 to +0.40 m/s | 0.26 / 0.44 m/s | 50% | 466 / 471 same sign (98.9%) | 0.88 |
| `walking` | −0.85 to +0.98 m/s | 0.53 / 1.03 m/s | 48% | 617 / 639 (96.6%) | 0.87 |
| `mixed` | −0.52 to +1.00 m/s | 0.26 / 1.00 m/s | 47% | 97 / 122 (79.5%) | 0.70 |

Sign check: the Doppler velocity against the rate of change of the range
the spectrogram tracks. Same sign in 96–99% of frames: **negative velocity
while the target comes closer, so toward is negative** on live data, as
`test/velocity_sign.test.ts` pins for a recorded sweep. The walker's range
spans 0.53–3.07 m (5–95%) on a cycle of about 10 s.

## 5. What this supports

- radar-js's DSP reproduces SensDSv2's on live recordings to within 4.1e-10
  dB (dB outputs), 2.9e-14 of the peak (spectra) and exactly (range bins,
  dB image), the same as on an SDK capture.
- radar-js's decoder gives the same scene as the Infineon SDK: same range
  bins, levels within 0.33 dB, mean chirps r ≥ 0.99985, in back-to-back
  static captures (scene A 21/21, scene B repeat 20/21).
- Live captures in Chrome over Web Serial run at the board's 9.9989 frames/s;
  4 of the 5 step-4 captures and most Level 1 captures lost no frame.
- The velocity sign convention holds on live data.

## 6. Open items (logged, not yet analyzed)

1. **USB losses, radar-js only, mostly while idle.** CRC errors with sync
   losses; byte loss (not added bytes) per the trace. Why idle and not
   recording; where the bytes go. Planned: the soak test (SDK, radar-js with
   and without the plot, same placement, hands off).
2. **Realignment time** clusters near 0.1, 1 and 2 s: check the restart's
   request timeouts.
3. **Range offset** of 6–8 cm short at 1 and 2 m (both readers): a third
   distance.
4. **The board's processor restarted** between `empty_room` and
   `static_target` (uptime about 230 s at 23:00:59 UTC, so a restart near
   22:57:10 UTC); not unplugged. Possibly a power dip through the hub.
5. **Uneven browser delivery** (80 / 120 ms) in `static_target` and
   `hand_gesture`, gone by `walking`.
6. **Antenna 0 clips** 17–20% at ADC code 0 in every scene, with both readers:
   a board and scene property. Antenna 1 is used for figures and checks.
7. **The demo's Disconnect**: twice the SDK could not open the board because
   Chrome still held the port; after the second, the operator said the button
   had not been clicked. Not pursued unless it recurs.
8. **`mixed`** was performed faster than scripted; usable as a mixed scene,
   could be re-recorded.
9. **Level 2** (same bytes through both decoders): not done; see section 2.
