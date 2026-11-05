"""
Level 1 decoder check: compare a capture made with the Infineon Radar SDK
(tools/sdk_capture.py) with a radar-js capture of the same scene, made one
after the other with nothing moved.

    python3 tools/compare_ab.py <sdk_name> <radarjs_name> [--kind static|motion]
                                [--expect-m 1.0] [--save]

Names are files in test/captures/ (without .npy). The two captures are not the
same frames (one board, one reader at a time), so nothing is compared sample
by sample. What is compared:

  every scene  per antenna: mean ADC code, standard deviation, clipping
               (codes 0 and 4095); frame interval (median) and drops
  static       per antenna: mean chirp (average of every chirp in the
               recording) correlation; raw range profile (SensDSv2
               range_map_v1.frame_profile mode "raw", averaged over frames):
               strongest bin past 0.25 m, the peak nearest --expect-m, level
               there, dB correlation and RMS difference of the two profiles
               past 0.25 m. A static scene has nobody in the beam: a seated
               person moves enough to change the profile near them.
  motion       antenna 1 (antenna 0 clips about 20%): SensDSv2
               doppler_spectrogram_live.compute_recorded spectrogram; share of
               frames with motion, speed percentiles, toward share
               (negative = toward), MTI range profile peak

--skip-frames N drops the first N frames of both captures (the operator
stepping out of the beam). Thresholds were fixed before the captures (see CHECKS below). Motion scenes
are done by hand twice, so their checks are looser and say "similar", not
"equal". --save writes test/captures/<radarjs_name>.ab.json.

Reads SensDSv2 only (modules loaded by file path, no __pycache__, no git).
"""
import sys
sys.dont_write_bytecode = True          # never write __pycache__ into SensDSv2

import argparse
import importlib.util
import json
import os
import pathlib

os.environ.setdefault("MPLBACKEND", "Agg")

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
CAPS = ROOT / "test" / "captures"
SENSDS = pathlib.Path.home() / "SensDSv2"
C_MPS = 299_792_458.0
MIN_RANGE_M = 0.10            # SensDSv2 MIN_RANGE_BIN 15 is 0.10 m (motion: its bin selection)
STATIC_MIN_M = 0.25           # static profiles: past the transmit leakage tail (falls to the floor by about 0.25 m)
MOTION_ANTENNA = 1
STILL_MPS = 0.15              # |v| below this counts as not moving

# Fixed before the captures. static: same scene, same placement.
CHECKS = {
    "mean_code_diff_max": 20.0,        # codes, per antenna
    "std_code_ratio_max": 1.10,        # larger / smaller, per antenna
    "clip_pct_diff_max": 1.0,          # percentage points, per antenna
    "mean_chirp_r_min": 0.999,         # static
    "peak_bin_diff_max": 2,            # static, bins (6.8 mm each)
    "peak_db_diff_max": 1.5,           # static, dB
    "profile_r_min": 0.98,             # static, dB profiles past 0.10 m
    "motion_p95_ratio_max": 1.35,      # motion, larger / smaller
    "motion_toward_diff_max": 0.20,    # motion, share of moving energy
}


