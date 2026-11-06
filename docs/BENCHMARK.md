# Running the benchmark on a laptop

The benchmark page measures how fast radar.js runs on a computer, for the
paper's System Performance section. It runs in Google Chrome from the web
(GitHub Pages): no repository, Node or install needed on the laptop.

- Page: **https://michaeladeleke2.github.io/radar-js/bench.html** (after the
  `eval/benchmarks` branch is merged and deployed; until then, run it locally,
  see the end of this file)
- Works in Chrome 89 and newer (one laptop, an HP Chromebook, is on Chrome
  89.0.4389.130 and cannot update). Only Google Chrome is in scope.

## Before you start (every laptop)

1. **Plug in the power.** Battery saving slows the processor.
2. **Update Chrome** if the laptop can (Chrome menu, Help, About Google
   Chrome; restart if asked). The Chromebook stays on Chrome 89.
3. **Close every other app and every other Chrome tab and window.** Turn off
   anything that syncs or backs up in the background if you can.
4. Let the laptop sit idle for a minute after closing things.
5. For the live test: **connect the radar board through the USB hub**, the
   same hub used on every laptop, with nothing else plugged into the hub.

## Run it

1. Open the page in Chrome. The window should be maximized and stay **in
   front** for the whole run: the radar loses about five times more data
   while Chrome is in the background (docs/soak-test-2026-11-06.md).
2. **1. This computer**: fill in the machine label (short, e.g. "HP Chromebook
   11 G6"), the CPU model, core count and RAM (from the laptop's About page or
   spec sheet), power (plugged in) and connection (USB hub). The page fills in
   the browser, OS, threads, memory, screen and radar.js version itself, and
   remembers the fields for next time.
3. **2. Settings**: leave the defaults (200 timed iterations after 10 warmup;
   60 s per stream mode). The bundled clip (100 frames of a hand gesture,
   antenna 1) is the replay data; leave the file picker empty.
4. **3. Without the radar**: click **Run all three** and do not touch the
   laptop until the status line says Done. On a fast laptop this takes about
   4 minutes (replay about 1, scaling about 1, main thread vs worker 2); on
   the Chromebook expect up to 3 to 4 times longer.
5. **4. With the radar (live)**: click **Connect**, choose the board
   (Infineon / IFX CDC) in Chrome's list, then **Run live benchmark**. It runs
   four modes for 60 s each (about 5 minutes in all): main thread with and
   without the plot, Web Worker with and without the plot. Keep Chrome in
   front; **do not touch the board, the cable or the laptop** until it says
   Done.
6. **5. Save the results**: click **Download results**. Two files land in
   Downloads: `radarjs-bench_<label>_<time>.json` (everything, with every
   timing) and `.csv` (the summary). Send both.

If the page shows a red message instead of the tests, copy it: it says what
the browser could not do.

## What it measures

| Test | What | Reported |
|---|---|---|
| Replay | Every radar.dsp stage, and the demo's full per-frame live pipeline (spectrogram processing plus one plot draw, timed separately), on recorded frames. Each timed iteration uses a different frame (or window of frames) than the one before, so nothing is answered from a cache. | mean, SD, median, p5, p95, min, max (ms per frame); real-time margin = 100 ms frame period / mean full pipeline time (above 1 keeps up) |
| Scaling | rangeFft, rangeDopplerMap and the full pipeline on simulated frames of 32x64, 64x128, 128x256 and 256x512 (chirps x samples) | the same statistics per size |
| Main thread vs Web Worker | The full pipeline at 10 frames/s for 60 s, on the page and through radar.stream's Web Worker | requestAnimationFrame intervals (how many over 16.7 and 33 ms), worker round trip, processing and drawing time |
| Live | The board over Web Serial, four modes | per frame: arrival, processing, rendering, arrival to output; frames delivered vs expected (board clock), drops, realignment gaps; the delay's slope over time (a growing slope means the laptop falls behind live and frames pile up); whether it sustained 10 frames/s in real time |

Reading the live results:

- The delay slope has a floor of about 0.06 ms/s even when nothing falls
  behind: the board's clock and the computer's run at slightly different
  rates (about 60 ppm on the MacBook). A laptop that cannot keep up shows a
  slope of whole milliseconds per second; the verdict uses 1 ms/s.
- Processing per frame can be slower with the plot off than on (MacBook:
  13 against 9 ms): with less to do the processor runs at a lower clock.
  Compare modes with that in mind.

- Animation-frame stalls (main thread vs Web Worker): report them against
  each display's own refresh interval, as `raf.csv` / `raf_table.tex` do
  (gaps over 1.5 x the median interval, and over 33 ms). The page's own
  "over 16.7 ms" count is not comparable across machines: on a 60 Hz display
  16.7 ms is the normal interval, so about half of the ordinary gaps land
  just over it, while on a 120 Hz display (8.3 ms) it already means a missed
  frame. Add `--expect-commit bc27418` when aggregating the paper's results.

Timer resolution: Chrome rounds `performance.now()` to 0.1 ms on pages that
are not cross-origin isolated (GitHub Pages cannot send the headers for
isolation), so single calls under a few milliseconds carry that rounding;
the means over 200 calls are not affected much.

## After collecting the results

Put every laptop's `.json` files in one folder, then (on a computer with the
repository):

```bash
node tools/aggregate_bench.mjs results/
```

```bash
python3 tools/plot_bench.py results/aggregate/plot_data.json --font-dir <folder with the Libertine .ttf files>
```

`results/aggregate/` then holds `combined.csv`, LaTeX table bodies
(`specs_table.tex`, `stages_table.tex`, `live_table.tex`, `raf_table.tex`),
`raf.csv`, `plot_data.json`,
and two grayscale figures: `bench_stages.pdf` (time per stage by machine) and
`bench_scaling.pdf` (time against frame size).

Fonts: the paper may embed only Linux Libertine and Linux Biolinum, so the
figures set all text, axis tick labels included, in Linux Libertine (the
regular face), and `plot_bench.py` stops if any other font ends up embedded
(check with `pdffonts bench_stages.pdf`). The font is not in the repository.
It is the Libertine Open Fonts Project's TrueType release 5.3.0,
`LinLibertineTTF_5.3.0_2012_07_02.tgz` (3,673,659 bytes, SHA-256
`24a593a949808d976850131a953c0c0d7a72299531dfbb348191964cc038d75d`), from
https://sourceforge.net/projects/linuxlibertine/files/linuxlibertine/5.3.0/;
unpack it anywhere and pass that folder as `--font-dir`. Licence: SIL Open
Font License 1.1, and also GPL with the font exception (`LICENCE.txt`,
`OFL-1.1.txt` and `GPL.txt` in the archive), so embedding the font in the
paper's PDF is allowed.

## Running the page locally

```bash
npm run dev
```

Then open `http://localhost:5173/bench.html` (Web Serial works on localhost).
To check the offline tests without a person, in headless Chromium:

```bash
npm run build && npx vite preview --port 4173
```

```bash
node tools/bench_headless.mjs --autorun replay
```

(`PLAYWRIGHT` and `CHROMIUM` environment variables point it at a Playwright
install and a Chromium binary when they are not found on their own; see the
script's header.)
