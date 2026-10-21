"""
Golden data for radar-js: SensDSv2's own processing, run on fixed inputs, with
every stage's output saved for test/golden.test.ts.

    python3 tools/make_golden.py ~/SensDSv2

Reads SensDSv2 only (imports its modules from their files, writes no
__pycache__, runs no git). Writes test/golden/.

Inputs (each its own folder under test/golden/):
  real/       the first 10 frames of test/fixtures/radar/python_frames.npy,
              recorded with the Infineon Radar SDK in Python on 2026-10-19
  synthetic/  10 frames made here (synthetic_frames below): one target
              moving toward the radar plus a static reflector, 12-bit
              quantised and scaled as the SDK does

Pipelines and the SensDSv2 code each stage comes from (antenna 0 throughout):

  Doppler spectrogram, core/doppler_spectrogram_live.py
    doppler/range_window, doppler_window  _range_doppler_windows(256, 128)
    doppler/range_fft_f0_{re,im}          the "Range FFT across chirps" lines of
                                          compute_rdm_db, frame 0; the rest of
                                          compute_rdm_db is chained on it here
                                          and must equal compute_rdm_db exactly
    doppler/rdm_db_f0                     compute_rdm_db(frame 0)
    doppler/raw_bins                      select_range_bin_raw per frame
    doppler/range_bins                    smooth_range_bins(raw_bins, 512)
    doppler/spectrogram                   compute_recorded(data, antenna=0)[0]
    doppler/live_history, live_bins       LiveDopplerProcessor(history_length=10)
                                          after each frame (last history, all bins)

  STFT spectrogram, core/processing.py
    stft/range_fft_{re,im}         steps 1-3 of spectrogram_from_frames
    stft/clutter_removed_{re,im}   step 4
    stft/mti_{re,im}               step 5, lfilter(_MTI_B, _MTI_A, axis=1)
      (these three: all 256 range rows, first 128 slow-time columns only, to
       keep the files small; the JS computes everything and compares these)
    stft/slow_time_{mti,raw}_{re,im}  steps 6-7, the vector _stft_hanning gets
    stft/stft_mti_{re,im}          _stft_hanning(slow_time_mti), step 8
    stft/spect_mti, spect_raw      spectrogram_from_frames(data, mti) (step 9);
                                   the chain above must equal it exactly
    stft/db_mti                    spectrogram_to_db(spect_mti), float32

  Range map, core/range_map_v1.py
    range/range_axis_m             range_axis_m(512, 1024, config values)
    range/profile_{raw,mti}_f0     frame_profile(frame 0, mode)
    range/map_{raw,mti}            compute_range_map(data, mode)[0]

Arrays keep SensDSv2's layout (no transposes). manifest.json lists every file
with its shape, dtype and source; README.md describes the parameters.
"""
import sys
sys.dont_write_bytecode = True          # never write __pycache__ into SensDSv2

import importlib.util
import json
import os
import pathlib
import shutil

os.environ.setdefault("MPLBACKEND", "Agg")

import numpy as np
import scipy

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "test" / "golden"
N_FRAMES = 10
ANTENNA = 0

# The radar configuration the real frames were recorded with
# (test/fixtures/radar/export_info.json; src/config/config.js SENSDS_CONFIG).
CONFIG = json.loads((ROOT / "test" / "fixtures" / "radar" / "export_info.json").read_text())["config"]
C_MPS = 299_792_458.0


def load(sensds_root, rel, name):
    path = pathlib.Path(sensds_root) / rel
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def sensds_commit(sensds_root):
    """HEAD commit, read from the .git files (no git command in SensDSv2)."""
    git = pathlib.Path(sensds_root) / ".git"
    head = (git / "HEAD").read_text().strip()
    if head.startswith("ref: "):
        ref = head[5:]
        p = git / ref
        if p.exists():
            return p.read_text().strip()
        packed = git / "packed-refs"
        if packed.exists():
            for line in packed.read_text().splitlines():
                if line.endswith(" " + ref):
                    return line.split()[0]
        return None
    return head


