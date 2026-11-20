import type { PitchDetector } from './PitchDetector';

/** One analysis frame of the pitch track. Times are on the caller's clock (seconds). */
export interface TrackerFrame {
  /** Time of the first / last sample in the analysis window. */
  start: number;
  end: number;
  /** Detected f0 in Hz, or null if unvoiced / unsure. */
  freq: number | null;
  clarity: number;
  /** Window RMS (linear). Kept for onset detection in Milestone 2. */
  rms: number;
}

/**
 * Turns an arbitrary stream of sample chunks into overlapping, evenly hopped analysis windows.
 * Pure (no Web Audio), so it runs in tests and could later move into a worker unchanged.
 *
 * Hop 512 @ 48 kHz ≈ 10.7 ms between frames: fine enough to place onsets well inside a 1/16
 * note at fast tempos (1/16 @ 180 BPM = 83 ms).
 */
export class PitchTracker {
  private buf: Float32Array;
  private filled = 0;
  /** Clock time of buf[0]; NaN until the first chunk arrives. */
  private bufStartTime = NaN;
  private readonly window: Float32Array;

  constructor(
    private readonly detector: PitchDetector,
    private readonly sampleRate: number,
    private readonly hopSize = 512,
  ) {
    const w = detector.windowSize;
    if (hopSize <= 0 || hopSize > w) throw new Error('hopSize must be in 1..windowSize');
    this.buf = new Float32Array(w * 4);
    this.window = new Float32Array(w);
  }

  reset(): void {
    this.filled = 0;
    this.bufStartTime = NaN;
  }

  /**
   * Feed a chunk whose first sample was captured at `startTime`. Returns any frames completed.
   * If the chunk is not contiguous with the previous one (dropped audio), state is reset so we
   * never analyse a window that silently spans a gap.
   */
  push(chunk: Float32Array, startTime: number): TrackerFrame[] {
    const sr = this.sampleRate;
    const expected = this.bufStartTime + this.filled / sr;
    if (!Number.isNaN(this.bufStartTime) && Math.abs(startTime - expected) > 1.5 / sr) {
      this.reset();
    }
    if (Number.isNaN(this.bufStartTime)) this.bufStartTime = startTime;

    if (this.filled + chunk.length > this.buf.length) {
      const bigger = new Float32Array(Math.max(this.buf.length * 2, this.filled + chunk.length));
      bigger.set(this.buf.subarray(0, this.filled));
      this.buf = bigger;
    }
    this.buf.set(chunk, this.filled);
    this.filled += chunk.length;

    const w = this.detector.windowSize;
    const frames: TrackerFrame[] = [];
    let offset = 0;
    while (offset + w <= this.filled) {
      this.window.set(this.buf.subarray(offset, offset + w));
      const est = this.detector.detect(this.window, sr);
      const start = this.bufStartTime + offset / sr;
      frames.push({
        start,
        end: start + (w - 1) / sr,
        freq: est ? est.freq : null,
        clarity: est ? est.clarity : 0,
        rms: rms(this.window),
      });
      offset += this.hopSize;
    }
    if (offset > 0) {
      this.buf.copyWithin(0, offset, this.filled);
      this.filled -= offset;
      this.bufStartTime += offset / sr;
    }
    return frames;
  }
}

export function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}
