import { describe, expect, it } from 'vitest';
import type { RawNote } from './segment';
import { estimateTuningOffset, retune } from './tuning';

const n = (rawPitch: number, len = 0.3, start = 0): RawNote => ({
  pitch: Math.round(rawPitch),
  rawPitch,
  start,
  end: start + len,
});

describe('tuning offset', () => {
  it('is ~0 for an in-tune take', () => {
    expect(estimateTuningOffset([n(40.05), n(43.97), n(45.02)])).toBeCloseTo(0, 1);
  });

  it('finds a consistently flat singer and fixes the rounding', () => {
    // Intended riff E A B D, sung ~45 cents flat with some wobble.
    const sung = [n(39.58), n(44.52), n(46.49), n(49.6)];
    expect(sung.map((s) => s.pitch)).toEqual([40, 45, 46, 50]); // naive rounding: B came out as A#
    const off = estimateTuningOffset(sung);
    expect(off).toBeCloseTo(-0.45, 1);
    expect(retune(sung, off).map((s) => s.pitch)).toEqual([40, 45, 47, 50]);
  });

  it('handles the wrap-around at ±50 cents', () => {
    const off = estimateTuningOffset([n(40.49), n(44.51), n(47.48)]);
    expect(Math.abs(Math.abs(off) - 0.5)).toBeLessThan(0.05);
    const pitches = retune([n(40.49), n(44.51), n(47.48)], off).map((s) => s.pitch);
    // All three move the same way, keeping the intervals intact.
    expect(pitches[1] - pitches[0]).toBe(4);
    expect(pitches[2] - pitches[1]).toBe(3);
  });

  it('weights long notes more', () => {
    const off = estimateTuningOffset([n(40.3, 1.0), n(43.0, 0.1)]);
    expect(off).toBeGreaterThan(0.2);
  });

  it('does not guess when notes disagree', () => {
    expect(estimateTuningOffset([n(40.0), n(42.25), n(44.5), n(46.75)])).toBe(0);
    expect(estimateTuningOffset([])).toBe(0);
  });
});