def synthetic_frames(n_frames=N_FRAMES, seed=1):
    """FMCW IF samples for one moving target and one static reflector.

    Real-valued IF per receive antenna, beat frequency 2 R S / c with chirp
    slope S = bandwidth / (num_samples / sample_rate) (the slope range_axis_m
    uses), carrier phase 4 pi f_c R / c, R advancing with the target's speed
    along slow time (chirp_repetition_time_s within a frame,
    frame_repetition_time_s between frames). 12-bit ADC (offset 2048, noise
    from a seeded generator), then the SDK's scaling raw * 2 / 4095 - 1 in
    float32. Shape (n_frames, 3, 128, 256), float32.
    """
    cfg = CONFIG
    n_rx, n_chirp, n_sample = 3, cfg["num_chirps"], cfg["num_samples"]
    fs = cfg["sample_rate_Hz"]
    bw = cfg["end_frequency_Hz"] - cfg["start_frequency_Hz"]
    fc = (cfg["end_frequency_Hz"] + cfg["start_frequency_Hz"]) / 2
    slope = bw / (n_sample / fs)
    t_fast = np.arange(n_sample) / fs
    targets = [  # (range at t=0 m, radial speed m/s, amplitude in ADC counts)
        (0.80, -0.50, 600.0),
        (1.60, 0.00, 300.0),
    ]
    rx_phase = np.array([0.0, 0.7, 1.4])
    rng = np.random.default_rng(seed)
    out = np.empty((n_frames, n_rx, n_chirp, n_sample), dtype=np.float32)
    for f in range(n_frames):
        t_slow = f * cfg["frame_repetition_time_s"] + np.arange(n_chirp) * cfg["chirp_repetition_time_s"]
        sig = np.zeros((n_rx, n_chirp, n_sample))
        for r0, v, amp in targets:
            r = r0 + v * t_slow                                   # (n_chirp,)
            fb = 2.0 * r * slope / C_MPS
            phase = 2 * np.pi * fb[:, None] * t_fast[None, :] + 4 * np.pi * fc * r[:, None] / C_MPS
            sig += amp * np.cos(phase[None, :, :] + rx_phase[:, None, None])
        noise = rng.normal(0.0, 8.0, sig.shape)
        raw = np.clip(np.round(2048 + sig + noise), 0, 4095).astype(np.int64)
        out[f] = (np.float32(raw * 2) / np.float32(4095.0)) - np.float32(1.0)
    return out


class Writer:
    def __init__(self, folder, source_note):
        self.folder = folder
        self.files = {}
        self.note = source_note

    def save(self, name, array, source, dtype="<f8"):
        a = np.ascontiguousarray(np.asarray(array).astype(dtype))
        path = self.folder / f"{name}.npy"
        path.parent.mkdir(parents=True, exist_ok=True)
        np.save(path, a)
        self.files[name] = {"shape": list(a.shape), "dtype": dtype, "source": source}

    def save_complex(self, name, array, source):
        self.save(f"{name}_re", np.real(array), source + " (real part)")
        self.save(f"{name}_im", np.imag(array), source + " (imaginary part)")


