# radar.js

Radar signal processing in JavaScript for the Infineon BGT60TR13C (Radar
Baseboard MCU7). Connect to the board from the browser over Web Serial, or work
offline with recordings and simulated data. The processing matches the SensDSv2
Python pipeline, checked against golden data saved from SensDSv2 itself.

Live demo: https://michaeladeleke2.github.io/radar-js/

## Getting started

In a page, as an ES module:

```html
<script type="module">
  import radar from './radar.js';
</script>
```

Or with a plain script tag, which defines `window.radar`:

```html
<script src="radar.iife.js"></script>
```

Build both with `npm run build:lib` (they land in `dist-lib/`).

Talking to the board needs Web Serial: Chrome or Edge on a computer, and a
page served over HTTPS or from `localhost`. Everything else runs anywhere.

## Examples

### Connect to the radar and stream frames

```js
const info = await radar.connect();          // browser asks for the port; handshake
console.log(info.board, info.firmware);      // "Radar Baseboard MCU7", "2.9.0"

radar.onFrame(frame => {
  // Float32Array, 3 antennas x 128 chirps x 256 samples, values -1..1
});
await radar.start();
// ...
await radar.stop();
```

### Range-Doppler map of one frame

```js
const config = radar.config.SENSDS_CONFIG;
const frame = { data: cube.subarray(0, 128 * 256), shape: [128, 256] };   // antenna 0

const rdm = radar.dsp.rangeDopplerMap(frame);      // [512 range bins][512 Doppler bins], dB
const bin = radar.dsp.selectRangeBin(rdm);         // strongest range bin
const metres = radar.dsp.rangeAxis(config)[bin];
const speeds = radar.dsp.velocityAxis(config);     // m/s per Doppler bin
```

### Spectrogram of a recording, no board needed

```js
const recording = await radar.data.loadNpy(file);  // a File from <input type="file">
const { spectrogram, rangeBins } = radar.dsp.dopplerSpectrogram(recording);
// spectrogram: [frame][512 Doppler bins] in dB, as SensDSv2's live view

const stft = radar.dsp.stftSpectrogram(recording, { mti: true });
const image = radar.dsp.spectrogramToDb(stft);     // SensDSv2's training-image method
```

### Range map

```js
const map = radar.dsp.rangeMap(recording, { mode: 'mti' });   // [frame][range bin], moving targets only
const profile = radar.dsp.rangeProfile(frame, { mode: 'raw' });
```

### Simulate a target

```js
const sim = radar.simulate.frames(config, {
  targets: [{ range_m: 0.8, speed_m_s: -0.5 }],    // 0.8 m away, approaching at 0.5 m/s
  nFrames: 20,
  noise: 8,                                        // ADC counts
});
radar.dsp.dopplerSpectrogram(sim);                 // same shape and scale as real frames
```

### Save and export

```js
radar.data.download(radar.data.saveNpy(recording), 'capture.npy');   // numpy.load reads it

const rows = radar.data.trackTable(recording, config);   // one row per frame
// [{ time_s: 0, frame: 0, range_m: 0.7427, velocity_m_s: -0.498, power_db: 12.02 }, ...]
radar.data.download(radar.data.saveCsv(rows), 'track.csv');          // opens in CODAP

radar.data.download(radar.data.saveJson(recording), 'clip.json');    // short clips
```

### In Node

Node 20+ has `Blob`, so the same functions work on files from disk:

```js
import { readFileSync, writeFileSync } from 'node:fs';
const recording = await radar.data.loadNpy(readFileSync('capture.npy'));
const blob = radar.data.saveCsv(radar.data.trackTable(recording, radar.config.SENSDS_CONFIG));
writeFileSync('track.csv', Buffer.from(await blob.arrayBuffer()));
```

## API

| Namespace | What it has |
|---|---|
| `radar.connect()`, `start()`, `stop()`, `disconnect()`, `onFrame(cb)`, `onState(cb)`, `boardInfo()` | The board, over Web Serial |
| `radar.configure(settings)` | Checks settings (Infineon SDK names). Only the SensDSv2 configuration is supported for now |
| `radar.config` | `SENSDS_CONFIG` and acquisition sizes |
| `radar.dsp` | Pure functions: `rangeFft`, `rangeDopplerMap`, `selectRangeBin`, `smoothRangeBins`, `dopplerSpectrogram`, `rangeProfile`, `rangeMap`, `rangeAxis`, `velocityAxis`, `slowTimeSignal`, `stft`, `stftSpectrogram`, `spectrogramToDb`, `mtiHighpass`, `fft`, `blackmanharris`, `chebwin`, `hanning`, `butter`, `lfilter` |
| `radar.stream` | Stateful live processors: `LiveSpectrogram`, `LiveRangeMap`, and Web Worker versions |
| `radar.data` | `loadNpy`, `saveNpy`, `loadJson`, `saveJson`, `loadCsv`, `saveCsv`, `toCsv`, `parseCsv`, `spectrogramTable`, `trackTable`, `fromFrames`, `download` |
| `radar.simulate` | `frames(config, { targets, nFrames, noise, seed })` |
| `radar.viz` | Canvas plots in the SensDSv2 look (jet colormap) |

`radar.dsp` functions take nested arrays or `{ data, shape }` typed arrays, take
their settings as arguments, return plain nested arrays in SensDSv2's layouts,
and need no board, page or global state. Functions that take frames accept a
whole recording (`{ data, shape: [frames, rx, chirps, samples] }`) and an
`antenna` option.

## How it is checked

`npm test` runs Vitest. `test/golden.test.ts` compares every `radar.dsp`
function with output saved from SensDSv2's own Python functions
(`tools/make_golden.py`, data and description in `test/golden/`). See
PROGRESS.md for what is verified and what is not.

## Develop

```bash
npm install
npm run dev        # demo on http://localhost:5173
npm test           # Vitest, including the golden comparison
npm run build      # typecheck + demo into dist/
npm run build:lib  # dist-lib/radar.js and dist-lib/radar.iife.js
```

Regenerate the golden data (reads SensDSv2, writes only `test/golden/`):

```bash
python3 tools/make_golden.py ~/SensDSv2
```

Pushing to `main` deploys the demo to GitHub Pages (docs/DEPLOY.md).

See LICENSING.md for the origin and licence of each part.
