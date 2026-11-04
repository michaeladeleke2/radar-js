"""
Check a radar-js capture (.npy) and, when present, its timing sidecar.

    python3 tools/check_capture.py <capture.npy> [--duration SECONDS]

Step 1 checks (numpy only, independent of radar-js's own loader):
  - numpy.load reads it
  - shape is (frames, 3, 128, 256) and dtype float32
  - every value is finite (no NaN, no Inf) and within -1..1
  - the frame count matches duration x frame rate within 2 frames; the
    duration comes from --duration, else from the sidecar
  - repeated frames: consecutive frames that are byte-identical
  - frame alignment: in every chirp the largest sample-to-sample jump is the
    chirp boundary; on the channel where it stands out most it must fall after
    sample 255. A frame that starts mid-stream (a lost slice; 2026-11-04) puts
    it mid-chirp and rotates the antennas, which no other check here notices

Step 2 timing report (when <base>.timing.json exists next to the .npy):
  - frame rate from the arrival times: median and standard deviation of the
    gaps between frames, the largest gap
  - dropped frames: gaps longer than 1.5 x the nominal frame time, and the
    frames the device itself reported as dropped
  - the device frame counter, if the sidecar carries one: steps other than
    the usual one are reported as gaps or repeats

Exit status 0 when every check passes, 1 otherwise.
"""
import argparse
import json
import pathlib
import sys

import numpy as np

EXPECTED_TAIL = (3, 128, 256)


