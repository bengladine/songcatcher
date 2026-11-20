import { describe, expect, it } from 'vitest';
import { McLeodDetector } from './McLeodDetector';
import { PitchTracker } from './PitchTracker';

const SR = 48000;

function sine(freq: number, seconds: number, amp = 0.5, phase0 = 0): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(phase0 + (2 * Math.PI * freq * i) / SR);
  return out;
}

/** Feed a signal in worklet-sized chunks, like the real capture path. */
function feed(t: PitchTracker, x: Float32Array, t0 = 0, chunk = 1024) {
  const frames = [];
  for (let i = 0; i < x.length; i += chunk) {
    frames.push(...t.push(x.subarray(i, i + chunk), t0 + i / SR));
  }
  return frames;
}

describe('PitchTracker + McLeodDetector', () => {
  it('tracks a steady hummed tone', () => {
    const tracker = new PitchTracker(new McLeodDetector(), SR, 512);
    const frames = feed(tracker, sine(146.83, 0.5)); // D3
    expect(frames.length).toBeGreaterThan(35);
    const voiced = frames.filter((f) => f.freq !== null);
    expect(voiced.length).toBe(frames.length);
    for (const f of voiced) expect(f.freq!).toBeCloseTo(146.83, 0);
  });

  it('hops evenly and keeps timestamps on the input clock', () => {
    const tracker = new PitchTracker(new McLeodDetector(), SR, 512);
    const frames = feed(tracker, sine(220, 0.2), 10);
    expect(frames[0].start).toBeCloseTo(10);
    expect(frames[1].start - frames[0].start).toBeCloseTo(512 / SR, 6);
    expect(frames[0].end - frames[0].start).toBeCloseTo(2047 / SR, 6);
  });

  it('reports silence as unvoiced', () => {
    const tracker = new PitchTracker(new McLeodDetector(), SR, 512);
    const frames = feed(tracker, new Float32Array(SR / 4));
    expect(frames.every((f) => f.freq === null && f.rms === 0)).toBe(true);
  });

  it('follows a note change', () => {
    const tracker = new PitchTracker(new McLeodDetector(), SR, 512);
    const a = sine(110, 0.3);
    const b = sine(164.81, 0.3);
    const x = new Float32Array(a.length + b.length);
    x.set(a);
    x.set(b, a.length);
    const frames = feed(tracker, x);
    const early = frames.filter((f) => f.end < 0.29);
    const late = frames.filter((f) => f.start > 0.31);
    expect(early.every((f) => Math.abs(f.freq! - 110) < 1)).toBe(true);
    expect(late.every((f) => Math.abs(f.freq! - 164.81) < 1)).toBe(true);
  });

  it('resets on a gap instead of analysing across it', () => {
    const tracker = new PitchTracker(new McLeodDetector(), SR, 512);
    tracker.push(sine(220, 0.02), 0); // < 1 window, nothing emitted yet
    const frames = tracker.push(sine(220, 0.05), 5); // jump in time
    expect(frames[0].start).toBeCloseTo(5);
  });
});
