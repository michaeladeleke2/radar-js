// radar.js demo. Three sources feed one pipeline:
//   Live      radar.connect / start / onFrame (the device module)
//   File      radar.data.loadNpy / loadJson, played back at 10 frames per second
//   Simulate  radar.simulate.frames, one frame every 100 ms
// Every frame goes to radar.stream.LiveSpectrogramWorker (processing) and the
// result to radar.viz.LiveSpectrogramPlot. Record saves the live or simulated
// stream with radar.data.saveNpy.
//
// The spectrogram settings are sensds-web's Visualize tab defaults: antenna 0,
// a 5 s history (50 frames), color floor -50 dB, redrawn every 200 ms.

import radar from '../src/index';
import type { Recording } from '../src/data/index';
import type { RadarConfig } from '../src/config/types';

const ANTENNA = 0;
const HISTORY_FRAMES = 50;                      // max(10, round(5 s * 10 fps))
const JET_VMIN = -50.0;                         // REF_JET_VMIN
const REDRAW_MS = 200;
const MAX_RECORD_FRAMES = 600;                  // 60 s at 10 frames per second
const CONFIG: RadarConfig = radar.config.SENSDS_CONFIG;
const FRAME_MS = CONFIG.frame_repetition_time_s * 1000;

type Mode = 'live' | 'file' | 'sim';
const $ = (id: string) => document.getElementById(id)!;
const button = (id: string) => $(id) as HTMLButtonElement;
const canvas = $('plot') as HTMLCanvasElement;

// ---------- processing and plot ----------
let shape: { nChirp: number; nSample: number; nRx: number } = { nChirp: CONFIG.num_chirps, nSample: CONFIG.num_samples, nRx: 3 };
let plot: InstanceType<typeof radar.viz.LiveSpectrogramPlot>;
let pending: { history: Float64Array; count: number; dopplerBins: number } | null = null;
const proc = new radar.stream.LiveSpectrogramWorker(({ history, dopplerBins, count }: { history: Float64Array; dopplerBins: number; count: number }) => {
  pending = { history, dopplerBins, count };
});
let frameCount = 0;

function resetView(title: string, config = CONFIG) {
  const maxSpeed = -radar.dsp.velocityAxis(config)[0];
  plot = new radar.viz.LiveSpectrogramPlot(canvas, { historyLength: HISTORY_FRAMES, maxSpeed, jetVmin: JET_VMIN, title });
  proc.reset({ nSample: shape.nSample, nChirp: shape.nChirp, historyLength: HISTORY_FRAMES });
  pending = null;
  frameCount = 0;
  $('frames').textContent = '0';
  plot.drawEmpty();
}

// Every source calls this with one frame (rx x chirp x sample).
function feed(cube: Float32Array | Float64Array, recordable: boolean) {
  const per = shape.nChirp * shape.nSample;
  proc.push(cube.subarray(ANTENNA * per, (ANTENNA + 1) * per));
  frameCount++;
  $('frames').textContent = String(frameCount);
  if (recordable && recording) record(cube);
}

setInterval(() => {
  if (!pending) return;
  const p = pending;
  pending = null;
  plot.draw(p.history, p.count, p.dopplerBins);
}, REDRAW_MS);
new ResizeObserver(() => plot?.redraw()).observe(canvas);

const status = (text: string) => { $('statusText').textContent = text; };
const setRunning = (on: boolean) => $('dot').classList.toggle('on', on);

// ---------- modes ----------
let mode: Mode = 'live';
function setMode(next: Mode) {
  if (next === mode) return;
  stopFile();
  stopSim();
  if (radar.isStreaming()) radar.stop();
  finishRecording();
  mode = next;
  for (const m of ['live', 'file', 'sim'] as Mode[]) {
    $(`mode-${m}`).setAttribute('aria-pressed', String(m === mode));
    $(`panel-${m}`).hidden = m !== mode;
  }
  $('liveHint').hidden = mode !== 'live';
  shape = { nChirp: CONFIG.num_chirps, nSample: CONFIG.num_samples, nRx: 3 };
  resetView(mode === 'sim' ? 'Doppler Spectrogram (simulated)' : mode === 'file' ? 'Doppler Spectrogram (file)' : 'Doppler Spectrogram (live)');
  status(mode === 'live' ? (radar.isConnected() ? 'Connected.' : 'Not connected.') : mode === 'file' ? 'Load a recording to play it.' : 'Press Start to simulate.');
  setRunning(false);
  renderLive();
}
for (const m of ['live', 'file', 'sim'] as Mode[]) $(`mode-${m}`).onclick = () => setMode(m);

