/**
 * Swappable pitch-detection backend. Today: McLeod (pitchy). Later: pYIN / CREPE.
 * Implementations must be pure w.r.t. the window they are given (no hidden time state),
 * so they can be driven from tests with synthetic signals.
 */
export interface PitchEstimate {
  /** Fundamental frequency in Hz. */
  freq: number;
  /** 0..1, how periodic the window is. */
  clarity: number;
}

export interface PitchDetector {
  /** Number of samples the detector wants per analysis window. */
  readonly windowSize: number;
  /** Returns null when no confident pitch is found (silence, noise, out of range). */
  detect(window: Float32Array, sampleRate: number): PitchEstimate | null;
}
