// The STFT spectrogram method against SensDSv2 core/processing.py, run
// unchanged on the 20 real radar frames (tools/make_stft_fixtures.py).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNpy, framesFromNpy } from '../src/data/npy.js';
import { hanning } from '../src/dsp/hanning.ts';
import { butter } from '../src/dsp/butter.ts';
import { lfilter } from '../src/dsp/lfilter.ts';
import { mtiHighpass, MTI_FILTER } from '../src/dsp/mti_highpass.ts';
import { slowTimeSignal } from '../src/dsp/slow_time.ts';
import { stft, STFT_DEFAULTS } from '../src/dsp/stft.ts';
import { stftSpectrogram } from '../src/dsp/stft_spectrogram.ts';
import { spectrogramToDb, STFT_DB_RANGE } from '../src/dsp/spectrogram_to_db.ts';

const FIX = new URL('./fixtures/stft/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('meta.json', FIX)));
const bin = readFileSync(new URL('arrays.f64', FIX));
const arr = name => { const { shape, offset } = meta.arrays[name]; const n = shape.reduce((a, b) => a * b, 1); return new Float64Array(bin.buffer.slice(bin.byteOffset + offset, bin.byteOffset + offset + n * 8)); };
const npy = readFileSync(new URL('./fixtures/radar/python_frames.npy', import.meta.url));
const rec = framesFromNpy(parseNpy(npy.buffer.slice(npy.byteOffset, npy.byteOffset + npy.byteLength)));
const frames = Array.from({ length: rec.nFrame }, (_, i) => rec.antenna0(i));
const maxDiff = (a, b) => { assert.equal(a.length, b.length); let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const maxAbs = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
// max |diff| relative to the largest reference value
const relDiff = (a, b) => maxDiff(a, b) / maxAbs(b);

test('parameters are SensDSv2\'s', () => {
  const c = meta.constants;
  assert.deepEqual(STFT_DEFAULTS, { nfft: c.STFT_NFFT, window: c.STFT_WINDOW, noverlap: c.STFT_NOVERLAP });
  assert.deepEqual(STFT_DB_RANGE, { min: c.DB_MIN, max: c.DB_MAX });
});

test('hanning matches numpy.hanning(256)', () => {
  // Math.cos and numpy's cos may round one value differently
  assert.ok(maxDiff(hanning(256), arr('hanning_256')) < 1e-15);
  assert.deepEqual(Array.from(hanning(1)), [1]);
  assert.equal(hanning(0).length, 0);
});

test('MTI filter is exactly butter(1, 0.01, \'high\')', () => {
  assert.deepEqual(MTI_FILTER.b, arr('mti_b'));
  assert.deepEqual(MTI_FILTER.a, arr('mti_a'));
});

for (const [n, wn, btype] of meta.butters) {
  test(`butter(${n}, ${wn}, '${btype}') matches scipy`, () => {
    const { b, a } = butter(n, wn, btype);
    assert.ok(relDiff(b, arr(`butter_${n}_${wn}_${btype}_b`)) < 1e-14);
    assert.ok(relDiff(a, arr(`butter_${n}_${wn}_${btype}_a`)) < 1e-14);
  });
}

test('mtiHighpass (lfilter) is exactly scipy\'s lfilter on the complex slow-time signal', () => {
  const { re, im } = mtiHighpass(arr('slow_time_raw_re'), arr('slow_time_raw_im'));
  assert.deepEqual(re, arr('lfilter_raw_re'));
  assert.deepEqual(im, arr('lfilter_raw_im'));
  assert.deepEqual(lfilter([2], [1], [1, 2]), new Float64Array([2, 4]));                // FIR, one tap
  assert.deepEqual(lfilter([1], [2, -1], [2, 0, 0]), new Float64Array([1, 0.5, 0.25]));  // normalised by a[0]
});

for (const mode of ['mti', 'raw']) {
  const mti = mode === 'mti';

  test(`slowTimeSignal (${mode}) matches the signal spectrogram_from_frames passes to the STFT`, () => {
    const { re, im } = slowTimeSignal(frames, rec.nChirp, rec.nSample, { mti });
    const d = Math.max(relDiff(re, arr(`slow_time_${mode}_re`)), relDiff(im, arr(`slow_time_${mode}_im`)));
    console.log(`slow time ${mode}: max |diff| / max ${d}`);
    assert.ok(d < 1e-12);
  });

  test(`stftSpectrogram (${mode}) matches spectrogram_from_frames(mti=${mti ? 'True' : 'False'})`, () => {
    const { spectrogram, nCols, nfft } = stftSpectrogram(frames, rec.nChirp, rec.nSample, { mti });
    assert.deepEqual([nCols, nfft], meta.arrays[`spect_${mode}`].shape);
    const d = relDiff(spectrogram, arr(`spect_${mode}`));
    console.log(`spectrogram ${mode}: max |diff| / max ${d}`);
    assert.ok(d < 1e-12);
  });
}

test('stft alone, on Python\'s slow-time signal, matches the magnitude after fftshift', () => {
  const { re, im, nCols, nfft } = stft(arr('slow_time_mti_re'), arr('slow_time_mti_im'));
  const mag = new Float64Array(nCols * nfft);
  for (let c = 0; c < nCols; c++)
    for (let k = 0; k < nfft; k++) { const j = c * nfft + ((k + nfft / 2) % nfft); mag[c * nfft + k] = Math.hypot(re[j], im[j]); }
  assert.ok(relDiff(mag, arr('spect_mti')) < 1e-12);
});

test('spectrogramToDb matches spectrogram_to_db', () => {
  const db = spectrogramToDb(stftSpectrogram(frames, rec.nChirp, rec.nSample).spectrogram);
  const d = maxDiff(db, arr('db_mti'));
  console.log(`dB: max |diff| ${d}`);
  assert.ok(d < 1e-5);
  assert.ok(db.every(v => v >= -20 && v <= 0));
});

test('a recording too short for one column gives one column of zeros, as Python', () => {
  const { spectrogram, nCols } = stftSpectrogram(frames.slice(0, 2), rec.nChirp, rec.nSample);
  assert.equal(nCols, 1);
  assert.deepEqual(spectrogram, arr('spect_short'));
  assert.deepEqual(spectrogramToDb(spectrogram), Float32Array.from(arr('db_short')));
});