// ---------- Live (device) ----------
function renderLive() {
  const connected = radar.isConnected(), streaming = radar.isStreaming();
  button('connectBtn').textContent = connected ? 'Disconnect' : 'Connect';
  button('startBtn').disabled = !connected || streaming;
  button('stopBtn').disabled = !connected || !streaming;
  const info = radar.boardInfo();
  $('boardName').textContent = info ? info.board || '(not reported)' : '–';
  $('firmware').textContent = info ? info.firmware : '–';
  $('chip').textContent = info ? (info.chip.isBGT60TR13C ? 'BGT60TR13C' : 'unknown') : '–';
  if (mode === 'live') { setRunning(streaming); renderRecord(streaming); }
}

radar.onState(({ message }: { message?: string }) => {
  if (message && mode === 'live') status(message);
  if (!radar.isStreaming()) finishRecording();
  renderLive();
});

if (radar.hasWebSerial()) button('connectBtn').disabled = false;
else $('noSerial').hidden = false;

button('connectBtn').onclick = async () => {
  button('connectBtn').disabled = true;
  if (radar.isConnected()) await radar.disconnect();
  else await radar.connect();
  button('connectBtn').disabled = false;
  renderLive();
};
button('startBtn').onclick = async () => {
  button('startBtn').disabled = true;
  resetView('Doppler Spectrogram (live)');
  await radar.start();
  renderLive();
};
button('stopBtn').onclick = async () => {
  button('stopBtn').disabled = true;
  await radar.stop();
  renderLive();
};
radar.onFrame((cube: Float32Array) => {
  if (mode !== 'live') return;
  feed(cube, true);
  $('drops').textContent = String(radar.stats().drops);
});

// ---------- File (offline) ----------
let file: { rec: Recording; name: string; position: number } | null = null;
let fileTimer: ReturnType<typeof setInterval> | null = null;

function stopFile() {
  if (fileTimer) clearInterval(fileTimer);
  fileTimer = null;
  if (mode === 'file') setRunning(false);
  button('playBtn').disabled = !file;
  button('pauseBtn').disabled = true;
}

button('loadBtn').onclick = () => ($('fileInput') as HTMLInputElement).click();
($('fileInput') as HTMLInputElement).onchange = async e => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  stopFile();
  try {
    const loaded = f.name.toLowerCase().endsWith('.json') ? await radar.data.loadJson(f) : await radar.data.loadNpy(f);
    const rec = loaded as Recording;
    if (!rec || !ArrayBuffer.isView(rec.data) || rec.shape?.length !== 4) throw new Error('not a radar.js recording');
    file = { rec, name: f.name, position: 0 };
    const [nFrame, nRx, nChirp, nSample] = rec.shape;
    shape = { nChirp, nSample, nRx };
    resetView('Doppler Spectrogram (file)', rec.config ?? CONFIG);
    $('fileInfo').textContent = `${f.name}: ${nFrame} frames (${(nFrame * FRAME_MS / 1000).toFixed(1)} s), ${nRx} antennas, ${nChirp} chirps, ${nSample} samples`;
    button('csvBtn').disabled = false;
    playFile();
  } catch (err) {
    file = null;
    button('csvBtn').disabled = true;
    status(`Could not open ${f.name}: ${(err as Error).message}`);
  }
};

function playFile() {
  if (!file) return;
  stopFile();
  const { rec } = file;
  const [nFrame, nRx, nChirp, nSample] = rec.shape;
  const per = nRx * nChirp * nSample;
  fileTimer = setInterval(() => {
    if (!file) return;
    if (file.position >= nFrame) {
      if (!($('loopChk') as HTMLInputElement).checked) { stopFile(); status(`${file.name}: finished.`); return; }
      file.position = 0;
    }
    feed(rec.data.subarray(file.position * per, (file.position + 1) * per), false);
    file.position++;
    status(`${file.name}: frame ${file.position} of ${nFrame}`);
  }, FRAME_MS);
  setRunning(true);
  button('playBtn').disabled = true;
  button('pauseBtn').disabled = false;
}
button('playBtn').onclick = playFile;
button('pauseBtn').onclick = () => { stopFile(); if (file) status(`${file.name}: paused at frame ${file.position}.`); };
button('csvBtn').onclick = () => {
  if (!file) return;
  const rows = radar.data.trackTable(file.rec, file.rec.config ?? CONFIG);
  radar.data.download(radar.data.saveCsv(rows), file.name.replace(/\.(npy|json)$/i, '') + '_track.csv');
};

