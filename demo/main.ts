// radar.js demo. Sources feed one pipeline:
//   Live      radar.connect / start / onFrame (the device module), plus the
//             Live benchmark (radar.bench, radar.capture)
//   Dataset   the same live stream, recorded as labeled clips (radar.capture)
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
import type { Sink } from '../src/capture/index';

const ANTENNA = 0;
const HISTORY_FRAMES = 50;                      // max(10, round(5 s * 10 fps))
const JET_VMIN = -50.0;                         // REF_JET_VMIN
const REDRAW_MS = 200;
const MAX_RECORD_FRAMES = 600;                  // 60 s at 10 frames per second
const CONFIG: RadarConfig = radar.config.SENSDS_CONFIG;
const FRAME_MS = CONFIG.frame_repetition_time_s * 1000;

type Mode = 'live' | 'dataset' | 'file' | 'sim';
const MODES: Mode[] = ['live', 'dataset', 'file', 'sim'];
const usesBoard = (m: Mode) => m === 'live' || m === 'dataset';
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
  if (benchRun || datasetBusy) return;          // finish the benchmark or clip first
  stopFile();
  stopSim();
  if (radar.isStreaming() && !(usesBoard(mode) && usesBoard(next))) radar.stop();
  finishRecording();
  mode = next;
  for (const m of MODES) $(`mode-${m}`).setAttribute('aria-pressed', String(m === mode));
  $('panel-live').hidden = !usesBoard(mode);
  $('panel-bench').hidden = mode !== 'live';
  $('panel-dataset').hidden = mode !== 'dataset';
  $('panel-file').hidden = mode !== 'file';
  $('panel-sim').hidden = mode !== 'sim';
  $('liveHint').hidden = !usesBoard(mode);
  button('recBtn').hidden = mode === 'dataset';
  shape = { nChirp: CONFIG.num_chirps, nSample: CONFIG.num_samples, nRx: 3 };
  resetView(mode === 'sim' ? 'Doppler Spectrogram (simulated)' : mode === 'file' ? 'Doppler Spectrogram (file)' : 'Doppler Spectrogram (live)');
  status(usesBoard(mode) ? (radar.isStreaming() ? 'Radar streaming.' : radar.isConnected() ? 'Connected. Press Start.' : 'Not connected.') : mode === 'file' ? 'Load a recording to play it.' : 'Press Start to simulate.');
  setRunning(false);
  renderLive();
  if (mode === 'dataset') renderCounts();
}
for (const m of MODES) $(`mode-${m}`).onclick = () => setMode(m);

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
  if (usesBoard(mode)) { setRunning(streaming); renderRecord(streaming); }
  button('benchBtn').disabled = !streaming || Boolean(benchRun);
  button('dsRecordBtn').disabled = !streaming || datasetBusy;
}

