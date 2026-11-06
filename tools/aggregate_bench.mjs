// Combine benchmark result files (demo/bench.html downloads) from several
// machines into tables and plot data for the paper.
//
//   node tools/aggregate_bench.mjs <folder of radarjs-bench_*.json> [--out <folder>] [--expect-commit <sha>]
//
// --expect-commit: every result file must report that radar-js commit (a
// prefix is enough) from a clean build; any that does not is flagged, listed
// in flags.txt, and the exit code is 1 (the tables are still written).
//
// Writes (default <folder>/aggregate/):
//   combined.csv        every summary row of every machine
//   specs_table.tex     LaTeX table body: machine, CPU, cores, RAM, OS, Chrome
//   stages_table.tex    LaTeX table body: replay stages, mean (SD) ms per machine
//   live_table.tex      LaTeX table body: live modes per machine (if present)
//   plot_data.json      data for tools/plot_bench.py
// A machine with several files: the newest file of each section is used.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--'));
if (!dir) { console.error('usage: node tools/aggregate_bench.mjs <folder> [--out <folder>]'); process.exit(2); }
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(dir, 'aggregate');
const expectCommit = args.includes('--expect-commit') ? args[args.indexOf('--expect-commit') + 1] : null;
const flags = [];
mkdirSync(out, { recursive: true });

const tex = s => String(s ?? '').replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}');
const n2 = x => (Number.isFinite(x) ? x.toFixed(2) : '--');

// one entry per machine: the newest file's sections (older files fill gaps)
const machines = new Map();
for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  let r;
  try { r = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
  if (r.format !== 'radar-js-benchmark') continue;
  const label = r.system?.machine_label || f;
  const commit = r.system?.radar_js_commit ?? r.radar_js?.commit ?? null, dirty = r.system?.radar_js_dirty ?? r.radar_js?.dirty ?? null;
  if (expectCommit && (!commit || !commit.startsWith(expectCommit.slice(0, Math.min(expectCommit.length, commit.length))) || commit.length < 7 || dirty))
    flags.push(`${f} (${label}): radar-js commit ${commit ?? 'missing'}${dirty ? ' with uncommitted changes' : ''}, expected ${expectCommit}`);
  const m = machines.get(label) ?? { label, system: r.system, files: [], commits: new Set() };
  m.files.push(f); m.commits.add(`${commit}${dirty ? '+dirty' : ''}`);
  for (const k of ['replay', 'scaling', 'threads', 'live']) if (r[k]) m[k] = r[k];
  if (r.system) m.system = r.system;
  machines.set(label, m);
}
const list = [...machines.values()];
if (!list.length) { console.error(`no benchmark results in ${dir}`); process.exit(1); }

