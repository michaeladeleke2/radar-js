# radar.js

A JavaScript library for the Infineon BGT60TR13C radar (Radar Baseboard MCU7).
It talks to the board over Web Serial, so it runs in the browser with nothing
to install, and its signal processing matches the SensDSv2 Python pipeline.

Live demo: https://michaeladeleke2.github.io/radar-js/

## Use it

ES module:

```html
<script type="module">
  import radar from './radar.js';

  await radar.connect();                 // Web Serial picker + board handshake
  console.log(radar.boardInfo());        // { board, firmware, chip }
  radar.onFrame(cube => { /* Float32Array, 3 x 128 x 256 */ });
  await radar.start();
</script>
```

Plain script tag (defines `window.radar`):

```html
<script src="radar.iife.js"></script>
```

Web Serial needs Chrome or Edge on a computer, and a page served over HTTPS or
from `localhost`.

## API

| | |
|---|---|
| `radar.connect()` | Port picker and handshake; resolves to `{ board, firmware, chip }` |
| `radar.configure(settings)` | Checks settings (Infineon SDK names). Only the SensDSv2 configuration is supported for now |
| `radar.start()` / `radar.stop()` | Start or stop streaming |
| `radar.onFrame(cb)` | Raw frames, the same values as the SDK's `get_next_frame()` |
| `radar.dsp.*` | Range-Doppler map, live and recorded spectrogram, STFT spectrogram (`stftSpectrogram`, `spectrogramToDb`), range map (raw / MTI), FFT, windows, `butter`, `lfilter` |
| `radar.viz.*` | Canvas plots in the SensDSv2 look (jet colormap) |
| `radar.data.*` | Read and write `.npy` recordings |

## Develop

```bash
npm install
npm run dev        # demo on http://localhost:5173
npm test           # Vitest, compared with Python-generated fixtures
npm run build      # typecheck + demo into dist/
npm run build:lib  # dist-lib/radar.js and dist-lib/radar.iife.js
```

Pushing to `main` deploys the demo to GitHub Pages (`.github/workflows/pages.yml`).

See LICENSING.md for the origin and licence of each part.
