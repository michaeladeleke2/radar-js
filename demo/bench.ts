// radar.js benchmark page (demo/bench.html): how fast radar.js runs on this
// computer, for the paper's System Performance section (method after WebBCI,
// Stegman et al. 2018: each test many times, the mean reported, fresh data on
// every run, real time judged against the sensor's data rate).
//
//   Replay    radar.dsp stages and the demo's full per-frame live pipeline on
//             recorded frames (antenna 1), warmup then N timed iterations,
//             each on a different frame (or window of frames) than the last
//   Scaling   rangeFft, rangeDopplerMap and the full pipeline on simulated
//             frames from 32x64 to 256x512 (chirps x samples)
//   Threads   the full pipeline at 10 frames/s for a fixed time on the main
//             thread and through radar.stream's Web Worker, with
//             requestAnimationFrame intervals and the worker round trip
//   Live      the board through Web Serial: four modes (main thread or
//             worker, plot on or off), per frame arrival, processing,
//             rendering and arrival-to-output latency, and whether the
//             delay grows (the device falling behind)
//
// Results download as JSON (everything, raw timings) and a summary CSV.
// Runs on Chrome 89 (a benchmark Chromebook): nothing newer is used.

import radar from '../src/index';
import type { FrameMeta } from '../src/index';
import type { RadarConfig } from '../src/config/types';
import { parseNpy } from '../src/data/npy.js';

(window as unknown as { __benchStarted: boolean }).__benchStarted = true;
const showError = (msg: string) => (window as unknown as { __benchShowError?: (m: string) => void }).__benchShowError?.(msg);

const $ = (id: string) => document.getElementById(id)!;
const button = (id: string) => $(id) as HTMLButtonElement;
const input = (id: string) => $(id) as HTMLInputElement;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const nextTask = () => new Promise<void>(r => setTimeout(r, 0));

const CONFIG: RadarConfig = radar.config.SENSDS_CONFIG;
const FRAME_MS = CONFIG.frame_repetition_time_s * 1000;   // 100 ms: the sensor's data rate
const ANTENNA = 1;                                          // antenna 0 clips on the test board
const HISTORY_FRAMES = 50;                                  // the demo's Live view settings
const JET_VMIN = -50.0;
const params = new URLSearchParams(location.search);

// ---------- statistics ----------
interface Stats { n: number; mean: number; sd: number; median: number; p5: number; p95: number; min: number; max: number }
function stats(values: number[]): Stats {
  const v = values.slice().sort((a, b) => a - b), n = v.length;
  const r = (x: number) => +x.toFixed(4);
  if (!n) return { n: 0, mean: NaN, sd: NaN, median: NaN, p5: NaN, p95: NaN, min: NaN, max: NaN };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1)) : 0;
  const rank = (p: number) => v[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];   // nearest rank
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  return { n, mean: r(mean), sd: r(sd), median: r(median), p5: r(rank(0.05)), p95: r(rank(0.95)), min: r(v[0]), max: r(v[n - 1]) };
}
/** Least-squares slope of y over x. */
function slope(x: number[], y: number[]) {
  const n = x.length;
  if (n < 2) return NaN;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); }
  return sxx ? sxy / sxx : NaN;
}
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '–');

// ---------- the results file ----------
const results: Record<string, unknown> = {
  format: 'radar-js-benchmark', version: 1,
  radar_js: radar.capture.BUILD,
  started_at: new Date().toISOString(),
  method: {
    timing: 'performance.now() around each call; warmup iterations first, then timed iterations',
    fresh_data: 'every timed iteration uses a different frame (or window of frames) than the one before it',
    real_time_margin: 'frame period (100 ms) / mean time of the full per-frame pipeline; above 1 keeps up with the sensor',
    antenna: ANTENNA,
  },
};
let csvRows: (string | number)[][] = [['section', 'test', 'size', 'mode', 'n', 'mean_ms', 'sd_ms', 'median_ms', 'p5_ms', 'p95_ms', 'min_ms', 'max_ms', 'per']];
const addCsv = (section: string, test: string, size: string, mode: string, s: Stats, per = 'call') =>
  csvRows.push([section, test, size, mode, s.n, s.mean, s.sd, s.median, s.p5, s.p95, s.min, s.max, per]);