def report(ok, text):
    print(("PASS  " if ok else "FAIL  ") + text)
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("capture", type=pathlib.Path)
    ap.add_argument("--duration", type=float, help="recording length in seconds (default: from the sidecar)")
    args = ap.parse_args()

    path = args.capture
    sidecar_path = path.with_name(path.name[: -len(".npy")] + ".timing.json") if path.name.endswith(".npy") else None
    sidecar = json.loads(sidecar_path.read_text()) if sidecar_path and sidecar_path.exists() else None
    frame_time = (sidecar or {}).get("config", {}).get("frame_repetition_time_s", 0.1)
    duration = args.duration if args.duration is not None else (sidecar or {}).get("duration_s")

    print(f"{path}  ({path.stat().st_size / 1e6:.1f} MB)")
    ok = True
    try:
        data = np.load(path, allow_pickle=False)
    except Exception as e:  # noqa: BLE001 - report any load failure
        report(False, f"numpy.load: {e}")
        return 1
    ok &= report(True, "numpy.load reads it")
    ok &= report(data.ndim == 4 and data.shape[1:] == EXPECTED_TAIL, f"shape {tuple(data.shape)} (expected (frames, 3, 128, 256))")
    ok &= report(data.dtype == np.float32, f"dtype {data.dtype} (expected float32)")
    finite = bool(np.isfinite(data).all())
    ok &= report(finite, f"no NaN or Inf ({int(np.isnan(data).sum())} NaN, {int(np.isinf(data).sum())} Inf)")
    lo, hi = float(np.nanmin(data)), float(np.nanmax(data))
    ok &= report(lo >= -1.0 and hi <= 1.0, f"values within -1..1 (min {lo:.6f}, max {hi:.6f})")

    n = data.shape[0]
    if duration is None:
        print("SKIP  frame count vs duration: no --duration and no sidecar")
    else:
        expected = duration / frame_time
        ok &= report(abs(n - expected) <= 2, f"{n} frames for {duration:g} s at {1 / frame_time:g} frames/s (expected {expected:g}, within 2)")

    flat = data.reshape(n, -1)
    repeats = [i for i in range(1, n) if np.array_equal(flat[i], flat[i - 1])]
    ok &= report(not repeats, f"repeated (byte-identical consecutive) frames: {len(repeats)}" + (f" at {repeats[:10]}" if repeats else ""))

    # Frame alignment: where each channel's biggest jump falls within the chirp
    x = np.asarray(data[: min(30, n)], dtype=np.float64)
    pos, ratio = [], []
    for rx in range(data.shape[1]):
        seq = x[:, rx].reshape(x.shape[0], -1)
        d = np.abs(np.diff(seq, axis=1))
        d = np.concatenate([d, np.zeros((x.shape[0], 1))], axis=1).reshape(x.shape[0], data.shape[2], data.shape[3])[:, :-1]
        per = d.mean(axis=(0, 1))
        pos.append(int(per.argmax())); ratio.append(float(per.max() / np.median(per)))
    best = int(np.argmax(ratio))
    detail = ", ".join(f"rx{r} after {p} ({q:.0f}x)" for r, (p, q) in enumerate(zip(pos, ratio)))
    ok &= report(pos[best] == data.shape[3] - 1 and ratio[best] > 10, f"frame alignment: chirp boundary after sample {pos[best]} on rx{best} (expected {data.shape[3] - 1}); {detail}")

    if sidecar is None:
        print("SKIP  timing report: no .timing.json sidecar")
        return 0 if ok else 1

    t = np.asarray(sidecar["frame_times_ms"], dtype=float)
    ok &= report(len(t) == n, f"sidecar has {len(t)} arrival times for {n} frames")
    gaps = np.diff(t)
    nominal = frame_time * 1000
    print(f"\nTiming ({len(gaps)} gaps between {len(t)} frames, nominal {nominal:g} ms)")
    if len(gaps):
        med, sd = float(np.median(gaps)), float(np.std(gaps, ddof=1)) if len(gaps) > 1 else 0.0
        print(f"      inter-frame gap: median {med:.2f} ms, std {sd:.2f} ms, min {gaps.min():.2f} ms, max {gaps.max():.2f} ms (after frame {int(gaps.argmax())})")
        print(f"      measured frame rate (browser clock): {1000 * len(gaps) / (t[-1] - t[0]):.3f} frames/s over the recording; "
              f"from the median gap {1000 / med:.3f} (misleading when arrivals come in an uneven rhythm)")
        lo, hi = int((gaps < 0.9 * nominal).sum()), int((gaps > 1.1 * nominal).sum())
        print(f"      gaps under {0.9 * nominal:g} ms: {lo}, over {1.1 * nominal:g} ms: {hi}, between: {len(gaps) - lo - hi}")
    fw = [v for v in sidecar.get("firmware_timestamp") or [] if v is not None]
    if len(fw) == n and n > 1:
        f = np.diff(np.asarray(fw, dtype=np.int64))
        steps = dict(zip(*[x.tolist() for x in np.unique(f, return_counts=True)]))
        print(f"      firmware timestamps: frame period mean {f.mean() / 1000:.4f} ms (if microseconds), steps {steps}")
        print(f"      measured frame rate (board clock): {1e6 / f.mean():.4f} frames/s; browser/board clock ratio {(t[-1] - t[0]) * 1000 / (fw[-1] - fw[0]):.6f}")
        ok &= report(bool((f > 0).all()), "firmware timestamps always increase")
        long_gaps = int((gaps > 1.5 * nominal).sum())
        ok &= report(long_gaps == 0, f"gaps longer than {1.5 * nominal:g} ms: {long_gaps}")
    dropped = sidecar.get("frames", {}).get("dropped")
    if dropped is not None:
        ok &= report(dropped == 0, f"frames the device reported as dropped: {dropped}")
    restarts = sidecar.get("frames", {}).get("restarts")
    if restarts is not None:
        ok &= report(restarts == 0, f"acquisition restarts: {restarts}")

    counter = [c for c in sidecar.get("frame_counter") or [] if c is not None]
    if len(counter) == n and n > 1:
        c = np.asarray(counter, dtype=np.int64)
        step = np.diff(c) % (1 << 16)            # Strata packet counters are 16 bit
        usual = int(np.bincount(step).argmax()) if len(step) else 0
        odd = [(i, int(s)) for i, s in enumerate(step) if s != usual]
        print(f"      device frame counter: usual step {usual}")
        ok &= report(not odd, "counter steps other than the usual one: " + (str(odd[:10]) if odd else "none"))
    else:
        print(f"      device frame counter: not usable ({len(counter)} of {n} frames carry one)")

    print("\n" + ("ALL CHECKS PASS" if ok else "SOME CHECKS FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
