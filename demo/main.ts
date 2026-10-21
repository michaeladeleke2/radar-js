// radar.js demo: Connect, board info, Start/Stop and the live Doppler
// spectrogram. Uses only the radar-js library (src/), not sensds-web.
//
// The spectrogram settings are sensds-web's Visualize tab defaults
// (src/app/visualize.js and src/app/settings.js there): antenna 0, a 5 s
// history (50 frames), +/-4.11 m/s, color floor -50 dB, redrawn every 200 ms.

import radar from '../src/index';

const ANTENNA = 0;
const N_CHIRP = 128, N_SAMPLE = 256;
const HISTORY_FRAMES = 50;                      // max(10, round(5 s * 10 fps))
const MAX_SPEED_M_S = 4.112380411522634;        // REF_MAX_SPEED_M_S
const JET_VMIN = -50.0;                         // REF_JET_VMIN
const REDRAW_MS = 200;

const $ = (id: string) => document.getElementById(id)!;
const connectBtn = $('connectBtn') as HTMLButtonElement;
const startBtn = $('startBtn') as HTMLButtonElement;
const stopBtn = $('stopBtn') as HTMLButtonElement;
const canvas = $('plot') as HTMLCanvasElement;

const plot = new radar.viz.LiveSpectrogramPlot(canvas, { historyLength: HISTORY_FRAMES, maxSpeed: MAX_SPEED_M_S, jetVmin: JET_VMIN });
let pending: { history: Float64Array; count: number; dopplerBins: number } | null = null;
const proc = new radar.stream.LiveSpectrogramWorker(({ history, dopplerBins, count }: { history: Float64Array; dopplerBins: number; count: number }) => {
  pending = { history, dopplerBins, count };
});
plot.drawEmpty();

function render() {
  const connected = radar.isConnected(), streaming = radar.isStreaming();
  connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
  startBtn.disabled = !connected || streaming;
  stopBtn.disabled = !connected || !streaming;
  $('dot').classList.toggle('on', streaming);
  const info = radar.boardInfo();
  $('boardName').textContent = info ? info.board || '(not reported)' : '–';
  $('firmware').textContent = info ? info.firmware : '–';
  $('chip').textContent = info ? (info.chip.isBGT60TR13C ? 'BGT60TR13C' : 'unknown') : '–';
}

radar.onState(({ message }: { message?: string }) => {
  if (message) $('statusText').textContent = message;
  render();
});

if (radar.hasWebSerial()) connectBtn.disabled = false;
else $('noSerial').hidden = false;

connectBtn.onclick = async () => {
  connectBtn.disabled = true;
  if (radar.isConnected()) await radar.disconnect();
  else await radar.connect();
  connectBtn.disabled = false;
  render();
};

startBtn.onclick = async () => {
  startBtn.disabled = true;
  proc.reset({ nSample: N_SAMPLE, nChirp: N_CHIRP, historyLength: HISTORY_FRAMES });
  pending = null;
  plot.drawEmpty();
  await radar.start();
  render();
};

stopBtn.onclick = async () => {
  stopBtn.disabled = true;
  await radar.stop();
  render();
};

const per = N_CHIRP * N_SAMPLE;
radar.onFrame((cube: Float32Array) => {
  proc.push(cube.subarray(ANTENNA * per, (ANTENNA + 1) * per));
  const { frames, drops } = radar.stats();
  $('frames').textContent = String(frames);
  $('drops').textContent = String(drops);
});

setInterval(() => {
  if (!pending) return;
  const p = pending;
  pending = null;
  plot.draw(p.history, p.count, p.dopplerBins);
}, REDRAW_MS);

new ResizeObserver(() => plot.redraw()).observe(canvas);
render();