// ---------- system info ----------
const FIELDS = [['f_label', 'machine_label'], ['f_cpu', 'cpu_model'], ['f_cores', 'cpu_cores'], ['f_ram', 'ram'], ['f_power', 'power'], ['f_conn', 'connection']] as const;
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } } };
for (const [id] of FIELDS) {
  const el = $(id) as HTMLInputElement | HTMLSelectElement;
  const saved = store.get(`bench.${id}`);
  if (saved !== null) el.value = saved;
  el.addEventListener('change', () => store.set(`bench.${id}`, el.value));
}
const manual = () => Object.fromEntries(FIELDS.map(([id, key]) => [key, ($(id) as HTMLInputElement).value.trim()])) as Record<(typeof FIELDS)[number][1], string>;
let device: Awaited<ReturnType<typeof radar.capture.deviceInfo>> | null = null;
async function systemInfo() {
  device = await radar.capture.deviceInfo(manual().machine_label);
  const nav = navigator as Navigator & { deviceMemory?: number };
  const info = {
    ...manual(),
    user_agent: navigator.userAgent, browser: device.browser, browser_version: device.browserVersion,
    os: device.os, os_version: device.osVersion,
    hardware_concurrency: navigator.hardwareConcurrency ?? null, device_memory_gb: nav.deviceMemory ?? null,
    screen: { width: screen.width, height: screen.height, device_pixel_ratio: devicePixelRatio },
    timestamp: new Date().toISOString(), radar_js_commit: radar.capture.BUILD.commit, radar_js_dirty: radar.capture.BUILD.dirty,
  };
  results.system = info;
  $('sysinfo').innerHTML = '';
  const add = (k: string, v: unknown) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = String(v); $('sysinfo').append(dt, dd); };
  add('Browser', `${info.browser} ${info.browser_version}`);
  add('OS', `${info.os} ${info.os_version}`.trim());
  add('CPU threads (browser)', info.hardware_concurrency);
  add('Memory (browser, GB)', info.device_memory_gb ?? 'not reported');
  add('Screen', `${screen.width} x ${screen.height} @ ${devicePixelRatio}x`);
  add('radar.js', `${radar.capture.BUILD.version}, commit ${radar.capture.BUILD.commit}${radar.capture.BUILD.dirty ? ' (uncommitted changes)' : ''}`);
  return info;
}

