import { butter as bt } from '../butter.ts';
import { lfilter as lf } from '../lfilter.ts';

/** scipy.signal.butter(order, wn, btype) for low- and high-pass filters: { b, a }. */
export function butter(order: number, wn: number, btype: 'low' | 'lowpass' | 'high' | 'highpass' = 'low'): { b: number[]; a: number[] } {
  const { b, a } = bt(order, wn, btype);
  return { b: Array.from(b), a: Array.from(a) };
}

/** scipy.signal.lfilter(b, a, x), zero initial state. */
export const lfilter = (b: ArrayLike<number>, a: ArrayLike<number>, x: ArrayLike<number>): number[] => Array.from(lf(b, a, x));
