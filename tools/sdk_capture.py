"""
Capture frames with the Infineon Radar SDK (Python), for comparison with a
radar-js capture of the same scene.

    .venv-sdk/bin/python tools/sdk_capture.py <name> --seconds 20 --conditions "..."

Uses SensDSv2's own build_config() (core/radar.py, loaded by file path, read
only, no __pycache__), so the settings are exactly SensDSv2's. Writes to
test/captures/:
  <name>.npy               float32 (frames, 3, 128, 256), DeviceFmcw.get_next_frame()[0]
  <name>.timing.json       sidecar in the radar-js capture layout (type "sdk"):
                           frames expected/received/dropped, arrival times
                           (time.perf_counter, ms), SDK version, sensor, board,
                           firmware, config, conditions
  <name>.registers.txt     the register list the SDK programmed (save_register_file)

The radar must not be open anywhere else (click Disconnect in the demo).
"""
import sys
sys.dont_write_bytecode = True          # never write __pycache__ into SensDSv2

import argparse
import datetime
import importlib.util
import json
import pathlib
import platform
import time

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "test" / "captures"
SENSDS = pathlib.Path.home() / "SensDSv2"


def sensds_build_config():
    spec = importlib.util.spec_from_file_location("ref_radar", SENSDS / "core" / "radar.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.build_config()


def radar_js_build():
    """The radar-js commit these tools ran from (read from .git, as make_golden.py reads SensDSv2's)."""
    git = ROOT / ".git"
    try:
        head = (git / "HEAD").read_text().strip()
        commit = head
        if head.startswith("ref: "):
            ref = git / head[5:]
            commit = ref.read_text().strip() if ref.exists() else next(
                (l.split()[0] for l in (git / "packed-refs").read_text().splitlines() if l.endswith(" " + head[5:])), None)
        import subprocess
        dirty = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain", "--untracked-files=no"],
                               capture_output=True, text=True).stdout.strip() != ""
        return {"commit": commit[:12] if commit else None, "dirty": dirty, "tool": "tools/sdk_capture.py"}
    except OSError:
        return {"commit": None, "dirty": None, "tool": "tools/sdk_capture.py"}


def config_dict(cfg):
    c = cfg.chirp
    return {
        "frame_repetition_time_s": cfg.frame_repetition_time_s, "chirp_repetition_time_s": cfg.chirp_repetition_time_s,
        "num_chirps": cfg.num_chirps, "tdm_mimo": bool(cfg.tdm_mimo),
        "start_frequency_Hz": c.start_frequency_Hz, "end_frequency_Hz": c.end_frequency_Hz,
        "sample_rate_Hz": c.sample_rate_Hz, "num_samples": c.num_samples, "rx_mask": c.rx_mask, "tx_mask": c.tx_mask,
        "tx_power_level": c.tx_power_level, "lp_cutoff_Hz": c.lp_cutoff_Hz, "hp_cutoff_Hz": c.hp_cutoff_Hz, "if_gain_dB": c.if_gain_dB,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name")
    ap.add_argument("--seconds", type=float, default=20.0)
    ap.add_argument("--conditions", default="")
    ap.add_argument("--connection", default="USB hub, no other devices")
    ap.add_argument("--machine", default="MacBook Pro M4 (Mac16,1)")
    args = ap.parse_args()

    import ifxradarsdk
    from ifxradarsdk.fmcw import DeviceFmcw

    OUT.mkdir(parents=True, exist_ok=True)
    cfg = sensds_build_config()
    with DeviceFmcw() as device:
        st = device.get_sensor_type()
        sensor = getattr(st, "name", str(st))
        if "BGT60TR13C" not in sensor:
            sys.exit(f"Expected a BGT60TR13C, found {sensor}.")
        device.set_acquisition_sequence(device.create_simple_sequence(cfg))
        device.save_register_file(str(OUT / f"{args.name}.registers.txt"))
        n = round(args.seconds / cfg.frame_repetition_time_s)
        print(f"SDK {ifxradarsdk.get_version_full()}, {sensor}: capturing {args.seconds:g} s ({n} frames). Keep still...")
        frames, times, dropped = [], [], 0
        started = datetime.datetime.now(datetime.timezone.utc)
        t0 = time.perf_counter()
        while len(frames) < n:
            try:
                f = device.get_next_frame()[0]
            except Exception as e:                    # SensDSv2 treats a failed frame as transient
                if "IFX_ERROR_FRAME_ACQUISITION_FAILED" in str(e):
                    dropped += 1
                    continue
                raise
            times.append((time.perf_counter() - t0) * 1000.0)
            frames.append(np.array(f, dtype=np.float32))
        ended = datetime.datetime.now(datetime.timezone.utc)
        cube = np.stack(frames)
        np.save(OUT / f"{args.name}.npy", cube)
        meta = {
            "format": "radar-js-capture", "version": 1, "type": "sdk", "file": f"{args.name}.npy", "name": args.name,
            "started_at": started.isoformat().replace("+00:00", "Z"), "ended_at": ended.isoformat().replace("+00:00", "Z"),
            "duration_s": args.seconds,
            "frames": {"expected": n, "received": len(frames), "dropped": dropped, "restarts": 0, "shape": list(cube.shape)},
            "frame_times_ms": [round(t, 3) for t in times],
            "config": config_dict(cfg), "config_name": "SensDSv2 core/radar.py build_config (called directly)",
            "chirp_time_s": cfg.chirp_repetition_time_s, "frame_time_s": cfg.frame_repetition_time_s,
            "sdk": {"version": ifxradarsdk.get_version_full(), "sensor": sensor, "board_uuid": device.get_board_uuid(),
                    "firmware": {k: str(v) for k, v in device.get_firmware_information().items()}},
            "machine_label": args.machine, "connection_type": args.connection, "conditions": args.conditions,
            "host": {"python": platform.python_version(), "os": f"{platform.system()} {platform.mac_ver()[0] or platform.release()}"},
            "registers_file": f"{args.name}.registers.txt",
            "radar_js": radar_js_build(),
        }
        (OUT / f"{args.name}.timing.json").write_text(json.dumps(meta, indent=1))
    print(f"Saved {cube.shape} to test/captures/{args.name}.npy, {dropped} dropped. The radar is closed.")


if __name__ == "__main__":
    main()