// ---------- replay data ----------
let clip: { data: Float32Array; nFrames: number; nChirp: number; nSample: number; source: Record<string, unknown> } | null = null;
/** ADC codes to the SDK's float32 values (src/device/unpack.js rawToCube arithmetic). */
function codesToFloat(codes: ArrayLike<number>) {
  const out = new Float32Array(codes.length), tmp = new Float32Array(1);
  for (let i = 0; i < codes.length; i++) { tmp[0] = (codes[i] * 2) / 4095; tmp[0] = tmp[0] - 1; out[i] = tmp[0]; }
  return out;
}
function useClip(arr: { data: ArrayLike<number>; shape: number[] }, source: Record<string, unknown>) {
  const sh = arr.shape;
  let data: Float32Array, nFrames: number, nChirp: number, nSample: number;
  const asFloat = (a: ArrayLike<number>) => (a instanceof Uint16Array ? codesToFloat(a) : a instanceof Float32Array ? a : Float32Array.from(a));
  if (sh.length === 4) {                       // a radar-js / SDK capture: frames x rx x chirps x samples
    [nFrames, , nChirp, nSample] = sh;
    const rx = Math.min(ANTENNA, sh[1] - 1), per = nChirp * nSample, all = asFloat(arr.data);
    data = new Float32Array(nFrames * per);
    for (let f = 0; f < nFrames; f++) data.set(all.subarray((f * sh[1] + rx) * per, (f * sh[1] + rx + 1) * per), f * per);
    source = { ...source, antenna: rx };
  } else if (sh.length === 3) {                // one antenna: frames x chirps x samples
    [nFrames, nChirp, nSample] = sh;
    data = asFloat(arr.data);
  } else throw new Error(`Expected frames x rx x chirps x samples or frames x chirps x samples, got ${sh.join(' x ')}`);
  if (nFrames < 40) throw new Error(`At least 40 frames are needed (the STFT test uses 32 at a time); this file has ${nFrames}`);
  clip = { data, nFrames, nChirp, nSample, source };
  results.replay_data = { ...source, frames: nFrames, chirps: nChirp, samples: nSample };
  $('clipInfo').textContent = `Replay data: ${source.name}, ${nFrames} frames of ${nChirp} x ${nSample}${source.antenna !== undefined ? `, antenna ${source.antenna}` : ''}.`;
  for (const id of ['runReplay', 'runScaling', 'runThreads', 'runAllOffline']) button(id).disabled = false;
}
async function loadBundled() {
  const [npy, meta] = await Promise.all([
    fetch('./bench/clip.npy').then(r => { if (!r.ok) throw new Error(`bench/clip.npy: HTTP ${r.status}`); return r.arrayBuffer(); }),
    fetch('./bench/clip.json').then(r => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  const arr = parseNpy(npy);
  useClip(arr, { name: 'bundled clip (hand_gesture frames 0-100, antenna 1)', bytes: npy.byteLength, ...meta });
}
input('npyFile').onchange = async () => {
  const file = input('npyFile').files?.[0];
  if (!file) return;
  try { useClip(parseNpy(await file.arrayBuffer()), { name: file.name, bytes: file.size }); }
  catch (e) { $('clipInfo').textContent = `Could not use ${file.name}: ${(e as Error).message}`; }
};

// ---------- plot ----------
const canvas = $('benchPlot') as HTMLCanvasElement;
let currentPlot: InstanceType<typeof radar.viz.LiveSpectrogramPlot> | null = null;
new ResizeObserver(() => currentPlot?.redraw()).observe(canvas);   // redraw at the new size, as the demo does
function newPlot(nChirp = CONFIG.num_chirps) {
  const config = { ...CONFIG, num_chirps: nChirp };
  const plot = new radar.viz.LiveSpectrogramPlot(canvas, { historyLength: HISTORY_FRAMES, maxSpeed: -radar.dsp.velocityAxis(config)[0], jetVmin: JET_VMIN, title: 'Doppler Spectrogram (benchmark)' });
  plot.drawEmpty();
  currentPlot = plot;
  return plot;
}
const canvasSize = () => ({ css: [canvas.clientWidth, canvas.clientHeight], pixels: [canvas.width, canvas.height] });

// ---------- timing harness ----------
const settings = () => ({
  iterations: Math.max(Number(params.get('iterations')) || 0, Math.max(100, Number(input('s_iter').value) || 200)),
  warmup: Math.max(0, Number(params.get('warmup') ?? input('s_warm').value) || 0),
  seconds: Math.max(Number(params.get('seconds')) || 0, Math.max(10, Number(input('s_secs').value) || 60)),
});
// For tests (?quick=1): fewer iterations and a short stream; never in a real run.
const quick = params.get('quick') === '1';
const runSettings = () => (quick ? { iterations: 20, warmup: 2, seconds: 3 } : settings());

/**
 * Times fn(i) for warmup + iterations calls, i counting from 0. fn returns
 * nothing (the whole call is timed) or { parts } with sub-timings it took
 * itself. Yields to the page every ~40 ms so it stays responsive.
 */
async function timeIt(label: string, fn: (i: number) => void | Record<string, number>, { iterations, warmup }: { iterations: number; warmup: number }, status: (s: string) => void) {
  const times: number[] = [], parts: Record<string, number[]> = {};
  let lastYield = performance.now();
  for (let i = 0; i < warmup + iterations; i++) {
    const t0 = performance.now();
    const p = fn(i);
    const dt = performance.now() - t0;
    if (i >= warmup) {
      times.push(dt);
      if (p) for (const k of Object.keys(p)) (parts[k] ||= []).push(p[k]);
    }
    if (performance.now() - lastYield > 40) { status(`${label}: ${Math.max(0, i + 1 - warmup)} of ${iterations}`); await nextTask(); lastYield = performance.now(); }
  }
  return { times, parts };
}

// ---------- 1. replay ----------
async function runReplay(status: (s: string) => void) {
  if (!clip) throw new Error('no replay data');
  const { iterations, warmup } = runSettings();
  const { data, nFrames, nChirp, nSample } = clip;
  const per = nChirp * nSample;
  const frame = (i: number) => ({ data: data.subarray((i % nFrames) * per, (i % nFrames + 1) * per), shape: [nChirp, nSample] as [number, number] });
  const windowOf = (i: number, w: number) => { const s = i % (nFrames - w + 1); return { data: data.subarray(s * per, (s + w) * per), shape: [w, nChirp, nSample] as [number, number, number] }; };
  const W = 10, WSTFT = 32;
  const out: Record<string, unknown> = { iterations, warmup, frames_available: nFrames, frame_shape: [nChirp, nSample], window_frames: W, stft_window_frames: WSTFT, stages: {} };
  const stages = out.stages as Record<string, unknown>;
  const lines: string[] = [`Replay, ${iterations} timed iterations after ${warmup} warmup, ${nChirp} x ${nSample} frames, antenna ${clip.source.antenna ?? ANTENNA}`,
    'stage                                    mean      sd  median      p5     p95     min     max  (ms)'];
  const report = (name: string, s: Stats, per_: string) => {
    lines.push(`${name.padEnd(36)} ${[s.mean, s.sd, s.median, s.p5, s.p95, s.min, s.max].map(x => f2(x).padStart(7)).join(' ')}  ${per_}`);
    addCsv('replay', name, `${nChirp}x${nSample}`, 'main', s, per_);
  };
  const stage = async (name: string, fn: (i: number) => void | Record<string, number>, divide = 1, perLabel = 'per frame') => {
    const { times, parts } = await timeIt(name, fn, { iterations, warmup }, status);
    const t = times.map(x => x / divide);
    const s = stats(t);
    stages[name] = { per: perLabel, frames_per_call: divide, stats: s, times_ms: t.map(x => +x.toFixed(4)), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, { stats: stats(v), times_ms: v.map(x => +x.toFixed(4)) }])) };
    report(name, s, perLabel);
    for (const [k, v] of Object.entries(parts)) report(`  ${k}`, stats(v), perLabel);
    return s;
  };
  await stage('rangeFft', i => { radar.dsp.rangeFft(frame(i)); }, 1, 'per frame');
  await stage('rangeDopplerMap', i => { radar.dsp.rangeDopplerMap(frame(i)); }, 1, 'per frame');
  await stage('dopplerSpectrogram', i => { radar.dsp.dopplerSpectrogram(windowOf(i, W)); }, W, `per frame (${W}-frame windows)`);
  await stage('rangeProfile raw', i => { radar.dsp.rangeProfile(frame(i), { mode: 'raw' }); });
  await stage('rangeProfile mti', i => { radar.dsp.rangeProfile(frame(i), { mode: 'mti' }); });
  await stage('rangeMap raw', i => { radar.dsp.rangeMap(windowOf(i, W), { mode: 'raw' }); }, W, `per frame (${W}-frame windows)`);
  await stage('rangeMap mti', i => { radar.dsp.rangeMap(windowOf(i, W), { mode: 'mti' }); }, W, `per frame (${W}-frame windows)`);
  await stage('stftSpectrogram + spectrogramToDb', i => { radar.dsp.spectrogramToDb(radar.dsp.stftSpectrogram(windowOf(i, WSTFT))); }, WSTFT, `per frame (${WSTFT}-frame windows)`);
  // The demo's Live view, one frame: radar.stream.LiveSpectrogram.processFrame
  // (what its worker runs) and one LiveSpectrogramPlot.draw of the result.
  const live = new radar.stream.LiveSpectrogram({ nSample, nChirp, historyLength: HISTORY_FRAMES });
  const plot = newPlot(nChirp);
  let count = 0;
  const full = await stage('full live pipeline', i => {
    const t0 = performance.now();
    const { history } = live.processFrame(frame(i).data);
    const t1 = performance.now();
    plot.draw(history, ++count, nChirp * 4);
    const t2 = performance.now();
    return { processing: t1 - t0, rendering: t2 - t1 };
  });
  const margin = FRAME_MS / full.mean;
  out.full_pipeline = { definition: 'radar.stream.LiveSpectrogram.processFrame (the work the demo does in its worker per frame) + one LiveSpectrogramPlot.draw of the result', canvas: canvasSize() };
  out.real_time_margin = +margin.toFixed(2);
  lines.push('', `real-time margin: ${FRAME_MS} ms frame period / ${f2(full.mean)} ms full pipeline = ${margin.toFixed(1)}x ${margin > 1 ? '(keeps up)' : '(DOES NOT keep up)'}`);
  results.replay = out;
  return lines.join('\n');
}