// ---------- Simulate ----------
let simTimer: ReturnType<typeof setInterval> | null = null;
let simTime = 0;
const slider = (id: string) => Number(($(id) as HTMLInputElement).value);
function showSliders() {
  $('simRangeOut').textContent = `${slider('simRange').toFixed(2)} m`;
  $('simSpeedOut').textContent = `${slider('simSpeed').toFixed(1)} m/s`;
  $('simNoiseOut').textContent = `${slider('simNoise')} counts`;
}
for (const id of ['simRange', 'simSpeed', 'simNoise']) $(id).oninput = showSliders;
showSliders();

function simFrame() {
  // A hand swinging toward and away from the radar at 0.5 Hz around the
  // chosen distance: range r0 + A sin(wt), speed A w cos(wt), peak speed A w.
  const w = 2 * Math.PI * 0.5, peak = slider('simSpeed'), r0 = slider('simRange');
  const amplitude = Math.min(peak / w, Math.max(0, r0 - 0.15));
  const range_m = r0 + amplitude * Math.sin(w * simTime);
  const speed_m_s = amplitude * w * Math.cos(w * simTime);
  const rec = radar.simulate.frames(CONFIG, {
    targets: [{ range_m, speed_m_s, amplitude: 600 }, { range_m: 2.4, amplitude: 250 }],   // the hand, and a wall
    noise: slider('simNoise'), seed: frameCount + 1,
  });
  simTime += CONFIG.frame_repetition_time_s;
  feed(rec.data, true);
  status(`Simulating: hand at ${range_m.toFixed(2)} m, moving ${speed_m_s >= 0 ? 'away from' : 'toward'} the radar at ${Math.abs(speed_m_s).toFixed(2)} m/s`);
}
function stopSim() {
  if (simTimer) clearInterval(simTimer);
  simTimer = null;
  button('simStartBtn').disabled = false;
  button('simStopBtn').disabled = true;
  if (mode === 'sim') { setRunning(false); finishRecording(); renderRecord(false); }
}
button('simStartBtn').onclick = () => {
  resetView('Doppler Spectrogram (simulated)');
  simTime = 0;
  simTimer = setInterval(simFrame, FRAME_MS);
  button('simStartBtn').disabled = true;
  button('simStopBtn').disabled = false;
  setRunning(true);
  renderRecord(true);
};
button('simStopBtn').onclick = () => { stopSim(); status('Simulation stopped.'); };

// ---------- Record ----------
let recording: Float32Array[] | null = null;
function renderRecord(streamAvailable: boolean) {
  const rec = button('recBtn');
  rec.disabled = !streamAvailable && !recording;
  rec.setAttribute('aria-pressed', String(Boolean(recording)));
  rec.textContent = recording ? `Stop and save (${recording.length} frames, ${(recording.length * shape.nRx * shape.nChirp * shape.nSample * 4 / 1e6).toFixed(1)} MB)` : 'Record';
}
function record(cube: Float32Array | Float64Array) {
  recording!.push(Float32Array.from(cube));
  if (recording!.length >= MAX_RECORD_FRAMES) finishRecording();
  else renderRecord(true);
}
function finishRecording() {
  if (!recording) return;
  const frames = recording;
  recording = null;
  if (frames.length) {
    const rec = radar.data.fromFrames(frames, [shape.nRx, shape.nChirp, shape.nSample], CONFIG);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
    radar.data.download(radar.data.saveNpy(rec), `radar_${mode === 'sim' ? 'sim_' : ''}${stamp}.npy`);
    status(`Saved ${frames.length} frames (${(frames.length * FRAME_MS / 1000).toFixed(1)} s).`);
  }
  renderRecord(mode === 'live' ? radar.isStreaming() : Boolean(simTimer));
}
button('recBtn').onclick = () => {
  if (recording) finishRecording();
  else { recording = []; renderRecord(true); }
};

resetView('Doppler Spectrogram (live)');
renderLive();
