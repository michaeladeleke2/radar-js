// Check every capture in data/captures/ and write data/manifest.csv.
//
//   node tools/check_captures.ts            (Node 22.18+ runs TypeScript directly)
//
// For each .npy + .json pair: the file loads, its shape matches the sidecar,
// frames received vs expected, drops; and what the radar saw, from
// radar.data.trackTable: the strongest moving target's range span and peak
// speed (toward the radar is negative). Prints a table and writes the manifest
// (one row per capture, with SHA-256 of both files).

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import radar from '../src/index.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = join(ROOT, 'data', 'captures');
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

const files = existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith('.json')).sort() : [];
const rows: string[][] = [['file', 'type', 'label', 'distance_m', 'started_at', 'frames_expected', 'frames_received', 'frames_dropped', 'restarts', 'radar_js_commit', 'npy_sha256', 'json_sha256']];
const problems: string[] = [];
const summary = new Map<string, number>();

console.log('file                                   frames  drop  range span (m)   peak speed (m/s)');
for (const json of files) {
  const meta = JSON.parse(readFileSync(join(DIR, json), 'utf8'));
  if (meta.format !== 'radar-js-capture') continue;
  const npy = join(DIR, meta.file);
  if (!existsSync(npy)) { problems.push(`${json}: ${meta.file} missing`); continue; }
  const rec = await radar.data.loadNpy(readFileSync(npy));
  const f = meta.frames;
  if (rec.shape.join() !== f.shape.join()) problems.push(`${meta.file}: shape ${rec.shape} but sidecar says ${f.shape}`);
  if (f.received !== f.expected) problems.push(`${meta.file}: ${f.received} of ${f.expected} frames`);
  if (f.dropped) problems.push(`${meta.file}: ${f.dropped} dropped`);
  let span = '', peak = '';
  if (meta.type === 'dataset') {
    const track = radar.data.trackTable(rec, meta.config);
    const moving = track.filter(r => Math.abs(r.velocity_m_s as number) > 0.1);
    const ranges = moving.map(r => r.range_m as number);
    const fastest = moving.reduce((a, r) => (Math.abs(r.velocity_m_s as number) > Math.abs(a?.velocity_m_s as number ?? 0) ? r : a), moving[0]);
    span = ranges.length ? `${Math.min(...ranges).toFixed(2)}-${Math.max(...ranges).toFixed(2)}` : '-';
    peak = fastest ? `${(fastest.velocity_m_s as number).toFixed(2)}` : '-';
    const k = `${meta.label}@${meta.distance_m}`;
    summary.set(k, (summary.get(k) ?? 0) + 1);
  }
  console.log(`${meta.file.padEnd(38)} ${String(f.received).padStart(3)}/${String(f.expected).padEnd(3)} ${String(f.dropped).padStart(4)}  ${span.padEnd(16)} ${peak}`);
  rows.push([meta.file, meta.type, meta.label ?? '', meta.distance_m ?? '', meta.started_at, f.expected, f.received, f.dropped, f.restarts, meta.radar_js?.commit ?? '', sha(npy), sha(join(DIR, json))].map(String));
}

writeFileSync(join(ROOT, 'data', 'manifest.csv'), rows.map(r => r.join(',')).join('\n') + '\n');
console.log(`\n${rows.length - 1} captures; manifest written to data/manifest.csv`);
if (summary.size) {
  const labels = ['push', 'pull', 'swipe', 'wave', 'empty'], dists = [0.3, 0.6, 1];
  console.log('\nclips   ' + dists.map(d => `${d} m`.padStart(7)).join('') + '   total');
  for (const l of labels) {
    const n = dists.map(d => summary.get(`${l}@${d}`) ?? 0);
    console.log(l.padEnd(8) + n.map(x => String(x).padStart(7)).join('') + String(n.reduce((a, b) => a + b, 0)).padStart(8));
  }
}
console.log(problems.length ? `\n${problems.length} problem(s):\n  ` + problems.join('\n  ') : '\nNo problems.');
