import type { RadarConfig } from '../config/types.ts';
import type { Row } from './csv.ts';
import { velocityAxis } from '../dsp/api/velocity_axis.ts';
import { rangeAxis } from '../dsp/api/range_axis.ts';
import { dopplerSpectrogram } from '../dsp/api/doppler_spectrogram.ts';
import type { Recording } from './recording.ts';

/**
 * A spectrogram as table rows, one per time step: `time_s`, `frame`, then one
 * column per velocity bin named `v_<m/s>`. For radar.dsp.dopplerSpectrogram
 * output ([frame][dopplerBin]).
 *
 * @param spectrogram [frame][dopplerBin] in dB
 * @param config radar settings, for the time step and velocity axis
 */
export function spectrogramTable(spectrogram: number[][], config: RadarConfig): Row[] {
  const v = velocityAxis(config, { dopplerFftSize: spectrogram[0]?.length });
  const names = v.map(x => `v_${x.toFixed(3)}`);
  return spectrogram.map((row, i) => {
    const out: Row = { time_s: +(i * config.frame_repetition_time_s).toFixed(6), frame: i };
    row.forEach((value, k) => { out[names[k]] = value; });
    return out;
  });
}

/**
 * One row per frame describing the strongest moving target, from the Doppler
 * spectrogram method: `time_s`, `frame`, `range_m` (the tracked range bin),
 * `velocity_m_s` and `power_db` (the loudest Doppler cell). Small enough for
 * CODAP.
 *
 * @param recording frames (see radar.data.loadNpy)
 * @param config radar settings, for the axes and time step
 * @param options.antenna rx antenna (default 0)
 */
export function trackTable(recording: Pick<Recording, 'data' | 'shape'>, config: RadarConfig, { antenna = 0 }: { antenna?: number } = {}): Row[] {
  const { spectrogram, rangeBins } = dopplerSpectrogram(recording, { antenna });
  const v = velocityAxis(config, { dopplerFftSize: spectrogram[0]?.length });
  const r = rangeAxis(config);
  return spectrogram.map((row, i) => {
    let k = 0;
    for (let j = 1; j < row.length; j++) if (row[j] > row[k]) k = j;
    return {
      time_s: +(i * config.frame_repetition_time_s).toFixed(6),
      frame: i,
      range_m: +r[rangeBins[i]].toFixed(4),
      velocity_m_s: +v[k].toFixed(4),
      power_db: +row[k].toFixed(2),
    };
  });
}