// combined CSV
const rows = [['machine', 'radar_js_commit', 'section', 'test', 'size', 'mode', 'n', 'mean_ms', 'sd_ms', 'median_ms', 'p5_ms', 'p95_ms', 'min_ms', 'max_ms']];
const push = (m, section, test, size, mode, s) => rows.push([m.label, [...m.commits].join(' '), section, test, size, mode, s.n, s.mean, s.sd, s.median, s.p5, s.p95, s.min, s.max]);
for (const m of list) {
  if (m.replay) {
    const size = m.replay.frame_shape.join('x');
    for (const [name, st] of Object.entries(m.replay.stages)) {
      push(m, 'replay', name, size, 'main', st.stats);
      for (const [p, v] of Object.entries(st.parts ?? {})) push(m, 'replay', `${name}: ${p}`, size, 'main', v.stats);
    }
  }
  if (m.scaling) for (const row of m.scaling.sizes) for (const t of ['rangeFft', 'rangeDopplerMap', 'full live pipeline']) push(m, 'scaling', t, `${row.chirps}x${row.samples}`, 'main', row[t].stats);
  if (m.threads) for (const mode of ['main', 'worker']) {
    const r = m.threads[mode]; if (!r) continue;
    push(m, 'threads', 'raf interval', '128x256', mode, r.raf.stats);
    if (r.processing_ms) push(m, 'threads', 'processing', '128x256', mode, r.processing_ms);
    if (r.round_trip_ms) push(m, 'threads', 'worker round trip', '128x256', mode, r.round_trip_ms);
    push(m, 'threads', 'rendering', '128x256', mode, r.rendering_ms);
  }
  if (m.live) for (const r of m.live.modes) {
    push(m, 'live', 'processing', '128x256', r.mode.name, r.processing_ms);
    if (r.rendering_ms) push(m, 'live', 'rendering', '128x256', r.mode.name, r.rendering_ms);
    push(m, 'live', 'arrival to output', '128x256', r.mode.name, r.arrival_to_output_ms);
  }
}
const csv = rows.map(r => r.map(x => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(',')).join('\n') + '\n';
writeFileSync(join(out, 'combined.csv'), csv);

// LaTeX: device specs
const specs = list.map(m => {
  const s = m.system ?? {};
  return `${tex(m.label)} & ${tex(s.cpu_model)} & ${tex(s.cpu_cores || s.hardware_concurrency)} & ${tex(s.ram || (s.device_memory_gb ? `${s.device_memory_gb} GB` : ''))} & ${tex(`${s.os ?? ''} ${s.os_version ?? ''}`.trim())} & ${tex(s.browser_version)} \\\\`;
});
writeFileSync(join(out, 'specs_table.tex'), '% Machine & CPU & Cores & RAM & OS & Chrome\n' + specs.join('\n') + '\n');

// LaTeX: replay stages, mean (SD) per machine
const stageNames = [...new Set(list.flatMap(m => (m.replay ? Object.keys(m.replay.stages) : [])))];
const stageRows = [];
for (const st of stageNames) {
  stageRows.push(`${tex(st)} & ${list.map(m => { const s = m.replay?.stages[st]?.stats; return s ? `${n2(s.mean)} (${n2(s.sd)})` : '--'; }).join(' & ')} \\\\`);
  for (const p of ['processing', 'rendering']) if (list.some(m => m.replay?.stages[st]?.parts?.[p]))
    stageRows.push(`\\quad ${p} & ${list.map(m => { const s = m.replay?.stages[st]?.parts?.[p]?.stats; return s ? `${n2(s.mean)} (${n2(s.sd)})` : '--'; }).join(' & ')} \\\\`);
}
stageRows.push(`Real-time margin & ${list.map(m => (m.replay ? `${n2(m.replay.real_time_margin)}$\\times$` : '--')).join(' & ')} \\\\`);
writeFileSync(join(out, 'stages_table.tex'), `% Stage & ${list.map(m => m.label).join(' & ')}  (mean (SD) ms per frame)\n` + stageRows.join('\n') + '\n');

// LaTeX: live modes
if (list.some(m => m.live)) {
  const lr = [];
  for (const m of list) for (const r of m.live?.modes ?? [])
    lr.push(`${tex(m.label)} & ${tex(r.mode.name)} & ${r.frames_delivered}/${r.frames_expected_board_clock} & ${n2(r.processing_ms.mean)} & ${r.rendering_ms ? n2(r.rendering_ms.mean) : '--'} & ${n2(r.arrival_to_output_ms.mean)} & ${n2(r.board_to_output_ms.slope_ms_per_s)} & ${r.sustained_real_time ? 'yes' : 'no'} \\\\`);
  writeFileSync(join(out, 'live_table.tex'), '% Machine & Mode & Frames & Processing & Rendering & Arrival to output (ms) & Delay slope (ms/s) & Real time\n' + lr.join('\n') + '\n');
}

// plot data
const plot = {
  machines: list.map(m => m.label),
  stages: Object.fromEntries(stageNames.map(st => [st, Object.fromEntries(list.filter(m => m.replay?.stages[st]).map(m => [m.label, { mean: m.replay.stages[st].stats.mean, sd: m.replay.stages[st].stats.sd }]))])),
  scaling: Object.fromEntries(list.filter(m => m.scaling).map(m => [m.label, Object.fromEntries(['rangeFft', 'rangeDopplerMap', 'full live pipeline'].map(t => [t, m.scaling.sizes.map(r => ({ size: `${r.chirps}x${r.samples}`, samples_per_frame: r.chirps * r.samples, mean: r[t].stats.mean, sd: r[t].stats.sd }))]))])),
};
writeFileSync(join(out, 'plot_data.json'), JSON.stringify(plot, null, 1));
if (expectCommit) writeFileSync(join(out, 'flags.txt'), flags.length ? flags.join('\n') + '\n' : `all files report commit ${expectCommit}\n`);
for (const fl of flags) console.log(`FLAG ${fl}`);
console.log(`${list.length} machine(s): ${list.map(m => `${m.label} (${m.files.length} file(s), commit ${[...m.commits].join(', ')})`).join(', ')}\nwrote ${out}/combined.csv, specs_table.tex, stages_table.tex${list.some(m => m.live) ? ', live_table.tex' : ''}, plot_data.json`);
if (flags.length) process.exit(1);
