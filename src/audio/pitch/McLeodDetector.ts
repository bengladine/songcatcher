import { PitchDetector as Pitchy } from 'pitchy';
import type { PitchDetector, PitchEstimate } from './PitchDetector';

export interface McLeodOptions {
  windowSize?: number;
  /** Results below this clarity are discarded. */
  minClarity?: number;
  /** Hz. Humming a drop-C riff can go down to ~C2 (65 Hz); leave headroom for low voices. */
  minFreq?: number;
  maxFreq?: number;
  /** RMS floor in dBFS; quieter windows count as silence. */
  minVolumeDb?: number;
}

/**
 * McLeod Pitch Method via `pitchy`.
 *
 * Window size: MPM needs ≥ 2 periods of the lowest pitch in the window. At 48 kHz, 2048
 * samples = 43 ms, i.e. 2 periods down to ~47 Hz. Larger windows give stabler low notes but
 * smear fast note changes; 2048 is the usual compromise for voice.
 */
export class McLeodDetector implements PitchDetector {
  readonly windowSize: number;
  private readonly pitchy: Pitchy<Float32Array>;
  private readonly minClarity: number;
  private readonly minFreq: number;
  private readonly maxFreq: number;

  constructor(opts: McLeodOptions = {}) {
    this.windowSize = opts.windowSize ?? 2048;
    this.minClarity = opts.minClarity ?? 0.8;
    this.minFreq = opts.minFreq ?? 50;
    this.maxFreq = opts.maxFreq ?? 1500;
    this.pitchy = Pitchy.forFloat32Array(this.windowSize);
    this.pitchy.minVolumeDecibels = opts.minVolumeDb ?? -50;
  }

  detect(window: Float32Array, sampleRate: number): PitchEstimate | null {
    const [freq, clarity] = this.pitchy.findPitch(window, sampleRate);
    if (clarity < this.minClarity || freq < this.minFreq || freq > this.maxFreq) return null;
    return { freq, clarity };
  }
}
