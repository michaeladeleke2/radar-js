"""
Dev-time oracle for the STFT spectrogram port (src/dsp/stft*.ts and friends).
Not part of the library.

Runs SensDSv2's core/processing.py, read only, on the 20 real radar frames in
test/fixtures/radar/python_frames.npy and writes what it computes to
test/fixtures/stft/ for test/stft.test.js:

    python3 tools/make_stft_fixtures.py /Users/michaeladeleke/SensDSv2

Saved (2-D arrays transposed to [column][frequency], the JS layout):
  hanning_256          _HANNING_WIN
  mti_b, mti_a         _MTI_B, _MTI_A = butter(1, 0.01, 'high')
  butter_*             butter() for other orders and types
  slow_time_{mti,raw}  the signal spectrogram_from_frames hands _stft_hanning
                       (re, im), captured by wrapping _stft_hanning
  lfilter_raw          lfilter(_MTI_B, _MTI_A, slow_time_raw) (re, im)
  spect_{mti,raw}      spectrogram_from_frames(frames, mti)
  db_mti               spectrogram_to_db(spect_mti) (float32 values)
  spect_short, db_short  the same for 2 frames: too short for one column
"""
import sys
sys.dont_write_bytecode = True          # never write __pycache__ into the reference repo

import importlib.util
import json
import pathlib

import numpy as np
import scipy
from scipy.signal import butter, lfilter

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "test" / "fixtures" / "stft"


def load_processing(sensds_root):
    path = pathlib.Path(sensds_root) / "core" / "processing.py"
    spec = importlib.util.spec_from_file_location("ref_processing", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def main(sensds_root):
    proc = load_processing(sensds_root)
    OUT.mkdir(parents=True, exist_ok=True)
    frames = np.load(ROOT / "test" / "fixtures" / "radar" / "python_frames.npy")
    arrays, index, offset = [], {}, 0

    def add(name, a):
        nonlocal offset
        a = np.ascontiguousarray(np.asarray(a, dtype="<f8"))
        index[name] = {"shape": list(a.shape), "offset": offset}
        arrays.append(a.tobytes())
        offset += a.nbytes

    def add_complex(name, a):
        add(f"{name}_re", a.real)
        add(f"{name}_im", a.imag)

    # Record the slow-time signal spectrogram_from_frames passes to the STFT.
    captured = []
    original = proc._stft_hanning

    def recording(signal, *args, **kwargs):
        captured.append(np.array(signal))
        return original(signal, *args, **kwargs)

    proc._stft_hanning = recording       # in this process only; the file is untouched

    add("hanning_256", proc._HANNING_WIN)
    add("mti_b", proc._MTI_B)
    add("mti_a", proc._MTI_A)
    butters = [(4, 0.2, "low"), (3, 0.3, "high"), (2, 0.05, "high"), (5, 0.6, "low")]
    for n, wn, btype in butters:
        b, a = butter(n, wn, btype)
        add(f"butter_{n}_{wn}_{btype}_b", b)
        add(f"butter_{n}_{wn}_{btype}_a", a)

    spect, slow = {}, {}
    for mti in (True, False):
        key = "mti" if mti else "raw"
        captured.clear()
        spect[key] = proc.spectrogram_from_frames(frames, mti=mti)
        slow[key] = captured[0]
        add_complex(f"slow_time_{key}", slow[key])
        add(f"spect_{key}", spect[key].T)
    add_complex("lfilter_raw", lfilter(proc._MTI_B, proc._MTI_A, slow["raw"]))
    add("db_mti", proc.spectrogram_to_db(spect["mti"]).T)

    short = proc.spectrogram_from_frames(frames[:2])
    add("spect_short", short.T)
    add("db_short", proc.spectrogram_to_db(short).T)

    meta = {
        "frames_shape": list(frames.shape),
        "constants": {k: getattr(proc, k) for k in ("STFT_NFFT", "STFT_WINDOW", "STFT_NOVERLAP", "DB_MIN", "DB_MAX")},
        "butters": [list(t) for t in butters],
        "versions": {"numpy": np.__version__, "scipy": scipy.__version__},
        "arrays": index,
    }
    (OUT / "arrays.f64").write_bytes(b"".join(arrays))
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))
    print("wrote", OUT, offset, "bytes")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