def load(rel, name):
    spec = importlib.util.spec_from_file_location(name, SENSDS / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def read(name):
    data = np.load(CAPS / f"{name}.npy")
    side = json.loads((CAPS / f"{name}.timing.json").read_text())
    return data, side


def codes(data):
    return (data.astype(np.float64) + 1.0) * 4095.0 / 2.0


def basic(data, side):
    c = codes(data)
    out = []
    for a in range(data.shape[1]):
        ca = np.rint(c[:, a])
        out.append({
            "mean_code": float(ca.mean()), "std_code": float(ca.std()),
            "clip_low_pct": float(100 * np.mean(ca <= 0)), "clip_high_pct": float(100 * np.mean(ca >= 4095)),
        })
    t = np.asarray(side.get("frame_times_ms") or [], dtype=float)
    fr = side.get("frames", {})
    return {
        "frames": int(data.shape[0]), "antennas": out,
        "frame_interval_median_ms": float(np.median(np.diff(t))) if t.size > 1 else None,
        "dropped": fr.get("dropped"), "restarts": fr.get("restarts"),
        "conditions": side.get("conditions"), "started_at": side.get("started_at"),
        "type": side.get("type"),
    }


def range_axis(rm, cfg, n_sample):
    return rm.range_axis_m(n_sample * 2, n_sample * 4, sample_rate_hz=cfg["sample_rate_Hz"],
                           start_frequency_hz=cfg["start_frequency_Hz"], end_frequency_hz=cfg["end_frequency_Hz"],
                           n_sample=n_sample)


def raw_profile(rm, data, antenna, mode="raw"):
    """Frame profiles (SensDSv2), averaged in linear units, back to dB."""
    n_frame, _, n_chirp, n_sample = data.shape
    rw, dw = rm._windows(n_sample, n_chirp)
    prof = np.stack([rm.frame_profile(data[i, antenna], mode=mode, range_window=rw, doppler_window=dw,
                                      range_fft_size=n_sample * 4, doppler_fft_size=n_chirp * 4)
                     for i in range(n_frame)])
    scale = 20.0 if mode == "raw" else 10.0
    return scale * np.log10(np.mean(10 ** (prof / scale), axis=0))


def local_peaks(p, start):
    i = np.arange(max(start, 1), len(p) - 1)
    return i[(p[i] > p[i - 1]) & (p[i] >= p[i + 1])]


def static_compare(rm, a, b, cfg, expect_m):
    n_sample = a.shape[3]
    rng = range_axis(rm, cfg, n_sample)
    start = int(np.searchsorted(rng, STATIC_MIN_M))
    res = []
    for ant in range(a.shape[1]):
        ma, mb = a[:, ant].mean(axis=(0, 1)), b[:, ant].mean(axis=(0, 1))
        r_chirp = float(np.corrcoef(ma, mb)[0, 1])
        pa, pb = raw_profile(rm, a, ant), raw_profile(rm, b, ant)
        ka, kb = start + int(np.argmax(pa[start:])), start + int(np.argmax(pb[start:]))
        item = {
            "antenna": ant, "mean_chirp_r": r_chirp,
            "profile_r": float(np.corrcoef(pa[start:], pb[start:])[0, 1]),
            "profile_rms_db": float(np.sqrt(np.mean((pa[start:] - pb[start:]) ** 2))),
            "strongest": {"sdk_bin": ka, "radarjs_bin": kb, "sdk_m": float(rng[ka]), "radarjs_m": float(rng[kb]),
                          "sdk_db": float(pa[ka]), "radarjs_db": float(pb[kb])},
        }
        if expect_m is not None:
            # the local peak of the SDK profile nearest the expected range; the
            # radar-js peak is the local peak nearest that one
            pk_a = local_peaks(pa, start)
            window = pk_a[np.abs(rng[pk_a] - expect_m) <= 0.30]
            if window.size:
                ea = int(window[np.argmax(pa[window])])
                pk_b = local_peaks(pb, start)
                eb = int(pk_b[np.argmin(np.abs(pk_b - ea))])
                item["expected"] = {"sdk_bin": ea, "radarjs_bin": eb, "sdk_m": float(rng[ea]), "radarjs_m": float(rng[eb]),
                                    "sdk_db": float(pa[ea]), "radarjs_db": float(pb[eb]),
                                    "prominence_sdk_db": float(pa[ea] - np.median(pa[start:]))}
            else:
                item["expected"] = None
        res.append(item)
    return res


def motion_stats(dop, rm, data, cfg):
    spect, bins = dop.compute_recorded(data, antenna=MOTION_ANTENNA)       # (n_frame, D) dB
    d = spect.shape[1]
    wavelength = C_MPS / ((cfg["start_frequency_Hz"] + cfg["end_frequency_Hz"]) / 2)
    v = (np.arange(d) - d / 2) * wavelength / (2 * d * cfg["chirp_repetition_time_s"])   # radar.dsp.velocityAxis
    power = 10 ** (spect / 10)
    moving = np.abs(v) >= STILL_MPS
    floor = np.median(spect[:, moving])
    peak_k = np.argmax(np.where(moving, spect, -np.inf), axis=1)
    peak_db = spect[np.arange(len(spect)), peak_k]
    active = peak_db > floor + 20.0            # frames with a clear moving return
    pm = power[:, moving]
    vm = v[moving]
    toward = float(pm[:, vm < 0].sum() / pm.sum())
    pv = np.abs(v[peak_k[active]])
    rng = range_axis(rm, cfg, data.shape[3])
    mti = raw_profile(rm, data, MOTION_ANTENNA, mode="mti")
    start = int(np.searchsorted(rng, MIN_RANGE_M))
    km = start + int(np.argmax(mti[start:]))
    return {
        "antenna": MOTION_ANTENNA,
        "active_frames_pct": float(100 * active.mean()),
        "peak_speed_p50_mps": float(np.percentile(pv, 50)) if pv.size else None,
        "peak_speed_p95_mps": float(np.percentile(pv, 95)) if pv.size else None,
        "peak_speed_max_mps": float(pv.max()) if pv.size else None,
        "toward_share": toward,
        "toward_frames_pct": float(100 * np.mean(v[peak_k[active]] < 0)) if pv.size else None,
        "selected_range_bin_median": int(np.median(bins)), "selected_range_m_median": float(rng[int(np.median(bins))]),
        "mti_peak_m": float(rng[km]),
    }


def verdict(ok):
    return "PASS" if ok else "FAIL"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sdk")
    ap.add_argument("radarjs")
    ap.add_argument("--kind", choices=("static", "motion"), default="static")
    ap.add_argument("--expect-m", type=float, default=None)
    ap.add_argument("--skip-frames", type=int, default=0)
    ap.add_argument("--save", action="store_true")
    args = ap.parse_args()

    rm = load("core/range_map_v1.py", "ref_range_map_v1")
    dop = load("core/doppler_spectrogram_live.py", "ref_doppler_live")
    a, sa = read(args.sdk)
    b, sb = read(args.radarjs)
    if args.skip_frames:
        a, b = a[args.skip_frames:], b[args.skip_frames:]
        for side in (sa, sb):
            if side.get("frame_times_ms"):
                side["frame_times_ms"] = side["frame_times_ms"][args.skip_frames:]
    if a.shape[1:] != b.shape[1:]:
        sys.exit(f"Shapes differ: {a.shape} vs {b.shape}")
    cfg = sb["config"]
    report = {"sdk": args.sdk, "radarjs": args.radarjs, "kind": args.kind, "expect_m": args.expect_m,
              "skip_frames": args.skip_frames,
              "checks": CHECKS, "sdk_basic": basic(a, sa), "radarjs_basic": basic(b, sb), "results": []}
    results = report["results"]

    def check(name, value, ok, note=""):
        results.append({"check": name, "value": value, "pass": bool(ok), "note": note})
        print(f"  {verdict(ok)}  {name}: {value}{('  ' + note) if note else ''}")

    print(f"Level 1 A/B  {args.sdk} (SDK) vs {args.radarjs} (radar-js), {args.kind}")
    for tag, s in (("SDK", report["sdk_basic"]), ("radar-js", report["radarjs_basic"])):
        print(f"  {tag:8s} {s['frames']} frames, interval {s['frame_interval_median_ms']:.2f} ms median, "
              f"dropped {s['dropped']}, restarts {s['restarts']}; {s['conditions']}")
    print("  antenna   mean code (SDK / rjs)    std (SDK / rjs)      clip low % (SDK / rjs)")
    for ant, (x, y) in enumerate(zip(report["sdk_basic"]["antennas"], report["radarjs_basic"]["antennas"])):
        print(f"  rx{ant}      {x['mean_code']:7.1f} / {y['mean_code']:7.1f}     {x['std_code']:6.1f} / {y['std_code']:6.1f}"
              f"      {x['clip_low_pct']:5.2f} / {y['clip_low_pct']:5.2f}")
    for ant, (x, y) in enumerate(zip(report["sdk_basic"]["antennas"], report["radarjs_basic"]["antennas"])):
        dm = abs(x["mean_code"] - y["mean_code"])
        rs = max(x["std_code"], y["std_code"]) / min(x["std_code"], y["std_code"])
        dc = abs(x["clip_low_pct"] - y["clip_low_pct"]) + abs(x["clip_high_pct"] - y["clip_high_pct"])
        if args.kind == "static":
            check(f"rx{ant} mean code difference", round(dm, 1), dm <= CHECKS["mean_code_diff_max"])
            check(f"rx{ant} std ratio", round(rs, 3), rs <= CHECKS["std_code_ratio_max"])
        check(f"rx{ant} clipping difference (points)", round(dc, 2), dc <= CHECKS["clip_pct_diff_max"])

    if args.kind == "static":
        st = static_compare(rm, a, b, cfg, args.expect_m)
        report["static"] = st
        for s in st:
            ant = s["antenna"]
            check(f"rx{ant} mean chirp correlation", round(s["mean_chirp_r"], 5), s["mean_chirp_r"] >= CHECKS["mean_chirp_r_min"])
            check(f"rx{ant} raw range profile correlation (dB, past {STATIC_MIN_M} m)", round(s["profile_r"], 4), s["profile_r"] >= CHECKS["profile_r_min"],
                  f"RMS difference {s['profile_rms_db']:.2f} dB")
            g = s["strongest"]
            print(f"        rx{ant} strongest bin past {STATIC_MIN_M} m: SDK {g['sdk_bin']} ({g['sdk_m']:.3f} m, {g['sdk_db']:.1f} dB), "
                  f"radar-js {g['radarjs_bin']} ({g['radarjs_m']:.3f} m, {g['radarjs_db']:.1f} dB)")
            e = s.get("expected")
            if args.expect_m is not None:
                if e is None:
                    check(f"rx{ant} peak near {args.expect_m} m", "none within 0.30 m", False)
                else:
                    db = abs(e["sdk_bin"] - e["radarjs_bin"])
                    check(f"rx{ant} target peak bin difference", f"{db} (SDK {e['sdk_m']:.3f} m, radar-js {e['radarjs_m']:.3f} m, "
                          f"{e['prominence_sdk_db']:.1f} dB above the median)", db <= CHECKS["peak_bin_diff_max"])
                    dd = abs(e["sdk_db"] - e["radarjs_db"])
                    check(f"rx{ant} target peak level difference (dB)", round(dd, 2), dd <= CHECKS["peak_db_diff_max"])
    else:
        ma, mb = motion_stats(dop, rm, a, cfg), motion_stats(dop, rm, b, cfg)
        report["motion"] = {"sdk": ma, "radarjs": mb}
        print(f"  antenna {MOTION_ANTENNA}               SDK        radar-js")
        for k in ("active_frames_pct", "peak_speed_p50_mps", "peak_speed_p95_mps", "peak_speed_max_mps", "toward_share",
                  "toward_frames_pct", "selected_range_m_median", "mti_peak_m"):
            fa, fb = ma[k], mb[k]
            print(f"  {k:24s} {fa if fa is None else round(fa, 3):>9}  {fb if fb is None else round(fb, 3):>9}")
        if ma["peak_speed_p95_mps"] and mb["peak_speed_p95_mps"]:
            r = max(ma["peak_speed_p95_mps"], mb["peak_speed_p95_mps"]) / min(ma["peak_speed_p95_mps"], mb["peak_speed_p95_mps"])
            check("p95 peak speed similar (ratio)", round(r, 3), r <= CHECKS["motion_p95_ratio_max"])
        else:
            check("p95 peak speed similar", "no active frames", False)
        dt = abs(ma["toward_share"] - mb["toward_share"])
        check("toward share similar (difference)", round(dt, 3), dt <= CHECKS["motion_toward_diff_max"])

    n_fail = sum(not r["pass"] for r in results)
    print(f"  {len(results) - n_fail} of {len(results)} checks pass")
    if args.save:
        out = CAPS / f"{args.radarjs}.ab.json"
        out.write_text(json.dumps(report, indent=1))
        print(f"  saved {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