def doppler_stages(w, dop, data):
    frames = data[:, ANTENNA].astype(np.float64)
    n_frame, n_chirp, n_sample = frames.shape
    range_fft_size, doppler_fft_size = n_sample * 4, n_chirp * 4
    n_range_bins = range_fft_size // 2
    rw, dw = dop._range_doppler_windows(n_sample, n_chirp)
    w.save("doppler/range_window", rw, "doppler_spectrogram_live._range_doppler_windows")
    w.save("doppler/doppler_window", dw, "doppler_spectrogram_live._range_doppler_windows")

    # compute_rdm_db, split at the range FFT (its own lines, unchanged)
    frame = data[0, ANTENNA]
    x = frame.astype(np.float64, copy=False)
    x = x - np.mean(x, axis=1, keepdims=True)
    x = x * rw
    range_buf = np.zeros((n_chirp, range_fft_size), dtype=np.complex128)
    range_buf[:, :n_sample] = x
    rdm_complex = np.fft.fft(range_buf, axis=1)[:, :n_range_bins].T      # (n_range_bins, n_chirp)
    slow = rdm_complex - np.mean(rdm_complex, axis=1, keepdims=True)
    slow = slow * dw
    doppler_buf = np.zeros((n_range_bins, doppler_fft_size), dtype=np.complex128)
    doppler_buf[:, :n_chirp] = slow
    power = np.abs(np.fft.fftshift(np.fft.fft(doppler_buf, axis=1), axes=1)) ** 2
    chained = np.full_like(power, 20.0 * np.log10(dop.CLIPPING_VALUE), dtype=np.float64)
    above = power >= dop.SPECT_THRESHOLD ** 2
    chained[above] = 10.0 * np.log10(power[above])
    rdm0 = dop.compute_rdm_db(frame, range_window=rw, doppler_window=dw,
                              range_fft_size=range_fft_size, doppler_fft_size=doppler_fft_size)
    assert np.array_equal(chained, rdm0), "range FFT split of compute_rdm_db does not reproduce it"
    w.save_complex("doppler/range_fft_f0", rdm_complex,
                   "doppler_spectrogram_live.compute_rdm_db, range FFT lines; (n_range_bins, n_chirp)")
    w.save("doppler/rdm_db_f0", rdm0, "doppler_spectrogram_live.compute_rdm_db(frame 0); (n_range_bins, doppler_fft_size)")

    raw_bins = np.array([dop.select_range_bin_raw(dop.compute_rdm_db(
        data[i, ANTENNA], range_window=rw, doppler_window=dw,
        range_fft_size=range_fft_size, doppler_fft_size=doppler_fft_size)) for i in range(n_frame)])
    w.save("doppler/raw_bins", raw_bins, "doppler_spectrogram_live.select_range_bin_raw per frame", "<i4")
    w.save("doppler/range_bins", dop.smooth_range_bins(raw_bins, n_range_bins),
           "doppler_spectrogram_live.smooth_range_bins(raw_bins, 512)", "<i4")
    spect, bins = dop.compute_recorded(data, antenna=ANTENNA)
    assert np.array_equal(bins, dop.smooth_range_bins(raw_bins, n_range_bins))
    w.save("doppler/spectrogram", spect, "doppler_spectrogram_live.compute_recorded(data, antenna=0)[0]; (n_frame, doppler_fft_size)")

    live = dop.LiveDopplerProcessor(n_sample=n_sample, n_chirp=n_chirp, history_length=10)
    live_bins = []
    for i in range(n_frame):
        history, rb = live.process_frame(data[i, ANTENNA])
        live_bins.append(rb)
    w.save("doppler/live_history", history, "LiveDopplerProcessor(history_length=10).process_frame, history after the last frame")
    w.save("doppler/live_bins", np.array(live_bins), "LiveDopplerProcessor.process_frame range bin per frame", "<i4")


