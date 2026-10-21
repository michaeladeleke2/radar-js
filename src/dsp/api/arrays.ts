// Input and output shapes shared by the radar.dsp functions.
//
// Inputs are plain nested arrays or typed arrays with an explicit shape;
// outputs are plain nested arrays (number[], number[][]), as bci.js returns.

/** A 2-D array: nested rows, or flat data with its [rows, cols] shape. */
export type Matrix = ArrayLike<number>[] | { data: ArrayLike<number>; shape: [number, number] };

/**
 * Radar frames of one antenna, or a recording to take one antenna from:
 * - nested `[frame][chirp][sample]`
 * - `{ data, shape: [nFrame, nChirp, nSample] }`
 * - `{ data, shape: [nFrame, nRx, nChirp, nSample] }` (a recording, as
 *   radar.data.loadNpy returns and the device streams), with `antenna` choosing the rx
 */
export type Frames =
  | ArrayLike<number>[][]
  | { data: ArrayLike<number>; shape: [number, number, number] | [number, number, number, number] };

/** One frame of one antenna: nested `[chirp][sample]` or `{ data, shape: [nChirp, nSample] }`. */
export type Frame = Matrix;

/** A complex 2-D result, real and imaginary parts as nested arrays. */
export interface ComplexMatrix { re: number[][]; im: number[][] }
/** A complex 1-D result. */
export interface ComplexVector { re: number[]; im: number[] }

const isTyped = (a: ArrayLike<number>): a is Float32Array | Float64Array =>
  ArrayBuffer.isView(a) && !(a instanceof DataView);

/** Row-major flat copy of a matrix, with its size. */
export function flatMatrix(m: Matrix): { data: Float64Array; rows: number; cols: number } {
  if (Array.isArray(m)) {
    const rows = m.length, cols = rows ? m[0].length : 0;
    const data = new Float64Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      if (m[r].length !== cols) throw new Error(`Row ${r} has ${m[r].length} values, expected ${cols}`);
      for (let c = 0; c < cols; c++) data[r * cols + c] = m[r][c];
    }
    return { data, rows, cols };
  }
  const { data, shape } = m as { data: ArrayLike<number>; shape: [number, number] };
  const [rows, cols] = shape;
  if (data.length !== rows * cols) throw new Error(`data has ${data.length} values, shape needs ${rows * cols}`);
  return { data: Float64Array.from(data), rows, cols };
}

/** Frames of one antenna as flat [chirp][sample] arrays, plus their size. */
export function frameList(input: Frames, antenna = 0): { frames: ArrayLike<number>[]; nChirp: number; nSample: number } {
  if (Array.isArray(input)) {
    const frames = input.map(f => flatMatrix(f as ArrayLike<number>[]));
    const nChirp = frames[0]?.rows ?? 0, nSample = frames[0]?.cols ?? 0;
    frames.forEach((f, i) => { if (f.rows !== nChirp || f.cols !== nSample) throw new Error(`Frame ${i} is ${f.rows} x ${f.cols}, expected ${nChirp} x ${nSample}`); });
    return { frames: frames.map(f => f.data), nChirp, nSample };
  }
  const { data, shape } = input as { data: ArrayLike<number>; shape: number[] };
  let nFrame: number, nRx: number, nChirp: number, nSample: number;
  if (shape.length === 4) [nFrame, nRx, nChirp, nSample] = shape;
  else if (shape.length === 3) { [nFrame, nChirp, nSample] = shape; nRx = 1; antenna = 0; }
  else throw new Error(`Expected a shape of 3 or 4 numbers, got [${shape.join(', ')}]`);
  if (antenna < 0 || antenna >= nRx) throw new Error(`antenna ${antenna} out of range (${nRx} antennas)`);
  if (data.length !== nFrame * nRx * nChirp * nSample) throw new Error(`data has ${data.length} values, shape needs ${nFrame * nRx * nChirp * nSample}`);
  const per = nChirp * nSample, stride = nRx * per;
  const view = (i: number) => {
    const start = i * stride + antenna * per;
    return isTyped(data) ? data.subarray(start, start + per) : Array.prototype.slice.call(data, start, start + per) as number[];
  };
  return { frames: Array.from({ length: nFrame }, (_, i) => view(i)), nChirp, nSample };
}

/** Flat row-major data -> nested rows. */
export function nest(data: ArrayLike<number>, rows: number, cols: number): number[][] {
  const out: number[][] = new Array(rows);
  for (let r = 0; r < rows; r++) out[r] = Array.prototype.slice.call(data, r * cols, (r + 1) * cols) as number[];
  return out;
}

/** Flat row-major data -> nested, transposed (rows become columns). */
export function nestTransposed(data: ArrayLike<number>, rows: number, cols: number): number[][] {
  const out: number[][] = new Array(cols);
  for (let c = 0; c < cols; c++) {
    const col = new Array<number>(rows);
    for (let r = 0; r < rows; r++) col[r] = data[r * cols + c];
    out[c] = col;
  }
  return out;
}

/** Typed or plain array -> plain array. */
export const plain = (a: ArrayLike<number>): number[] => Array.from(a);
