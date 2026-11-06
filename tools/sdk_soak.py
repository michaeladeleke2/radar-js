"""
USB loss baseline with the Infineon Radar SDK (Python): stream for a while,
keep no frames, count what arrives and what fails.

    .venv-sdk/bin/python tools/sdk_soak.py <name> --seconds 300 --conditions "..."

Same settings as tools/sdk_capture.py (SensDSv2's build_config, loaded by file
path, read only). A frame the SDK reports as IFX_ERROR_FRAME_ACQUISITION_FAILED
is counted and skipped, as SensDSv2 does (the SDK then starts its next frame
at whatever slice comes next; the frames are not kept, so that does not
matter here). Writes test/captures/soak/<name>.sdk_soak.json: frames received,
expected (elapsed time / frame time), failures with their times, every
arrival gap over 150 ms, and the arrival-gap statistics.

The radar must not be open anywhere else (close the radar-js page).
"""
import sys
sys.dont_write_bytecode = True          # never write __pycache__ into SensDSv2

import argparse
import datetime
import json
import pathlib
import platform
import time

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from sdk_capture import sensds_build_config, config_dict, radar_js_build   # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "test" / "captures" / "soak"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name")
    ap.add_argument("--seconds", type=float, default=300.0)
    ap.add_argument("--conditions", default="")
    ap.add_argument("--connection", default="USB hub, no other devices")
    ap.add_argument("--machine", default="MacBook Pro M4 (Mac16,1)")
    args = ap.parse_args()

    import ifxradarsdk
    from ifxradarsdk.fmcw import DeviceFmcw

    OUT.mkdir(parents=True, exist_ok=True)
    cfg = sensds_build_config()
    failures, errors, times = [], [], []
    with DeviceFmcw() as device:
        sensor = getattr(device.get_sensor_type(), "name", "?")
        device.set_acquisition_sequence(device.create_simple_sequence(cfg))
        print(f"SDK {ifxradarsdk.get_version_full()}, {sensor}: streaming {args.seconds:g} s, frames not kept...", flush=True)
        started = datetime.datetime.now(datetime.timezone.utc)
        t0 = time.perf_counter()
        next_report = 60.0
        while (time.perf_counter() - t0) < args.seconds:
            try:
                device.get_next_frame()
            except Exception as e:
                t = (time.perf_counter() - t0) * 1000.0
                if "IFX_ERROR_FRAME_ACQUISITION_FAILED" in str(e):
                    failures.append(round(t, 3))
                    continue
                errors.append({"t_ms": round(t, 3), "error": str(e)})
                raise
            times.append((time.perf_counter() - t0) * 1000.0)
            if times[-1] / 1000.0 >= next_report:
                print(f"  {next_report:.0f} s: {len(times)} frames, {len(failures)} failed", flush=True)
                next_report += 60.0
        ended = datetime.datetime.now(datetime.timezone.utc)
    t = np.asarray(times)
    gaps = np.diff(t)
    frame_ms = cfg.frame_repetition_time_s * 1000.0
    expected = int(round((t[-1] - t[0]) / frame_ms)) + 1 if len(t) > 1 else len(t)
    late = [{"after_frame": int(i), "t_ms": round(float(t[i + 1]), 3), "gap_ms": round(float(g), 3)} for i, g in enumerate(gaps) if g > 150]
    report = {
        "format": "radar-js-sdk-soak", "version": 1, "name": args.name,
        "started_at": started.isoformat().replace("+00:00", "Z"), "ended_at": ended.isoformat().replace("+00:00", "Z"),
        "seconds": args.seconds, "conditions": args.conditions, "connection_type": args.connection, "machine_label": args.machine,
        "frames_received": len(t), "frames_expected_from_elapsed": expected, "frames_missing": expected - len(t),
        "acquisition_failures": len(failures), "failure_times_ms": failures, "other_errors": errors,
        "arrival_gap_ms": {"median": round(float(np.median(gaps)), 3), "std": round(float(gaps.std()), 3),
                           "min": round(float(gaps.min()), 3), "max": round(float(gaps.max()), 3)} if len(gaps) else None,
        "gaps_over_150_ms": late,
        "frame_rate_fps": round(1000.0 * (len(t) - 1) / (t[-1] - t[0]), 4) if len(t) > 1 else None,
        "config": config_dict(cfg), "chirp_time_s": cfg.chirp_repetition_time_s,
        "sdk": {"version": ifxradarsdk.get_version_full(), "sensor": sensor},
        "host": {"python": platform.python_version(), "os": f"{platform.system()} {platform.mac_ver()[0] or platform.release()}"},
        "radar_js": radar_js_build(),
    }
    path = OUT / f"{args.name}.sdk_soak.json"
    path.write_text(json.dumps(report, indent=1))
    print(f"{len(t)} frames of {expected} expected, {len(failures)} acquisition failures, {len(late)} gaps over 150 ms; "
          f"wrote {path.relative_to(ROOT)}. The radar is closed.")


if __name__ == "__main__":
    main()
