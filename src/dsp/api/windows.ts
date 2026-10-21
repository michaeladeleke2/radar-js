import { blackmanharris as bh, chebwin as cw } from '../windows.js';
import { hanning as hn } from '../hanning.ts';

/** scipy.signal.windows.blackmanharris(M), symmetric. */
export const blackmanharris = (M: number): number[] => Array.from(bh(M) as Float64Array);
/** scipy.signal.windows.chebwin(M, at) (attenuation `at` in dB), symmetric. */
export const chebwin = (M: number, at: number): number[] => Array.from(cw(M, at) as Float64Array);
/** numpy.hanning(M). */
export const hanning = (M: number): number[] => Array.from(hn(M));
