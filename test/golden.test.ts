// Every radar.dsp function (and radar.stream.LiveSpectrogram) against
// SensDSv2's own output, saved by tools/make_golden.py in test/golden/.
//
// Tolerances (stated once, used throughout):
//   EXACT   integer results (range bins) and the float32 dB image: equal
//   COEF    windows, filter coefficients, axes: |diff| <= 1e-12
//   REL     anything after an FFT: max |diff| <= 1e-9 x max |expected|
//           (our FFT sums in a different order than numpy's pocketfft)
//   DB      dB values: |diff| <= 1e-8 dB
// The measured worst case of every check is printed at the end.

import { test, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

import radar from '../src/index.ts';
import { parseNpy } from '../src/data/npy.js';

const GOLDEN = new URL('./golden/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', GOLDEN), 'utf8'));
const TOL = { COEF: 1e-12, REL: 1e-9, DB: 1e-8 };
const report: string[] = [];

type Arr = { data: ArrayLike<number>; shape: number[] };
const load = (dir: string, name: string): Arr => {
  const b = readFileSync(new URL(`${dir}/${name}.npy`, GOLDEN));
  return parseNpy(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const flat = (x: ArrayLike<number> | ArrayLike<number>[]): number[] =>
  Array.isArray(x) && typeof x[0] === 'object' ? (x as ArrayLike<number>[]).flatMap(r => Array.from(r)) : Array.from(x as ArrayLike<number>);
const shapeOf = (x: unknown): number[] => (Array.isArray(x) ? [x.length, ...shapeOf(x[0])] : []);
// The first `cols` columns of a [rows][n] nested array
const firstCols = (m: number[][], cols: number) => m.map(r => r.slice(0, cols));

function compare(label: string, actual: ArrayLike<number> | ArrayLike<number>[], expected: Arr, kind: 'EXACT' | 'COEF' | 'REL' | 'DB') {
  if (Array.isArray(actual)) assert.deepEqual(shapeOf(actual), expected.shape, `${label}: shape`);
  const a = flat(actual), e = Array.from(expected.data);
  assert.equal(a.length, e.length, `${label}: length`);
  let maxDiff = 0, peak = 0;
  for (let i = 0; i < e.length; i++) { maxDiff = Math.max(maxDiff, Math.abs(a[i] - e[i])); peak = Math.max(peak, Math.abs(e[i])); }
  const measured = kind === 'REL' ? maxDiff / (peak || 1) : maxDiff;
  const limit = kind === 'EXACT' ? 0 : TOL[kind];
  report.push(`${measured <= limit ? 'pass' : 'FAIL'}  ${label.padEnd(58)} ${kind.padEnd(5)} ${measured.toExponential(2)} (limit ${limit})`);
  assert.ok(measured <= limit, `${label}: ${kind} error ${measured} > ${limit}`);
}

const config = radar.config.SENSDS_CONFIG;

test('the golden data was made with the configuration radar.js uses', () => {
  for (const [k, v] of Object.entries(manifest.config)) assert.equal((config as Record<string, unknown>)[k], v, k);
});

// Live golden data (tools/make_golden.py --input): frames of live radar-js
// recordings, stages for antennas 0 and 1 in live/<name>/rx<k>/. The .npy
// files are not committed (over 50 MB); each folder's manifest.json is, with
// the SHA-256 of every file. Without the files these checks are skipped.
const LIVE = new URL('live/', GOLDEN);
const liveNames = existsSync(LIVE) ? readdirSync(LIVE).filter(n => existsSync(new URL(`${n}/manifest.json`, LIVE))).sort() : [];
const liveManifest = (name: string) => JSON.parse(readFileSync(new URL(`${name}/manifest.json`, LIVE), 'utf8'));
const liveHere = (name: string) => existsSync(new URL(`${name}/input.npy`, LIVE));
const sha256 = (url: URL) => createHash('sha256').update(readFileSync(url)).digest('hex');

type Suite = { input: string; inputDir: string; antenna: number };
const suites: Suite[] = [
  { input: 'real', inputDir: 'real', antenna: 0 },
  { input: 'synthetic', inputDir: 'synthetic', antenna: 0 },
];
for (const name of liveNames) {
  const m = liveManifest(name);
  test(`live/${name}: made with the configuration radar.js uses, from SensDSv2 ${m.sensds_commit.slice(0, 7)}`, () => {
    for (const [k, v] of Object.entries(m.config)) assert.equal((config as Record<string, unknown>)[k], v, k);
  });
  if (!liveHere(name)) {
    test.skip(`live/${name}: golden files not here (not committed; tools/make_golden.py --input makes them)`, () => {});
    report.push(`skip  live/${name}: golden .npy files not present`);
    continue;
  }
  test(`live/${name}: files match the SHA-256 in its manifest`, () => {
    assert.equal(sha256(new URL(`${name}/input.npy`, LIVE)), m.input_file.sha256, 'input.npy');
    for (const [rx, entry] of Object.entries(m.inputs) as [string, { files: Record<string, { sha256: string }> }][])
      for (const [f, info] of Object.entries(entry.files)) assert.equal(sha256(new URL(`${name}/${rx}/${f}.npy`, LIVE)), info.sha256, `${rx}/${f}`);
  });
  for (const k of m.antennas as number[]) suites.push({ input: `live/${name}/rx${k}`, inputDir: `live/${name}`, antenna: k });
}

for (const { input, inputDir, antenna } of suites) {
  const data = load(inputDir, 'input');
  const recording = { data: data.data, shape: data.shape as [number, number, number, number] };
  const nFrame = data.shape[0], nRx = data.shape[1];
  // one frame of the suite's antenna (antenna 0 for real/ and synthetic/)
  const antenna0 = (i: number) => ({ data: (data.data as Float32Array).subarray((i * nRx + antenna) * 128 * 256, (i * nRx + antenna + 1) * 128 * 256), shape: [128, 256] as [number, number] });

  // ---------- Doppler spectrogram ----------
  test(`${input}: windows`, () => {
    compare(`${input} blackmanharris(256)`, radar.dsp.blackmanharris(256), load(input, 'doppler/range_window'), 'COEF');
    const cw = radar.dsp.chebwin(128, 100), s = cw.reduce((a, b) => a + b, 0);
    compare(`${input} chebwin(128, 100) / sum`, cw.map(v => v / s), load(input, 'doppler/doppler_window'), 'COEF');
  });

  test(`${input}: rangeFft (frame 0)`, () => {
    const { re, im } = radar.dsp.rangeFft(antenna0(0));
    compare(`${input} rangeFft re`, re, load(input, 'doppler/range_fft_f0_re'), 'REL');
    compare(`${input} rangeFft im`, im, load(input, 'doppler/range_fft_f0_im'), 'REL');
  });

  test(`${input}: rangeDopplerMap (frame 0)`, () => {
    compare(`${input} rangeDopplerMap`, radar.dsp.rangeDopplerMap(antenna0(0)), load(input, 'doppler/rdm_db_f0'), 'DB');
  });

  test(`${input}: selectRangeBin per frame`, () => {
    const bins = Array.from({ length: nFrame }, (_, i) => radar.dsp.selectRangeBin(radar.dsp.rangeDopplerMap(antenna0(i))));
    compare(`${input} selectRangeBin`, bins, load(input, 'doppler/raw_bins'), 'EXACT');
  });

  test(`${input}: smoothRangeBins`, () => {
    compare(`${input} smoothRangeBins`, radar.dsp.smoothRangeBins(load(input, 'doppler/raw_bins').data, 512), load(input, 'doppler/range_bins'), 'EXACT');
  });

  test(`${input}: dopplerSpectrogram`, () => {
    const { spectrogram, rangeBins } = radar.dsp.dopplerSpectrogram(recording, { antenna });
    compare(`${input} dopplerSpectrogram`, spectrogram, load(input, 'doppler/spectrogram'), 'DB');
    compare(`${input} dopplerSpectrogram rangeBins`, rangeBins, load(input, 'doppler/range_bins'), 'EXACT');
  });

  test(`${input}: stream.LiveSpectrogram`, () => {
    const live = new radar.stream.LiveSpectrogram({ nSample: 256, nChirp: 128, historyLength: 10 });
    let last: { history: Float64Array; rangeBin: number } | undefined;
    const bins: number[] = [];
    for (let i = 0; i < nFrame; i++) { last = live.processFrame(antenna0(i).data); bins.push(last!.rangeBin); }
    compare(`${input} LiveSpectrogram history`, last!.history, load(input, 'doppler/live_history'), 'DB');
    compare(`${input} LiveSpectrogram range bins`, bins, load(input, 'doppler/live_bins'), 'EXACT');
  });

  // ---------- STFT spectrogram ----------
  test(`${input}: MTI filter coefficients`, () => {
    const { b, a } = radar.dsp.butter(1, 0.01, 'high');
    compare(`${input} butter(1, 0.01, 'high') b`, b, load(input, 'stft/mti_b'), 'COEF');
    compare(`${input} butter(1, 0.01, 'high') a`, a, load(input, 'stft/mti_a'), 'COEF');
  });

  test(`${input}: mtiHighpass (first 128 slow-time columns of every range row)`, () => {
    const cre = load(input, 'stft/clutter_removed_re'), cim = load(input, 'stft/clutter_removed_im');
    const [rows, cols] = cre.shape;
    const re: number[][] = [], im: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const out = radar.dsp.mtiHighpass({ re: Array.from(cre.data).slice(r * cols, (r + 1) * cols), im: Array.from(cim.data).slice(r * cols, (r + 1) * cols) });
      re.push(out.re); im.push(out.im);
    }
    compare(`${input} mtiHighpass re`, re, load(input, 'stft/mti_re'), 'REL');
    compare(`${input} mtiHighpass im`, im, load(input, 'stft/mti_im'), 'REL');
  });

  for (const mti of [true, false]) {
    const tag = mti ? 'mti' : 'raw';
    test(`${input}: slowTimeSignal (${tag})`, () => {
      const { re, im } = radar.dsp.slowTimeSignal(recording, { mti, antenna });
      compare(`${input} slowTimeSignal ${tag} re`, re, load(input, `stft/slow_time_${tag}_re`), 'REL');
      compare(`${input} slowTimeSignal ${tag} im`, im, load(input, `stft/slow_time_${tag}_im`), 'REL');
    });
    test(`${input}: stftSpectrogram (${tag})`, () => {
      compare(`${input} stftSpectrogram ${tag}`, radar.dsp.stftSpectrogram(recording, { mti, antenna }), load(input, `stft/spect_${tag}`), 'REL');
    });
  }

  test(`${input}: stft of the golden slow-time signal`, () => {
    const sig = { re: load(input, 'stft/slow_time_mti_re').data, im: load(input, 'stft/slow_time_mti_im').data };
    const { re, im } = radar.dsp.stft(sig);
    compare(`${input} stft re`, re, load(input, 'stft/stft_mti_re'), 'REL');
    compare(`${input} stft im`, im, load(input, 'stft/stft_mti_im'), 'REL');
  });

  test(`${input}: spectrogramToDb`, () => {
    const spect = load(input, 'stft/spect_mti');
    compare(`${input} spectrogramToDb (golden spectrogram in)`, radar.dsp.spectrogramToDb({ data: spect.data, shape: spect.shape as [number, number] }), load(input, 'stft/db_mti'), 'EXACT');
    compare(`${input} spectrogramToDb(stftSpectrogram) end to end`, radar.dsp.spectrogramToDb(radar.dsp.stftSpectrogram(recording, { antenna })), load(input, 'stft/db_mti'), 'EXACT');
  });

  // ---------- Range map ----------
  test(`${input}: rangeAxis`, () => {
    compare(`${input} rangeAxis(config)`, radar.dsp.rangeAxis(config), load(input, 'range/range_axis_m'), 'COEF');
  });

  for (const mode of ['raw', 'mti'] as const) {
    test(`${input}: rangeProfile and rangeMap (${mode})`, () => {
      compare(`${input} rangeProfile ${mode} (frame 0)`, radar.dsp.rangeProfile(antenna0(0), { mode }), load(input, `range/profile_${mode}_f0`), 'DB');
      compare(`${input} rangeMap ${mode}`, radar.dsp.rangeMap(recording, { mode, antenna }), load(input, `range/map_${mode}`), 'DB');
    });
  }
}

// The intermediate STFT stages (range FFT of length 2N, clutter removal) are
// inside slowTimeSignal, which has no separate public function for them; they
// are checked through mtiHighpass (clutter_removed in, mti out) and
// slowTimeSignal (the sum of the filtered rows).

afterAll(() => {
  console.log(`\nGolden comparison (${report.length} checks, worst case per check):\n` + report.join('\n'));
});