// ---------- 2. scaling ----------
async function runScaling(status: (s: string) => void) {
  const { iterations, warmup } = runSettings();
  const sizes: [number, number][] = [[32, 64], [64, 128], [128, 256], [256, 512]];
  const N = 20;   // simulated frames per size; iterations cycle through them
  const out: Record<string, unknown> = { iterations, warmup, frames_per_size: N, sizes: [] as unknown[] };
  const lines = [`Scaling, ${iterations} timed iterations after ${warmup} warmup, simulated frames (2 targets, noise 8 counts)`,
    'size (chirps x samples)   rangeFft   rangeDopplerMap   full pipeline   (mean ms per frame)'];
  for (const [nChirp, nSample] of sizes) {
    status(`Scaling: simulating ${nChirp} x ${nSample}`);
    await nextTask();
    const config = { ...CONFIG, num_chirps: nChirp, num_samples: nSample };
    const rec = radar.simulate.frames(config, { targets: [{ range_m: 0.8, speed_m_s: -0.5 }, { range_m: 1.6 }], nFrames: N, seed: 3 });
    const per = nChirp * nSample, nRx = rec.shape[1];
    const frame = (i: number) => { const f = i % N; return { data: (rec.data as Float32Array).subarray((f * nRx + ANTENNA) * per, (f * nRx + ANTENNA + 1) * per), shape: [nChirp, nSample] as [number, number] }; };
    const row: Record<string, unknown> = { chirps: nChirp, samples: nSample };
    const size = `${nChirp}x${nSample}`;
    const one = async (name: string, fn: (i: number) => void | Record<string, number>) => {
      const { times, parts } = await timeIt(`Scaling ${size} ${name}`, fn, { iterations, warmup }, status);
      const s = stats(times);
      row[name] = { stats: s, times_ms: times.map(x => +x.toFixed(4)), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, stats(v)])) };
      addCsv('scaling', name, size, 'main', s, 'per frame');
      return s;
    };
    const a = await one('rangeFft', i => { radar.dsp.rangeFft(frame(i)); });
    const b = await one('rangeDopplerMap', i => { radar.dsp.rangeDopplerMap(frame(i)); });
    const live = new radar.stream.LiveSpectrogram({ nSample, nChirp, historyLength: HISTORY_FRAMES });
    const plot = newPlot(nChirp);
    let count = 0;
    const c = await one('full live pipeline', i => {
      const t0 = performance.now();
      const { history } = live.processFrame(frame(i).data);
      const t1 = performance.now();
      plot.draw(history, ++count, nChirp * 4);
      return { processing: t1 - t0, rendering: performance.now() - t1 };
    });
    (out.sizes as unknown[]).push(row);
    lines.push(`${size.padEnd(24)} ${f2(a.mean).padStart(9)} ${f2(b.mean).padStart(17)} ${f2(c.mean).padStart(15)}`);
  }
  results.scaling = out;
  return lines.join('\n');
}

