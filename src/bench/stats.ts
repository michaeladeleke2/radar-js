/** Summary of a set of measurements. */
export interface Summary { n: number; mean: number; median: number; p95: number; min: number; max: number }

/**
 * n, mean, median, 95th percentile (nearest rank), min and max, rounded to
 * 3 decimals. Empty input gives n = 0 and NaN statistics.
 */
export function summarize(values: number[]): Summary {
  const v = [...values].sort((a, b) => a - b), n = v.length;
  const r = (x: number) => +x.toFixed(3);
  if (!n) return { n: 0, mean: NaN, median: NaN, p95: NaN, min: NaN, max: NaN };
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  const p95 = v[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
  return { n, mean: r(v.reduce((a, b) => a + b, 0) / n), median: r(median), p95: r(p95), min: r(v[0]), max: r(v[n - 1]) };
}