def stft_stages(w, proc, data):
    keep = 128     # slow-time columns saved for the 2-D intermediate stages

    def chain(mti):
        frames = np.asarray(data, dtype=complex)
        d = frames[:, 0, :, :]
        d = np.transpose(d, (2, 1, 0))
        n_sample = d.shape[0]
        d = d.reshape((n_sample, d.shape[1] * d.shape[2]), order="F")
        range_fft = np.fft.fft(d, 2 * n_sample, axis=0)[n_sample:] / n_sample
        before = range_fft.copy()
        range_fft -= np.mean(range_fft, axis=1, keepdims=True)
        clutter = range_fft.copy()
        rngpro = proc.lfilter(proc._MTI_B, proc._MTI_A, range_fft, axis=1) if mti else range_fft
        vec = np.sum(rngpro[slice(n_sample // 2, n_sample - 1), :], axis=0)
        spect = proc._stft_hanning(vec)
        mag = np.abs(np.fft.fftshift(spect, axes=0))
        return before, clutter, rngpro, vec, spect, mag

    before, clutter, mti_out, vec_mti, stft_mti, mag_mti = chain(True)
    *_, vec_raw, _, mag_raw = chain(False)
    spect_mti = proc.spectrogram_from_frames(data, mti=True)
    spect_raw = proc.spectrogram_from_frames(data, mti=False)
    assert np.array_equal(mag_mti, spect_mti), "STFT chain does not reproduce spectrogram_from_frames(mti=True)"
    assert np.array_equal(mag_raw, spect_raw), "STFT chain does not reproduce spectrogram_from_frames(mti=False)"

    src = "processing.spectrogram_from_frames"
    w.save_complex("stft/range_fft", before[:, :keep], f"{src} steps 1-3; (256 range rows, first {keep} slow-time columns)")
    w.save_complex("stft/clutter_removed", clutter[:, :keep], f"{src} step 4; (256, first {keep} columns)")
    w.save_complex("stft/mti", mti_out[:, :keep], f"{src} step 5, lfilter(_MTI_B, _MTI_A); (256, first {keep} columns)")
    w.save_complex("stft/slow_time_mti", vec_mti, f"{src} steps 6-7 (mti=True); (n_chirps,)")
    w.save_complex("stft/slow_time_raw", vec_raw, f"{src} steps 6-7 (mti=False); (n_chirps,)")
    w.save_complex("stft/stft_mti", stft_mti, "processing._stft_hanning(slow_time_mti); (1024, n_cols)")
    w.save("stft/spect_mti", spect_mti, "processing.spectrogram_from_frames(data, mti=True); (1024, n_cols)")
    w.save("stft/spect_raw", spect_raw, "processing.spectrogram_from_frames(data, mti=False); (1024, n_cols)")
    w.save("stft/db_mti", proc.spectrogram_to_db(spect_mti), "processing.spectrogram_to_db(spect_mti); (1024, n_cols)", "<f4")
    w.save("stft/mti_b", proc._MTI_B, "processing._MTI_B = butter(1, 0.01, 'high')")
    w.save("stft/mti_a", proc._MTI_A, "processing._MTI_A")


def range_stages(w, rm, data):
    n_frame, _, n_chirp, n_sample = data.shape
    range_fft_size, doppler_fft_size = n_sample * 4, n_chirp * 4
    rw, dw = rm._windows(n_sample, n_chirp)
    axis_kw = dict(sample_rate_hz=CONFIG["sample_rate_Hz"], start_frequency_hz=CONFIG["start_frequency_Hz"],
                   end_frequency_hz=CONFIG["end_frequency_Hz"])
    w.save("range/range_axis_m", rm.range_axis_m(range_fft_size // 2, range_fft_size, n_sample=n_sample, **axis_kw),
           "range_map_v1.range_axis_m(512, 1024, config sample rate and frequencies)")
    for mode in ("raw", "mti"):
        w.save(f"range/profile_{mode}_f0", rm.frame_profile(data[0, ANTENNA], mode=mode, range_window=rw, doppler_window=dw,
                                                            range_fft_size=range_fft_size, doppler_fft_size=doppler_fft_size),
               f"range_map_v1.frame_profile(frame 0, mode='{mode}'); (n_range_bins,)")
        rmap, _ = rm.compute_range_map(data, antenna=ANTENNA, mode=mode, **axis_kw)
        w.save(f"range/map_{mode}", rmap, f"range_map_v1.compute_range_map(data, mode='{mode}')[0]; (n_frame, n_range_bins)")


def main(sensds_root):
    dop = load(sensds_root, "core/doppler_spectrogram_live.py", "ref_doppler")
    proc = load(sensds_root, "core/processing.py", "ref_processing")
    rm = load(sensds_root, "core/range_map_v1.py", "ref_range_map_v1")

    if OUT.exists():
        shutil.rmtree(OUT)
    real = np.load(ROOT / "test" / "fixtures" / "radar" / "python_frames.npy")[:N_FRAMES]
    inputs = {
        "real": (real, "first 10 frames of test/fixtures/radar/python_frames.npy (Infineon Radar SDK, 2026-10-19)"),
        "synthetic": (synthetic_frames(), "tools/make_golden.py synthetic_frames(): target 0.80 m at -0.50 m/s (toward the radar), static reflector 1.60 m, noise sd 8 counts, seed 1"),
    }
    manifest = {
        "generated_by": "tools/make_golden.py",
        "sensds_commit": sensds_commit(sensds_root),
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "config": CONFIG,
        "antenna": ANTENNA,
        "inputs": {},
    }
    for name, (data, note) in inputs.items():
        w = Writer(OUT / name, note)
        w.save("input", data, note + "; (n_frame, n_rx, n_chirp, n_sample)", "<f4")
        doppler_stages(w, dop, data)
        stft_stages(w, proc, data)
        range_stages(w, rm, data)
        manifest["inputs"][name] = {"description": note, "files": w.files}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum(p.stat().st_size for p in OUT.rglob("*.npy"))
    print(f"wrote {OUT} ({total / 1e6:.1f} MB)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python3 tools/make_golden.py <path to SensDSv2>")
    main(sys.argv[1])