// ---------- 3. main thread vs worker ----------
/** requestAnimationFrame intervals while `running()` is true. */
function rafMonitor() {
  const intervals: number[] = [];
  let last = 0, on = true;
  const tick = (t: number) => { if (last) intervals.push(t - last); last = t; if (on) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return { stop: () => { on = false; return intervals; } };
}
const rafSummary = (iv: number[]) => ({ stats: stats(iv), over_16_7_ms: iv.filter(x => x > 16.7).length, over_33_ms: iv.filter(x => x > 33).length, count: iv.length });

async function runThreads(status: (s: string) => void) {
  if (!clip) throw new Error('no replay data');
  const { seconds } = runSettings();
  const { data, nFrames, nChirp, nSample } = clip;
  const per = nChirp * nSample;
  const frame = (i: number) => data.subarray((i % nFrames) * per, (i % nFrames + 1) * per);
  const out: Record<string, unknown> = { seconds, rate_fps: 1000 / FRAME_MS, canvas: canvasSize(), definitions: {
    raf: 'intervals between requestAnimationFrame callbacks during the run (60 Hz display: 16.7 ms)',
    processing_ms: 'main thread: LiveSpectrogram.processFrame on the page',
    round_trip_ms: 'worker: push of a frame to radar.stream.LiveSpectrogramWorker -> its result back on the page',
    rendering_ms: 'LiveSpectrogramPlot.draw of the newest result, at the next animation frame',
  } };
  const lines = [`Main thread vs Web Worker, ${seconds} s each at 10 frames/s (frames replayed from the clip)`];
  for (const mode of ['main', 'worker'] as const) {
    const plot = newPlot(nChirp);
    const proc: number[] = [], render: number[] = [], rtt: number[] = [], pushed: number[] = [];
    let latest: Float64Array | null = null, drawn = 0, count = 0, rafPending = false;
    const draw = () => {
      rafPending = false;
      if (!latest) return;
      const h = latest; latest = null;
      const t = performance.now(); plot.draw(h, ++drawn, nChirp * 4); render.push(performance.now() - t);
    };
    const show = (h: Float64Array) => { latest = h; if (!rafPending) { rafPending = true; requestAnimationFrame(draw); } };
    const main = new radar.stream.LiveSpectrogram({ nSample, nChirp, historyLength: HISTORY_FRAMES });
    const worker = mode === 'worker' ? new radar.stream.LiveSpectrogramWorker(({ history }: { history: Float64Array }) => {
      const t = performance.now(); rtt.push(t - pushed[count]); count++; show(history);
    }) : null;
    if (worker) { worker.reset({ nSample, nChirp, historyLength: HISTORY_FRAMES }); await sleep(300); }
    const mon = rafMonitor();
    const t0 = performance.now();
    let i = 0;
    while (performance.now() - t0 < seconds * 1000) {
      const due = t0 + i * FRAME_MS;
      const wait = due - performance.now();
      if (wait > 0) await sleep(wait);
      if (mode === 'main') { const t = performance.now(); const { history } = main.processFrame(frame(i)); proc.push(performance.now() - t); show(history); }
      else { pushed.push(performance.now()); worker!.push(frame(i)); }
      i++;
      if (i % 10 === 0) status(`${mode === 'main' ? 'Main thread' : 'Web Worker'}: ${(i / 10).toFixed(0)} of ${seconds} s`);
    }
    await sleep(300);
    const iv = mon.stop();
    worker?.worker.terminate();
    const r = { frames_sent: i, frames_processed: mode === 'main' ? proc.length : rtt.length, raf: rafSummary(iv), processing_ms: mode === 'main' ? stats(proc) : null, round_trip_ms: mode === 'worker' ? stats(rtt) : null, rendering_ms: stats(render), draws: render.length,
      raw: { raf_intervals_ms: iv.map(x => +x.toFixed(3)), processing_ms: proc.map(x => +x.toFixed(4)), round_trip_ms: rtt.map(x => +x.toFixed(4)), rendering_ms: render.map(x => +x.toFixed(4)) } };
    out[mode] = r;
    addCsv('threads', 'raf interval', `${nChirp}x${nSample}`, mode, r.raf.stats, 'interval');
    if (r.processing_ms) addCsv('threads', 'processing', `${nChirp}x${nSample}`, mode, r.processing_ms, 'per frame');
    if (r.round_trip_ms) addCsv('threads', 'worker round trip', `${nChirp}x${nSample}`, mode, r.round_trip_ms, 'per frame');
    addCsv('threads', 'rendering', `${nChirp}x${nSample}`, mode, r.rendering_ms, 'per draw');
    lines.push(`${mode === 'main' ? 'main thread' : 'Web Worker '}: ${r.frames_processed}/${i} frames; rAF median ${f2(r.raf.stats.median)} ms, ${r.raf.over_16_7_ms} of ${r.raf.count} over 16.7 ms, ${r.raf.over_33_ms} over 33 ms; ` +
      (mode === 'main' ? `processing mean ${f2(r.processing_ms!.mean)} ms` : `round trip mean ${f2(r.round_trip_ms!.mean)} ms (p95 ${f2(r.round_trip_ms!.p95)})`) + `; rendering mean ${f2(r.rendering_ms.mean)} ms`);
  }
  results.threads = out;
  return lines.join('\n');
}

// ---------- 4. live ----------
const pageEvents: { t_ms: number; event: string; visibility: string; focus: boolean }[] = [];
const pageEvent = (event: string, focus = document.hasFocus()) => pageEvents.push({ t_ms: +performance.now().toFixed(1), event, visibility: document.visibilityState, focus });
pageEvent('page_load');
document.addEventListener('visibilitychange', () => pageEvent('visibilitychange'));
window.addEventListener('focus', () => pageEvent('focus', true));
window.addEventListener('blur', () => pageEvent('blur', false));
let liveFrame: ((cube: Float32Array, meta: FrameMeta) => void) | null = null;

if (!radar.hasWebSerial()) { $('noSerial').hidden = false; button('connectBtn').disabled = true; }
radar.onState(({ message }: { message?: string }) => {
  $('liveConn').textContent = message ?? (radar.isConnected() ? 'Connected.' : 'Not connected.');
  button('connectBtn').textContent = radar.isConnected() ? 'Disconnect' : 'Connect';
  button('runLive').disabled = !radar.isConnected() || liveRunning;
});
button('connectBtn').onclick = async () => {
  button('connectBtn').disabled = true;
  try { if (radar.isConnected()) await radar.disconnect(); else await radar.connect(); }
  finally { button('connectBtn').disabled = false; }
};
radar.onFrame((cube: Float32Array, meta: FrameMeta) => { if (liveFrame) liveFrame(cube, meta); });

type LiveMode = { name: string; thread: 'main' | 'worker'; plot: boolean };
const LIVE_MODES: LiveMode[] = [
  { name: 'main thread, plot on', thread: 'main', plot: true },
  { name: 'main thread, plot off', thread: 'main', plot: false },
  { name: 'Web Worker, plot on', thread: 'worker', plot: true },
  { name: 'Web Worker, plot off', thread: 'worker', plot: false },
];
let liveRunning = false;

async function runLiveMode(mode: LiveMode, seconds: number, status: (s: string) => void) {
  const nChirp = CONFIG.num_chirps, nSample = CONFIG.num_samples, per = nChirp * nSample;
  const plot = mode.plot ? newPlot(nChirp) : null;
  type Row = { i: number; counter: number | null; fw_us: number | null; arrival_ms: number; processing_ms: number | null; rendering_ms: number | null; output_ms: number | null };
  const rows: Row[] = [];
  const statsAtStart = radar.stats();
  const main = new radar.stream.LiveSpectrogram({ nSample, nChirp, historyLength: HISTORY_FRAMES });
  const finish = (row: Row, history: Float64Array) => {
    if (plot) { const t = performance.now(); plot.draw(history, row.i + 1, nChirp * 4); row.rendering_ms = performance.now() - t; }
    row.output_ms = performance.now();
  };
  const worker = mode.thread === 'worker' ? new radar.bench.TimedSpectrogramWorker(r => {
    const row = rows[r.id]; if (!row) return;
    row.processing_ms = r.procMs;
    finish(row, r.history);
  }) : null;
  if (worker) { worker.reset({ nSample, nChirp, historyLength: HISTORY_FRAMES }); await sleep(300); }
  const t0 = performance.now();
  liveFrame = (cube, meta) => {
    const arrival = performance.now();
    const a1 = cube.subarray(ANTENNA * per, (ANTENNA + 1) * per);
    const row: Row = { i: rows.length, counter: meta.counter, fw_us: meta.timestamp, arrival_ms: arrival, processing_ms: null, rendering_ms: null, output_ms: null };
    rows.push(row);
    if (worker) worker.push(a1, row.i);
    else { const t = performance.now(); const { history } = main.processFrame(a1); row.processing_ms = performance.now() - t; finish(row, history); }
  };
  while (performance.now() - t0 < seconds * 1000) {
    await sleep(500);
    status(`Live, ${mode.name}: ${((performance.now() - t0) / 1000).toFixed(0)} of ${seconds} s, ${rows.length} frames${document.hasFocus() ? '' : ' (Chrome is not in front: click back into this window)'}`);
  }
  liveFrame = null;
  const tEnd = performance.now();
  await sleep(1500);                                  // results still in flight (worker)
  worker?.terminate();
  const statsAtEnd = radar.stats();
  // board clock: frames expected over the run, realignment gaps
  const fw = rows.filter(r => r.fw_us !== null);
  const steps: number[] = [], gaps: { after_frame: number; board_gap_ms: number }[] = [];
  for (let k = 1; k < fw.length; k++) { const g = ((fw[k].fw_us as number) - (fw[k - 1].fw_us as number)) / 1000; if (g > 115) gaps.push({ after_frame: fw[k - 1].i, board_gap_ms: +g.toFixed(1) }); else steps.push(g); }
  const period = steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : FRAME_MS;
  const expected = fw.length > 1 ? Math.round(((fw[fw.length - 1].fw_us as number) - (fw[0].fw_us as number)) / 1000 / period) + 1 : rows.length;
  // delays over time. delivery: arrival behind the board's own clock (grows
  // when frames queue up before the page gets them, e.g. a busy main thread);
  // output: arrival -> output ready; total: board clock -> output ready.
  const done = rows.filter(r => r.output_ms !== null);
  const base = fw.length ? { arr: fw[0].arrival_ms, fw: fw[0].fw_us as number } : null;
  const ts = done.map(r => (r.arrival_ms - t0) / 1000);
  const outputLat = done.map(r => (r.output_ms as number) - r.arrival_ms);
  const delivery = base ? done.filter(r => r.fw_us !== null).map(r => r.arrival_ms - base.arr - ((r.fw_us as number) - base.fw) / 1000) : [];
  const deliveryT = base ? done.filter(r => r.fw_us !== null).map(r => (r.arrival_ms - t0) / 1000) : [];
  const total = base ? done.filter(r => r.fw_us !== null).map(r => (r.output_ms as number) - base.arr - ((r.fw_us as number) - base.fw) / 1000) : [];
  const totalSlope = slope(deliveryT, total), outSlope = slope(ts, outputLat), delSlope = slope(deliveryT, delivery);
  const firstLast = (t: number[], y: number[]) => { const a = y.filter((_, k) => t[k] < 10), b = y.filter((_, k) => t[k] > seconds - 10); return { first_10s_median: stats(a).median, last_10s_median: stats(b).median }; };
  const proc = rows.map(r => r.processing_ms).filter((x): x is number => x !== null);
  const rend = rows.map(r => r.rendering_ms).filter((x): x is number => x !== null);
  const processedFrac = rows.length ? done.length / rows.length : 0;
  const deliveredFrac = expected ? rows.length / expected : 0;
  const growing = totalSlope > 1;   // ms of extra delay per second of running
  const realTime = !growing && processedFrac >= 0.99 && stats(outputLat).p95 < FRAME_MS * 2;
  const r = {
    mode, seconds, frames_delivered: rows.length, frames_expected_board_clock: expected, frames_processed: done.length,
    board_period_ms: +period.toFixed(4), realignment_gaps: gaps,
    drops: statsAtEnd.drops - statsAtStart.drops, restarts: statsAtEnd.restarts - statsAtStart.restarts,
    loss_diagnostics_at_start: statsAtStart.diagnostics, loss_diagnostics_at_end: statsAtEnd.diagnostics,
    serial_buffer_size: statsAtEnd.serialBufferSize ?? null,
    processing_ms: stats(proc), rendering_ms: plot ? stats(rend) : null,
    arrival_to_output_ms: { ...stats(outputLat), slope_ms_per_s: +outSlope.toFixed(4), ...firstLast(ts, outputLat) },
    delivery_delay_ms: { ...stats(delivery), slope_ms_per_s: +delSlope.toFixed(4), ...firstLast(deliveryT, delivery) },
    board_to_output_ms: { ...stats(total), slope_ms_per_s: +totalSlope.toFixed(4), ...firstLast(deliveryT, total) },
    backlog_growing: growing, sustained_real_time: realTime,
    page_events: pageEvents.filter(e => e.t_ms >= t0 && e.t_ms <= tEnd),
    raw: rows.map(x => ({ ...x, arrival_ms: +x.arrival_ms.toFixed(2), output_ms: x.output_ms === null ? null : +x.output_ms.toFixed(2), processing_ms: x.processing_ms === null ? null : +x.processing_ms.toFixed(4), rendering_ms: x.rendering_ms === null ? null : +x.rendering_ms.toFixed(4) })),
  };
  addCsv('live', 'processing', '128x256', mode.name, r.processing_ms, 'per frame');
  if (r.rendering_ms) addCsv('live', 'rendering', '128x256', mode.name, r.rendering_ms, 'per frame');
  addCsv('live', 'arrival to output', '128x256', mode.name, stats(outputLat), 'per frame');
  return r;
}

async function runLive(status: (s: string) => void) {
  const { seconds } = runSettings();
  const out: Record<string, unknown> = { seconds_per_mode: seconds, antenna: ANTENNA, canvas: canvasSize(), definitions: {
    processing_ms: 'main thread: LiveSpectrogram.processFrame on the page; worker: the same inside radar.bench.TimedSpectrogramWorker (in-worker time)',
    rendering_ms: 'LiveSpectrogramPlot.draw of that frame\'s result, right after it is ready',
    arrival_to_output_ms: 'radar.onFrame delivery -> result ready (plot off) or drawn (plot on)',
    delivery_delay_ms: 'arrival time minus the board\'s own timestamp (both from the first frame): grows when frames queue before the page receives them',
    board_to_output_ms: 'delivery delay plus arrival to output: the whole delay behind the sensor',
    backlog_growing: 'board_to_output slope over 1 ms per second of running',
    sustained_real_time: 'no growing backlog, at least 99% of delivered frames processed, and arrival-to-output p95 under 200 ms',
  }, modes: [] as unknown[] };
  const lines = [`Live, ${seconds} s per mode, antenna ${ANTENNA}`,
    'mode                     frames (deliv/expect)  processing  rendering  arrival->output  delay slope  real time'];
  if (!radar.isStreaming()) { await radar.start(); await sleep(2000); }
  for (const mode of LIVE_MODES) {
    status(`Live, ${mode.name}: starting`);
    const r = await runLiveMode(mode, seconds, status);
    (out.modes as unknown[]).push(r);
    lines.push(`${mode.name.padEnd(24)} ${`${r.frames_delivered}/${r.frames_expected_board_clock}`.padStart(13)} ${f2(r.processing_ms.mean).padStart(11)} ${r.rendering_ms ? f2(r.rendering_ms.mean).padStart(10) : '         –'} ${f2(r.arrival_to_output_ms.mean).padStart(16)} ${(f2(r.board_to_output_ms.slope_ms_per_s) + ' ms/s').padStart(12)}  ${r.sustained_real_time ? 'yes' : 'NO'}${r.backlog_growing ? ' (backlog grows)' : ''}${r.drops ? `, ${r.drops} drops` : ''}`);
  }
  await radar.stop();
  results.live = out;
  return lines.join('\n');
}

// ---------- buttons ----------
let busy = false;
function setBusy(b: boolean) {
  busy = b;
  for (const id of ['runReplay', 'runScaling', 'runThreads', 'runAllOffline']) button(id).disabled = b || !clip;
  button('runLive').disabled = b || !radar.isConnected();
  button('download').disabled = b || !(results.replay || results.scaling || results.threads || results.live);
}
async function offline(which: ('replay' | 'scaling' | 'threads')[]) {
  if (busy) return;
  setBusy(true);
  const st = (s: string) => { $('offlineStatus').textContent = s; };
  const box = $('offlineResult'); box.hidden = false;
  const texts: string[] = [];
  try {
    await systemInfo();
    for (const w of which) {
      texts.push(w === 'replay' ? await runReplay(st) : w === 'scaling' ? await runScaling(st) : await runThreads(st));
      box.textContent = texts.join('\n\n');
    }
    st('Done.');
  } catch (e) { st(`Stopped: ${(e as Error).message}`); showError((e as Error).stack || String(e)); }
  finally { setBusy(false); (window as unknown as { __benchDone: boolean }).__benchDone = true; }
}
button('runReplay').onclick = () => offline(['replay']);
button('runScaling').onclick = () => offline(['scaling']);
button('runThreads').onclick = () => offline(['threads']);
button('runAllOffline').onclick = () => offline(['replay', 'scaling', 'threads']);
button('runLive').onclick = async () => {
  if (busy || !radar.isConnected()) return;
  if (!confirm('The live benchmark runs four modes, about ' + Math.ceil(4 * runSettings().seconds / 60 + 0.5) + ' minutes. Keep Chrome in front, and do not touch the board or the computer until it finishes. Start?')) return;
  setBusy(true); liveRunning = true;
  const st = (s: string) => { $('liveStatus').textContent = s; };
  const box = $('liveResult'); box.hidden = false;
  try { await systemInfo(); box.textContent = await runLive(st); st('Done.'); }
  catch (e) { st(`Stopped: ${(e as Error).message}`); showError((e as Error).stack || String(e)); }
  finally { liveRunning = false; setBusy(false); }
};

button('download').onclick = async () => {
  const info = await systemInfo();
  results.finished_at = new Date().toISOString();
  results.settings = runSettings();
  const label = (info.machine_label || 'machine').replace(/[^A-Za-z0-9_.-]+/g, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = `radarjs-bench_${label}_${stamp}`;
  radar.data.download(new Blob([JSON.stringify(results, null, 1)], { type: 'application/json' }), `${name}.json`);
  await sleep(400);
  const sys = [info.machine_label, info.cpu_model, info.browser_version, info.os].map(x => String(x ?? '').replace(/,/g, ' '));
  const csv = [['machine_label', 'cpu_model', 'chrome', 'os', ...csvRows[0]].join(','), ...csvRows.slice(1).map(r => [...sys, ...r.map(x => String(x).replace(/,/g, ' '))].join(','))].join('\n') + '\n';
  radar.data.download(new Blob([csv], { type: 'text/csv' }), `${name}.csv`);
  $('saveStatus').textContent = `Saved ${name}.json and ${name}.csv to your Downloads folder.`;
};

// For automated checks (Playwright): the results object.
(window as unknown as { __benchResults: Record<string, unknown> }).__benchResults = results;

// ---------- start ----------
systemInfo().catch(e => showError(`System info: ${(e as Error).message}`));
newPlot();
loadBundled()
  .then(() => { const a = params.get('autorun'); if (a) offline(a.split(',') as ('replay' | 'scaling' | 'threads')[]); })
  .catch(e => { $('clipInfo').textContent = `The bundled clip did not load (${(e as Error).message}). Choose a capture .npy instead.`; });
