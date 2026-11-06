"""
Figures for the paper from tools/aggregate_bench.mjs's plot_data.json.

    python3 tools/plot_bench.py <aggregate folder>/plot_data.json [--out <folder>]

Writes two PDFs, grayscale friendly (gray fills with hatching, line styles
and markers), axis labels with units, no titles:
  bench_stages.pdf    mean time per frame of each replay stage, one bar per machine (SD as error bars)
  bench_scaling.pdf   mean time per frame against frame size (chirps x samples),
                      one line style per machine, one panel per test
"""
import argparse
import json
import pathlib

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("data")
ap.add_argument("--out", default=None)
args = ap.parse_args()
data = json.loads(pathlib.Path(args.data).read_text())
out = pathlib.Path(args.out or pathlib.Path(args.data).parent)
out.mkdir(parents=True, exist_ok=True)
machines = data["machines"]
GRAYS = ["0.15", "0.55", "0.85", "0.35", "0.7"]
HATCH = ["", "///", "...", "xx", "\\\\"]
STYLES = [("-", "o"), ("--", "s"), (":", "^"), ("-.", "D"), ((0, (5, 1)), "v")]
plt.rcParams.update({"font.size": 9, "pdf.fonttype": 42, "ps.fonttype": 42})

# per stage mean time by machine
stages = [s for s in data["stages"] if data["stages"][s]]
fig, ax = plt.subplots(figsize=(7.0, 3.6))
width = 0.8 / max(1, len(machines))
for k, m in enumerate(machines):
    xs = [i + (k - (len(machines) - 1) / 2) * width for i in range(len(stages))]
    means = [data["stages"][s].get(m, {}).get("mean", float("nan")) for s in stages]
    sds = [data["stages"][s].get(m, {}).get("sd", 0) for s in stages]
    ax.bar(xs, means, width, yerr=sds, capsize=2, color=GRAYS[k % 5], edgecolor="black", linewidth=0.5,
           hatch=HATCH[k % 5], label=m, error_kw={"elinewidth": 0.6})
ax.set_xticks(range(len(stages)))
ax.set_xticklabels([s.replace("stftSpectrogram + spectrogramToDb", "stftSpectrogram\n+ spectrogramToDb") for s in stages], rotation=30, ha="right", fontsize=7)
ax.set_ylabel("Time per frame (ms)")
ax.legend(frameon=False, fontsize=8)
ax.spines[["top", "right"]].set_visible(False)
fig.tight_layout()
fig.savefig(out / "bench_stages.pdf")

# scaling vs frame size
tests = ["rangeFft", "rangeDopplerMap", "full live pipeline"]
fig, axes = plt.subplots(1, len(tests), figsize=(7.0, 2.6), sharey=False)
for ax, t in zip(axes, tests):
    for k, m in enumerate(machines):
        pts = data["scaling"].get(m, {}).get(t)
        if not pts:
            continue
        ls, mk = STYLES[k % 5]
        ax.plot([p["samples_per_frame"] for p in pts], [p["mean"] for p in pts], linestyle=ls, marker=mk, color="black",
                markerfacecolor="white", markersize=4, linewidth=1, label=m)
    ax.set_xscale("log", base=2)
    ax.set_yscale("log")
    pts0 = next((data["scaling"][m][t] for m in machines if m in data["scaling"]), [])
    ax.set_xticks([p["samples_per_frame"] for p in pts0])
    ax.set_xticklabels([p["size"] for p in pts0], rotation=30, fontsize=7)
    ax.set_xlabel(f"Frame size, chirps x samples\n({t})")
    ax.spines[["top", "right"]].set_visible(False)
axes[0].set_ylabel("Mean time per frame (ms)")
axes[-1].legend(frameon=False, fontsize=7)
fig.tight_layout()
fig.savefig(out / "bench_scaling.pdf")
print(f"wrote {out / 'bench_stages.pdf'} and {out / 'bench_scaling.pdf'}")
