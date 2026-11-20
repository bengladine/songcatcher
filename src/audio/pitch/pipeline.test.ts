import { describe, expect, it } from 'vitest';
import { quantizeNotes } from '../../music/notes';
import { midiToFreq } from '../../music/pitch';
import { segmentNotes } from '../../music/segment';
import { McLeodDetector } from './McLeodDetector';
import { PitchTracker } from './PitchTracker';

const SR = 48000;

/** Hum-like tone (fundamental + 2 harmonics) with soft attack/release per note. */
function hum(notes: [midi: number | null, seconds: number][]): Float32Array {
  const total = notes.reduce((s, [, d]) => s + d, 0);
  const out = new Float32Array(Math.round(total * SR));
  let o = 0;
  let phase = 0;
  for (const [m, d] of notes) {
    const n = Math.round(d * SR);
    const f = m === null ? 0 : midiToFreq(m);
    for (let i = 0; i < n; i++) {
      phase += (2 * Math.PI * f) / SR;
      const env = Math.min(1, i / 300, (n - i) / 1500);
      out[o + i] =
        m === null ? 0 : 0.5 * env * (Math.sin(phase) + 0.4 * Math.sin(2 * phase) + 0.2 * Math.sin(3 * phase));
    }
    o += n;
  }
  return out;
}

describe('audio → notes pipeline', () => {
  it('recovers a hummed riff on an eighth-note grid', () => {
    // 120 BPM: eighth = 0.25 s. Riff: E2 E2 G2 A2(quarter) rest D3 C3
    const e = 0.25;
    const audio = hum([
      [40, e * 0.85], [null, e * 0.15],
      [40, e * 0.85], [null, e * 0.15],
      [43, e],
      [45, 2 * e],
      [null, e],
      [50, e],
      [48, e],
    ]);
    const tracker = new PitchTracker(new McLeodDetector(), SR, 512);
    const frames = [];
    for (let i = 0; i < audio.length; i += 1024) {
      for (const f of tracker.push(audio.subarray(i, i + 1024), i / SR)) {
        frames.push({ t: (f.start + f.end) / 2, freq: f.freq, rms: f.rms });
      }
    }
    // Frame times are window centres; the tracker's analysis delay is what M1's latency
    // compensation handles on device. Here the window is centred so no extra shift is needed.
    const raw = segmentNotes(frames);
    const notes = quantizeNotes(raw, { bpm: 120, beatsPerBar: 4 }, 0.5, 8);
    expect(notes.map((n) => [n.pitch, n.start, n.length])).toEqual([
      [40, 0, 0.5],
      [40, 0.5, 0.5],
      [43, 1, 0.5],
      [45, 1.5, 1],
      [50, 3, 0.5],
      [48, 3.5, 0.5],
    ]);
  });
});
