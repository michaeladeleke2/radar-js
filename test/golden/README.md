# Golden data

SensDSv2's own processing, run on two fixed inputs, with every stage saved as
`.npy`. `test/golden.test.ts` checks each `radar.dsp` function against these
files. **Never edit them by hand**; regenerate them with:

```bash
python3 tools/make_golden.py ~/SensDSv2
```

The script imports SensDSv2's modules from their files (read only, no
`__pycache__`) and writes only here. `manifest.json` records, for every file,
its shape, dtype and the SensDSv2 function it came from, plus the SensDSv2
commit, numpy and scipy versions, and the radar configuration.

Generated from SensDSv2 commit `f693dd1` with numpy 2.4.3, scipy 1.17.1. (First
made from `85f0517`; regenerated from `f693dd1` on 2026-11-05, every `.npy`
file came out byte-identical, only the source notes in `manifest.json`
changed.)

## Inputs

| Folder | Input (`input.npy`, float32, (10, 3, 128, 256) = frames, rx, chirps, samples) |
|---|---|
| `real/` | The first 10 of the 20 frames in `test/fixtures/radar/python_frames.npy`, recorded with the Infineon Radar SDK in Python on 2026-10-19 (a still scene) |
| `synthetic/` | Made by `synthetic_frames()` in the script: a target at 0.80 m moving toward the radar at 0.50 m/s, a static reflector at 1.60 m, Gaussian noise (sd 8 ADC counts, seed 1), 12-bit quantised and scaled as the SDK does (`raw * 2 / 4095 - 1`) |

Radar configuration (both inputs): 58.0 to 63.5 GHz, 1 MHz sample rate, 256
samples per chirp, 128 chirps, chirp repetition 0.3 ms, frame repetition
0.1 s, 3 receive antennas. Antenna 0 is processed throughout.

## Live inputs (`live/`)

Frames of live radar-js recordings (Chrome, Web Serial, the board on a USB
hub), made with

```bash
python3 tools/make_golden.py ~/SensDSv2 --input test/captures/<name>.npy --frames a:b
```

| Folder | Frames | Scene |
|---|---|---|
| `live/hand_gesture/` | 0:50 of `hand_gesture.npy` (600 frames, 0 dropped) | a hand moving toward the radar to 0.3 m and away to 0.6 m |
| `live/walking/` | 0:50 of `walking.npy` (700 frames, 0 dropped) | a person walking from 3 m to 0.5 m and back |
| `live/empty_room/` | 100:150 of `empty_room.npy` (579 frames; its one drop is at frame 274) | nothing in front of the radar to 3.5 m |

Each folder: `input.npy`, float32 (50, 3, 128, 256), all three antennas;
`rx0/` and `rx1/`, every stage below for that antenna. The Doppler and
range-map functions are called with `antenna=k`; `spectrogram_from_frames`
always takes antenna 0, so it gets `data[:, k:k+1]`. Antenna 0 clips about
18% of its samples on this board (a property of the board and scene, the
same with the Infineon SDK), so antenna 1 is the cleaner check; both are
kept. `manifest.json` records the SensDSv2 commit, the capture (path, SHA-256,
frames, conditions, connection, the radar-js commit it was recorded with)
and the SHA-256 of every file.

The live `.npy` files (112 MB in all) are not committed, as the captures they
come from are not: the manifests are. `test/golden.test.ts` checks the files
against those SHA-256 sums and runs every check on them when they are
present, and skips them (saying so) when they are not, as in CI.

## Stages

All arrays keep SensDSv2's layout. Complex arrays are saved as `_re` and `_im`.

### Doppler spectrogram (`core/doppler_spectrogram_live.py`)

Range FFT: per-chirp mean removed, Blackman-Harris window, 4x zero padding
(1024), first 512 bins kept. Doppler FFT: per-range-bin mean removed,
Chebyshev window (100 dB, normalised to sum 1), 4x zero padding (512),
fftshift, power in dB with a -120 dB floor.

| File | Shape | From |
|---|---|---|
| `doppler/range_window`, `doppler_window` | (256,), (128,) | `_range_doppler_windows` |
| `doppler/range_fft_f0_{re,im}` | (512, 128) range bins x chirps | the range-FFT lines of `compute_rdm_db`, frame 0 |
| `doppler/rdm_db_f0` | (512, 512) range x Doppler | `compute_rdm_db`, frame 0 |
| `doppler/raw_bins` | (10,) int32 | `select_range_bin_raw` (from bin 15, 10 cm) per frame |
| `doppler/range_bins` | (10,) int32 | `smooth_range_bins` (median of 5, reflect) |
| `doppler/spectrogram` | (10, 512) frames x Doppler | `compute_recorded` |
| `doppler/live_history` | (10, 512) | `LiveDopplerProcessor(history_length=10)` after the last frame |
| `doppler/live_bins` | (10,) int32 | its range bin after each frame |

### STFT spectrogram (`core/processing.py`, `spectrogram_from_frames`)

Frames concatenated along slow time (1280 chirps), range FFT of length 512 with
the upper 256 bins kept and divided by 256, slow-time mean removed, MTI
high-pass `lfilter(butter(1, 0.01, 'high'))`, rows 128 to 254 summed, STFT
(Hanning 256, nfft 1024, hop 56, `(n - 257) // 56` = 18 columns), fftshift,
magnitude; dB normalised to the peak and clipped to [-20, 0].

| File | Shape | From |
|---|---|---|
| `stft/range_fft_{re,im}` | (256, 128) | steps 1-3 (first 128 of 1280 columns saved) |
| `stft/clutter_removed_{re,im}` | (256, 128) | step 4 (first 128 columns) |
| `stft/mti_{re,im}` | (256, 128) | step 5 (first 128 columns) |
| `stft/slow_time_{mti,raw}_{re,im}` | (1280,) | steps 6-7, with and without MTI |
| `stft/stft_mti_{re,im}` | (1024, 18) | `_stft_hanning`, before fftshift |
| `stft/spect_mti`, `spect_raw` | (1024, 18) | `spectrogram_from_frames(mti=True/False)` |
| `stft/db_mti` | (1024, 18) float32 | `spectrogram_to_db(spect_mti)` |
| `stft/mti_b`, `mti_a` | (2,) | `_MTI_B`, `_MTI_A` |

### Range map (`core/range_map_v1.py`)

| File | Shape | From |
|---|---|---|
| `range/range_axis_m` | (512,) | `range_axis_m` with the configuration above |
| `range/profile_{raw,mti}_f0` | (512,) | `frame_profile`, frame 0 |
| `range/map_{raw,mti}` | (10, 512) | `compute_range_map` |

## Note on SensDSv2's constants

`processing.py` sets `CHIRP_REP_TIME_S = 0.0002` (velocity axis +/-6.17 m/s)
and the Doppler script's defaults use 0.0002 and a 2 MHz sample rate, while
the radar actually runs at 0.3 ms and 1 MHz (`core/radar.py`, the SDK export
in `test/fixtures/radar/export_info.json`). These constants only label axes;
none of the arrays above depend on them. radar-js computes its axes from the
configuration passed in.