radar.onState(({ message, restarted }: { message?: string; restarted?: boolean }) => {
  if (restarted) { clipRecorder.noteRestart(); benchRecorder.noteRestart(); }
  if (message && usesBoard(mode)) status(message);
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
  if (!usesBoard(mode)) return;
  const t = performance.now();
  clipRecorder.push(cube, t);
  benchRecorder.push(cube, t);
  if (benchRun) benchFrame(cube, t);
  else feed(cube, true);
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
  renderRecord(usesBoard(mode) ? radar.isStreaming() : Boolean(simTimer));
}
button('recBtn').onclick = () => {
  if (recording) finishRecording();
  else { recording = []; renderRecord(true); }
};

// ---------- shared by Dataset and Live benchmark ----------
const clipRecorder = new radar.capture.Recorder(() => radar.stats().drops);
const benchRecorder = new radar.capture.Recorder(() => radar.stats().drops);
let sink: Sink = radar.capture.downloadSink();
const deviceName = () => ($('deviceName') as HTMLInputElement).value.trim();
try { ($('deviceName') as HTMLInputElement).value = localStorage.getItem('radarjs-device-name') ?? ''; } catch { /* per visit */ }
$('deviceName').onchange = () => { try { localStorage.setItem('radarjs-device-name', deviceName()); } catch { /* per visit */ } };
const overlay = (text: string | null) => { $('overlay').hidden = text === null; $('overlay').textContent = text ?? ''; };
const FRAME_SHAPE: [number, number, number] = [3, CONFIG.num_chirps, CONFIG.num_samples];

function showSink() {
  $('folderInfo').textContent = sink.remove ? `Saving to the folder "${sink.name}".` : 'Files download to your Downloads folder until you choose a folder.';
}
if (!radar.capture.canChooseFolder()) button('folderBtn').hidden = true;
radar.capture.restoreFolder().then(s => { if (s) { sink = s; showSink(); loadCounts(); } });
button('folderBtn').onclick = async () => {
  try { sink = await radar.capture.chooseFolder(); showSink(); await loadCounts(); } catch { /* picker closed */ }
};

// ---------- Dataset ----------
const LABELS = ['push', 'pull', 'swipe', 'wave', 'empty'];
const DISTANCES = [0.3, 0.6, 1];
const TARGET_PER_CELL = 5;
let counts = new Map<string, number>();
const key = (label: string, d: number) => `${label}@${d}`;
let datasetBusy = false;
let lastClip: string | null = null;

async function loadCounts() {
  counts = new Map();
  for (const s of (await sink.sidecars?.()) ?? []) if (s.type === 'dataset' && s.label) counts.set(key(s.label, s.distance_m ?? 0), (counts.get(key(s.label, s.distance_m ?? 0)) ?? 0) + 1);
  renderCounts();
}
function renderCounts() {
  const head = `<tr><th>Label</th>${DISTANCES.map(d => `<th>${d.toFixed(1)} m</th>`).join('')}<th>Total</th></tr>`;
  const rows = LABELS.map(l => {
    const cells = DISTANCES.map(d => { const n = counts.get(key(l, d)) ?? 0; return `<td class="${n >= TARGET_PER_CELL ? 'done' : ''}">${n}</td>`; });
    const total = DISTANCES.reduce((a, d) => a + (counts.get(key(l, d)) ?? 0), 0);
    return `<tr><td>${l}</td>${cells.join('')}<td>${total}</td></tr>`;
  });
  const all = [...counts.values()].reduce((a, b) => a + b, 0);
  $('dsCounts').innerHTML = head + rows.join('') + `<tr><td>all</td>${DISTANCES.map(() => '<td></td>').join('')}<td>${all}</td></tr>`;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
button('dsRecordBtn').onclick = async () => {
  if (!radar.isStreaming() || datasetBusy) return;
  const label = ($('dsLabel') as HTMLSelectElement).value;
  const distance = Number(($('dsDistance') as HTMLSelectElement).value);
  const seconds = Math.max(1, Number(($('dsSeconds') as HTMLInputElement).value) || 3);
  const notes = ($('dsNotes') as HTMLInputElement).value.trim();
  datasetBusy = true; renderLive();
  try {
    for (const n of ['3', '2', '1']) { overlay(n); status(`Get ready: ${label} at ${distance} m`); await sleep(1000); }
    overlay('GO');
    clipRecorder.onProgress = (_n, t) => { overlay(`${Math.max(0, seconds - t).toFixed(1)} s`); };
    const result = await clipRecorder.start(seconds, CONFIG.frame_repetition_time_s);
    clipRecorder.onProgress = null;
    overlay('Saving…');
    const stem = radar.capture.captureName(label, distance, result.startedAt);
    const meta = radar.capture.sidecar({
      type: 'dataset', file: `${stem}.npy`, capture: result, config: CONFIG, shape: FRAME_SHAPE,
      board: radar.boardInfo(), device: await radar.capture.deviceInfo(deviceName()), label, distance_m: distance, notes,
    });
    await radar.capture.saveCapture(sink, stem, result.frames, FRAME_SHAPE, meta);
    lastClip = stem;
    counts.set(key(label, distance), (counts.get(key(label, distance)) ?? 0) + 1);
    renderCounts();
    const ok = result.frames.length === result.expected && result.dropped === 0;
    $('dsLast').textContent = `${ok ? 'Saved' : 'Saved, check it:'} ${stem}  ${result.frames.length}/${result.expected} frames, ${result.dropped} dropped`;
    button('dsDiscardBtn').hidden = !sink.remove;
    status(`Saved ${label} at ${distance} m (${counts.get(key(label, distance))} of ${TARGET_PER_CELL}).`);
  } catch (err) {
    status(`Clip not saved: ${(err as Error).message}`);
  } finally {
    overlay(null);
    datasetBusy = false; renderLive();
  }
};
button('dsDiscardBtn').onclick = async () => {
  if (!lastClip || !sink.remove) return;
  const [label, d] = [lastClip.split('_')[0], Number(lastClip.split('_')[1].replace('m', ''))];
  await sink.remove(`${lastClip}.npy`); await sink.remove(`${lastClip}.json`);
  counts.set(key(label, d), Math.max(0, (counts.get(key(label, d)) ?? 1) - 1));
  renderCounts();
  $('dsLast').textContent = `Discarded ${lastClip}.`;
  lastClip = null;
  button('dsDiscardBtn').hidden = true;
};

// ---------- Live benchmark ----------
// Streams for a fixed time with processing either on the page (main thread)
// or in a Web Worker, drawing every result as soon as it is ready
// (requestAnimationFrame), and measures per frame:
//   processing  time inside LiveSpectrogram.processFrame (in the worker for
//               the worker run)
//   latency     frame delivered by radar.onFrame -> plot.draw finished for it
// The frames are saved like a dataset clip; the sidecar (type "live") holds
// the results.
interface BenchRun {
  processing: 'main' | 'worker';
  procMs: number[]; latencyMs: number[];
  arrivals: Map<number, number>;
  nextId: number; drawn: number; skipped: number;
  latest: { history: Float64Array; id: number; tArrival: number } | null;
  rafPending: boolean;
  main?: InstanceType<typeof radar.stream.LiveSpectrogram>;
  worker?: InstanceType<typeof radar.bench.TimedSpectrogramWorker>;
}
let benchRun: BenchRun | null = null;

function benchDraw(history: Float64Array, id: number, tArrival: number) {
  const run = benchRun!;
  if (run.latest) run.skipped++;              // an undrawn result replaced by a newer one
  run.latest = { history, id, tArrival };
  if (run.rafPending) return;
  run.rafPending = true;
  requestAnimationFrame(() => {
    const r = benchRun;
    if (!r || !r.latest) return;
    r.rafPending = false;
    const p = r.latest; r.latest = null;
    plot.draw(p.history, p.id, 512);
    r.latencyMs.push(performance.now() - p.tArrival);
    r.drawn++;
  });
}

function benchFrame(cube: Float32Array, tArrival: number) {
  const run = benchRun!;
  const id = ++run.nextId;
  const per = shape.nChirp * shape.nSample;
  const a0 = cube.subarray(ANTENNA * per, (ANTENNA + 1) * per);
  frameCount++; $('frames').textContent = String(frameCount);
  if (run.main) {
    const t = performance.now();
    const { history } = run.main.processFrame(a0);
    run.procMs.push(performance.now() - t);
    benchDraw(history, id, tArrival);
  } else {
    run.arrivals.set(id, tArrival);
    run.worker!.push(a0, id);
  }
}

button('benchBtn').onclick = async () => {
  if (!radar.isStreaming() || benchRun) return;
  const seconds = Math.max(5, Number(($('benchSeconds') as HTMLInputElement).value) || 60);
  const processing = ($('benchMode') as HTMLSelectElement).value as 'main' | 'worker';
  const run: BenchRun = { processing, procMs: [], latencyMs: [], arrivals: new Map(), nextId: 0, drawn: 0, skipped: 0, latest: null, rafPending: false };
  const hist = { nSample: shape.nSample, nChirp: shape.nChirp, historyLength: HISTORY_FRAMES };
  if (processing === 'main') run.main = new radar.stream.LiveSpectrogram(hist);
  else {
    run.worker = new radar.bench.TimedSpectrogramWorker(r => {
      if (benchRun !== run) return;
      run.procMs.push(r.procMs);
      const t = run.arrivals.get(r.id); run.arrivals.delete(r.id);
      if (t !== undefined) benchDraw(r.history, r.id, t);
    });
    run.worker.reset(hist);
    await sleep(300);                           // let the worker load before timing starts
  }
  resetView(`Live benchmark (${processing === 'main' ? 'main thread' : 'Web Worker'})`);
  $('benchResult').hidden = false;
  $('benchResult').textContent = `Running ${seconds} s, ${processing === 'main' ? 'main thread' : 'Web Worker'}…`;
  benchRun = run; renderLive();
  benchRecorder.onProgress = (n, t) => { if (n % 10 === 0) status(`Benchmark: ${t.toFixed(0)} of ${seconds} s, ${n} frames`); };
  const result = await benchRecorder.start(seconds, CONFIG.frame_repetition_time_s);
  benchRecorder.onProgress = null;
  await sleep(500);                             // results still in flight
  benchRun = null;
  run.worker?.terminate();
  const s = radar.bench.summarize;
  const benchmark = {
    processing,
    processing_ms: s(run.procMs),
    latency_ms: s(run.latencyMs),
    frames_processed: run.procMs.length,
    frames_drawn: run.drawn,
    draws_skipped: run.skipped,
    definitions: {
      processing_ms: processing === 'main' ? 'LiveSpectrogram.processFrame on the page, per frame' : 'LiveSpectrogram.processFrame inside the Web Worker, per frame (excludes message passing)',
      latency_ms: 'radar.onFrame delivery of a frame -> plot.draw finished for that frame (drawn at the next animation frame)',
      dropped: "frames the device reported as failed (radar.stats().drops) during the run",
    },
  };
  const stem = radar.capture.captureName(`live_${processing}`, null, result.startedAt);
  const meta = radar.capture.sidecar({
    type: 'live', file: `${stem}.npy`, capture: result, config: CONFIG, shape: FRAME_SHAPE,
    board: radar.boardInfo(), device: await radar.capture.deviceInfo(deviceName()),
  });
  meta.benchmark = benchmark;
  $('benchResult').textContent = `Saving ${result.frames.length} frames…`;
  try { await radar.capture.saveCapture(sink, stem, result.frames, FRAME_SHAPE, meta); } catch (err) { status(`Benchmark not saved: ${(err as Error).message}`); }
  const f = (x: number) => x.toFixed(2);
  $('benchResult').textContent =
    `${processing === 'main' ? 'Main thread' : 'Web Worker'}, ${seconds} s  (${stem})\n` +
    `frames      ${result.frames.length} of ${result.expected} expected, ${result.dropped} dropped\n` +
    `processing  mean ${f(benchmark.processing_ms.mean)}  median ${f(benchmark.processing_ms.median)}  p95 ${f(benchmark.processing_ms.p95)} ms\n` +
    `latency     mean ${f(benchmark.latency_ms.mean)}  median ${f(benchmark.latency_ms.median)}  p95 ${f(benchmark.latency_ms.p95)} ms`;
  status('Benchmark finished.');
  resetView('Doppler Spectrogram (live)');
  renderLive();
};

resetView('Doppler Spectrogram (live)');
renderLive();
