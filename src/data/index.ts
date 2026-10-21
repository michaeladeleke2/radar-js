// radar.data: load and save recordings and results. Browser first: loads take
// a File or Blob (or bytes), saves return a Blob; download() offers one as a
// file. In Node 20+, Blob exists too: pass fs.readFileSync(path) to a load
// function, and write a saved Blob with
// fs.writeFileSync(path, Buffer.from(await blob.arrayBuffer())).

import { loadNpy, saveNpy } from './npy_file.ts';
import { toCsv, parseCsv, saveCsv, loadCsv } from './csv.ts';
import { saveJson, loadJson } from './json_file.ts';
import { spectrogramTable, trackTable } from './tables.ts';
import { fromFrames } from './recording.ts';
import { download } from './download.ts';

export type { Recording } from './recording.ts';
export type { Row } from './csv.ts';
export type { Source } from './source.ts';

export const data = {
  /** Load a .npy recording (frames, rx, chirps, samples) from a File, Blob or bytes. */
  loadNpy,
  /** Save a recording as a .npy Blob (numpy.load reads it). */
  saveNpy,
  /** Load a recording saved with saveJson (or any JSON). */
  loadJson,
  /** Save a recording (or any result) as a JSON Blob. */
  saveJson,
  /** Load a CSV file as rows. */
  loadCsv,
  /** Save rows as a CSV Blob. */
  saveCsv,
  /** Rows to CSV text. */
  toCsv,
  /** CSV text to rows. */
  parseCsv,
  /** A Doppler spectrogram as rows, one per time step. */
  spectrogramTable,
  /** Strongest target per frame: time, range, velocity, power. */
  trackTable,
  /** A recording from frames as radar.onFrame delivers them. */
  fromFrames,
  /** Offer a Blob as a file download (browser). */
  download,
};
