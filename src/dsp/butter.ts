// scipy.signal.butter(N, Wn, btype) for a digital low- or high-pass filter,
// output='ba', ported from scipy 1.17 (scipy/signal/_filter_design.py):
// buttap -> lp2lp_zpk / lp2hp_zpk at the pre-warped frequency -> bilinear_zpk
// (fs = 2) -> zpk2tf. Complex arithmetic follows numpy's (Smith's division),
// so the coefficients agree with scipy's to floating point rounding (exactly
// for SensDSv2's butter(1, 0.01, 'high')).

type C = [number, number];

const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];

// numpy's complex division (numpy/_core/src/umath/loops_arithm_fp.dispatch.c.src)
function div(a: C, b: C): C {
  const [ar, ai] = a, [br, bi] = b;
  if (Math.abs(br) >= Math.abs(bi)) {
    if (br === 0 && bi === 0) return [ar / Math.abs(br), ai / Math.abs(bi)];
    const rat = bi / br, scl = 1.0 / (br + bi * rat);
    return [(ar + ai * rat) * scl, (ai - ar * rat) * scl];
  }
  const rat = br / bi, scl = 1.0 / (bi + br * rat);
  return [(ar * rat + ai) * scl, (ai * rat - ar) * scl];
}

// numpy.prod of a complex array: sequential, 1 for an empty array
function prod(v: C[]): C {
  if (v.length === 0) return [1, 0];
  let p = v[0];
  for (let i = 1; i < v.length; i++) p = mul(p, v[i]);
  return p;
}

// scipy.signal._polyutils.poly: coefficients of prod(x - root), real part
// (Butterworth roots come in conjugate pairs)
function poly(roots: C[]): Float64Array {
  let a: C[] = [[1, 0]];
  for (const r of roots) {
    const nz: C = [-r[0], -r[1]];
    const out: C[] = [];
    for (let j = 0; j <= a.length; j++) {
      const t0: C = j < a.length ? a[j] : [0, 0];
      const t1: C = j > 0 ? mul(a[j - 1], nz) : [0, 0];
      out.push([t0[0] + t1[0], t0[1] + t1[1]]);
    }
    a = out;
  }
  return Float64Array.from(a, c => c[0]);
}

/**
 * Butterworth digital filter coefficients, as scipy.signal.butter(order, wn,
 * btype, output='ba').
 * @param order filter order (integer, at least 1)
 * @param wn critical frequency, normalised to Nyquist (0 < wn < 1)
 * @param btype 'low' / 'lowpass' or 'high' / 'highpass'
 * @returns { b, a } numerator and denominator, a[0] = 1
 */
export function butter(order: number, wn: number, btype: 'low' | 'lowpass' | 'high' | 'highpass' = 'low'): { b: Float64Array; a: Float64Array } {
  if (!Number.isInteger(order) || order < 1) throw new Error('order must be an integer >= 1');
  if (!(wn > 0 && wn < 1)) throw new Error('Digital filter critical frequencies must be 0 < Wn < 1');
  const high = btype === 'high' || btype === 'highpass';
  if (!high && btype !== 'low' && btype !== 'lowpass') throw new Error(`unsupported btype: ${btype}`);

  // buttap(N): no zeros, poles -exp(1j * pi * m / (2N)), m = -N+1, -N+3, ..., N-1
  let p: C[] = [];
  for (let m = 1 - order; m < order; m += 2) {
    const [re, im] = div([0 * m - Math.PI * 0, Math.PI * m], [2 * order, 0]);
    const e = Math.exp(re);
    p.push([-(e * Math.cos(im)), -(e * Math.sin(im))]);
  }
  let z: C[] = [];
  let k = 1.0;

  const fs = 2.0;
  const warped = 2 * fs * Math.tan(Math.PI * wn / fs);
  const degree = p.length - z.length;
  if (high) {
    // lp2hp_zpk
    const kHp = k * div(prod(z.map(v => [-v[0], -v[1]] as C)), prod(p.map(v => [-v[0], -v[1]] as C)))[0];
    z = z.map(v => div([warped, 0], v));
    p = p.map(v => div([warped, 0], v));
    for (let i = 0; i < degree; i++) z.push([0, 0]);
    k = kHp;
  } else {
    // lp2lp_zpk
    z = z.map(v => mul([warped, 0], v));
    p = p.map(v => mul([warped, 0], v));
    k = k * warped ** degree;
  }

  // bilinear_zpk(z, p, k, fs)
  const fs2 = 2.0 * fs;
  const deg2 = p.length - z.length;
  const kZ = k * div(prod(z.map(v => [fs2 - v[0], -v[1]] as C)), prod(p.map(v => [fs2 - v[0], -v[1]] as C)))[0];
  const zZ: C[] = z.map(v => div([fs2 + v[0], v[1]], [fs2 - v[0], -v[1]]));
  const pZ: C[] = p.map(v => div([fs2 + v[0], v[1]], [fs2 - v[0], -v[1]]));
  for (let i = 0; i < deg2; i++) zZ.push([-1, 0]);

  // zpk2tf
  const b = poly(zZ).map(v => kZ * v);
  const a = poly(pZ);
  return { b, a };
}
