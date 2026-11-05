// Step 5 sanity checks on the live captures, with radar.js's own radar.dsp
// (which test/golden.test.ts holds to SensDSv2's output), on antenna 1
// (antenna 0 clips about 18% of its samples on this board).
//
//   node tools/sanity_checks.ts [--out test/captures/step5_sanity.json]
//
// static_target  range of the strongest raw range-profile bin past 0.25 m
//                (the transmit leakage ends there), averaged over frames, and
//                the per-frame strongest bin's spread; expected near 1.0 m
// hand_gesture,  dominant velocity range from radar.dsp.dopplerSpectrogram
// walking,       (per-frame Doppler peak, |v| >= 0.15 m/s, at least 20 dB
// mixed          over the spectrogram's median), and the sign check: the
//                Doppler velocity against the rate of change of the range
//                bin the spectrogram tracks. "Toward is negative" holds if
//                velocity and d(range)/dt have the same sign: negative while
//                the target comes closer.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import radar from '../src/index.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const CAPS = join(ROOT, 'test', 'captures');
const ANTENNA = 1;
const STATIC_MIN_M = 0.25;
const STILL_MPS = 0.15;
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : join(CAPS, 'step5_sanity.json');

const load = async (name: string) => {
  const meta = JSON.parse(readFileSync(join(CAPS, `${name}.timing.json`), 'utf8'));
  const rec = await radar.data.loadNpy(readFileSync(join(CAPS, `${name}.npy`)));
  return { meta, rec };
};
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * p / 100; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const r3 = (x: number) => +x.toFixed(3);
const results: Record<string, unknown> = { antenna: ANTENNA, radar_js: radar.capture.BUILD, written_at: new Date().toISOString() };

// static_target: raw range profile
{
  const { meta, rec } = await load('static_target');
  const [nF, , nC, nS] = rec.shape as [number, number, number, number];
  const rng = radar.dsp.rangeAxis(meta.config);
  const start = rng.findIndex(m => m >= STATIC_MIN_M);
  const per = nC * nS, stride = 3 * per;
  const sum = new Float64Array(rng.length), peaks: number[] = [];
  for (let f = 0; f < nF; f++) {
    const frame = { data: rec.data.subarray(f * stride + ANTENNA * per, f * stride + (ANTENNA + 1) * per), shape: [nC, nS] as [number, number] };
    const p = radar.dsp.rangeProfile(frame, { mode: 'raw' });
    let k = start;
    for (let i = start; i < p.length; i++) { sum[i] += 10 ** (p[i] / 20); if (p[i] > p[k]) k = i; }
    peaks.push(rng[k]);
  }
  const mean = Array.from(sum, x => 20 * Math.log10(x / nF));
  let k = start; for (let i = start; i < mean.length; i++) if (mean[i] > mean[k]) k = i;
  const median = pct(mean.slice(start), 50);
  results.static_target = {
    measured_distance_m: 1.0, bin_spacing_m: +(rng[1] - rng[0]).toFixed(5),
    strongest_bin: k, strongest_range_m: r3(rng[k]), level_db: r3(mean[k]), above_median_db: r3(mean[k] - median),
    offset_m: r3(rng[k] - 1.0), offset_bins: +((rng[k] - 1.0) / (rng[1] - rng[0])).toFixed(1),
    per_frame_strongest_m: { p5: r3(pct(peaks, 5)), median: r3(pct(peaks, 50)), p95: r3(pct(peaks, 95)) },
    frames: nF,
  };
  console.log('static_target', results.static_target);
}

// motion captures: velocity range and sign
for (const name of ['hand_gesture', 'walking', 'mixed']) {
  const { meta, rec } = await load(name);
  const { spectrogram, rangeBins } = radar.dsp.dopplerSpectrogram(rec, { antenna: ANTENNA });
  const v = radar.dsp.velocityAxis(meta.config, { dopplerFftSize: spectrogram[0].length });
  const rng = radar.dsp.rangeAxis(meta.config);
  const dt = meta.config.frame_repetition_time_s;
  const all = spectrogram.flatMap((row, i) => (i % 10 ? [] : row));
  const floor = pct(all, 50);
  const peakV: (number | null)[] = spectrogram.map(row => {
    let k = -1;
    for (let j = 0; j < row.length; j++) if (Math.abs(v[j]) >= STILL_MPS && (k < 0 || row[j] > row[k])) k = j;
    return row[k] > floor + 20 ? v[k] : null;
  });
  const active = peakV.filter((x): x is number => x !== null);
  // sign check: velocity against d(range)/dt of the tracked bin (central difference over 2 frames)
  const R = rangeBins.map(b => rng[b]);
  let same = 0, opposite = 0;
  const pv: number[] = [], pd: number[] = [];
  for (let i = 2; i < R.length - 2; i++) {
    const d = (R[i + 2] - R[i - 2]) / (4 * dt);
    const x = peakV[i];
    if (x === null || Math.abs(d) < 0.1 || Math.abs(d) > 3) continue;   // still, or a jump between targets
    pv.push(x); pd.push(d);
    if (Math.sign(x) === Math.sign(d)) same++; else opposite++;
  }
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const mv = mean(pv), md = mean(pd);
  const corr = pv.reduce((s, x, i) => s + (x - mv) * (pd[i] - md), 0) /
    Math.sqrt(pv.reduce((s, x) => s + (x - mv) ** 2, 0) * pd.reduce((s, x) => s + (x - md) ** 2, 0));
  const res = {
    frames: spectrogram.length, active_frames: active.length,
    velocity_m_s: { p5: r3(pct(active, 5)), p50: r3(pct(active, 50)), p95: r3(pct(active, 95)), min: r3(Math.min(...active)), max: r3(Math.max(...active)) },
    speed_m_s: { p50: r3(pct(active.map(Math.abs), 50)), p95: r3(pct(active.map(Math.abs), 95)) },
    toward_frames_pct: r3(100 * active.filter(x => x < 0).length / active.length),
    tracked_range_m: { p5: r3(pct(R, 5)), p50: r3(pct(R, 50)), p95: r3(pct(R, 95)) },
    sign_check: { frames_used: pv.length, same_sign: same, opposite_sign: opposite, same_sign_pct: r3(100 * same / (same + opposite)), correlation: r3(corr),
      verdict: same > opposite ? 'negative velocity while the range shrinks: toward is negative' : 'sign does NOT match the convention' },
  };
  results[name] = res;
  console.log(name, JSON.stringify(res));
}

writeFileSync(out, JSON.stringify(results, null, 1));
console.log(`written ${out}`);
