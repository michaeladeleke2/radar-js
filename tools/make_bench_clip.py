"""
The benchmark page's default clip: frames of a live capture, one antenna,
stored as 12-bit ADC codes (uint16) to keep the deployed page small.

    python3 tools/make_bench_clip.py [test/captures/hand_gesture.npy] [--frames 0:100] [--antenna 1]

Writes demo/public/bench/clip.npy, uint16 (frames, chirps, samples), and
clip.json (source, its SHA-256, frames, antenna). The page turns the codes
back into the capture's float32 values with the SDK's arithmetic
(src/device/unpack.js rawToCube: float32(code * 2 / 4095) - 1, each step
rounded to float32); this script checks that the round trip gives the
capture's values exactly.
"""
import argparse
import hashlib
import json
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "demo" / "public" / "bench"

ap = argparse.ArgumentParser()
ap.add_argument("input", nargs="?", default=str(ROOT / "test" / "captures" / "hand_gesture.npy"))
ap.add_argument("--frames", default="0:100")
ap.add_argument("--antenna", type=int, default=1)
args = ap.parse_args()

src = pathlib.Path(args.input).resolve()
a, b = (int(x) for x in args.frames.split(":"))
x = np.load(src, mmap_mode="r")[a:b, args.antenna].astype(np.float32)
codes = np.rint((x.astype(np.float64) + 1.0) * 4095.0 / 2.0).astype(np.int64)
assert codes.min() >= 0 and codes.max() <= 4095, "not 12-bit ADC data"
back = np.float32(np.float32(codes * 2 / 4095.0).astype(np.float64) - 1.0)   # as rawToCube
assert np.array_equal(back, x), "codes do not reproduce the capture exactly"
OUT.mkdir(parents=True, exist_ok=True)
np.save(OUT / "clip.npy", codes.astype("<u2"))
sha = hashlib.sha256(src.read_bytes()).hexdigest()
side = json.loads(src.with_name(src.stem + ".timing.json").read_text()) if src.with_name(src.stem + ".timing.json").exists() else {}
meta = {
    "file": "clip.npy", "dtype": "uint16 12-bit ADC codes", "shape": list(codes.shape),
    "to_float32": "float32(float32(code * 2 / 4095) - 1), as src/device/unpack.js rawToCube",
    "source": {"file": str(src.relative_to(ROOT)) if src.is_relative_to(ROOT) else str(src), "sha256": sha,
               "frames": [a, b], "antenna": args.antenna, "conditions": side.get("conditions"),
               "recorded_with_radar_js": side.get("radar_js")},
    "config": side.get("config"),
}
(OUT / "clip.json").write_text(json.dumps(meta, indent=1) + "\n")
print(f"wrote {OUT / 'clip.npy'} ({(OUT / 'clip.npy').stat().st_size / 1e6:.2f} MB), shape {codes.shape}; round trip exact")
