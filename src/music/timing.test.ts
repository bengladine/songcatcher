import { describe, expect, it } from 'vitest';
import { barDuration, beatDuration, clickSchedule, overlapsClick } from './timing';

const m = { bpm: 100, beatsPerBar: 4 };

describe('timing', () => {
  it('computes beat and bar durations', () => {
    expect(beatDuration(m)).toBeCloseTo(0.6);
    expect(barDuration(m)).toBeCloseTo(2.4);
  });

  it('builds a count-in + recording click schedule', () => {
    const clicks = clickSchedule(m, 1, 2);
    expect(clicks).toHaveLength(12);
    expect(clicks[0]).toEqual({ time: -2.4, accent: true, countIn: true });
    expect(clicks.slice(0, 4).every((c) => c.countIn)).toBe(true);
    expect(clicks[4]).toEqual({ time: 0, accent: true, countIn: false });
    expect(clicks[5].accent).toBe(false);
    expect(clicks[8].accent).toBe(true);
    expect(clicks[11].time).toBeCloseTo(4.2);
  });

  it('flags analysis windows that touch a click', () => {
    const clicks = [0, 0.6, 1.2];
    expect(overlapsClick(0.1, 0.14, clicks)).toBe(false);
    expect(overlapsClick(0.03, 0.07, clicks)).toBe(true); // inside the ring-out
    expect(overlapsClick(0.55, 0.595, clicks)).toBe(true); // just before a click
    expect(overlapsClick(0.3, 0.34, clicks)).toBe(false);
  });
});
