import { describe, expect, it } from 'vitest';
import { midiToFreq } from './pitch';
import { segmentNotes, type TrackFrame } from './segment';

const HOP = 512 / 48000;

/** Build frames from a list of [durationSec, midi|null, rms?] pieces. */
function track(pieces: [number, number | null, number?][], opts: { gatedAt?: number[] } = {}) {
  const frames: TrackFrame[] = [];
  let t = 0;
  for (const [dur, m, level] of pieces) {
    const rms = level ?? (m === null ? 0.001 : 0.2);
    const end = t + dur;
    for (; t < end - 1e-9; t += HOP) {
      frames.push({ t, freq: m === null ? null : midiToFreq(m), rms });
    }
    t = end;
  }
  for (const g of opts.gatedAt ?? []) {
    for (const f of frames) if (f.t >= g && f.t < g + 0.1) Object.assign(f, { freq: null, gated: true });
  }
  return frames;
}

describe('segmentNotes', () => {
  it('turns a steady tone into one note', () => {
    const notes = segmentNotes(track([[0.5, 45]]));
    expect(notes).toHaveLength(1);
    expect(notes[0].pitch).toBe(45);
    expect(notes[0].start).toBeCloseTo(0, 2);
    expect(notes[0].end).toBeCloseTo(0.5, 1);
  });

  it('splits on a pitch change (legato)', () => {
    const notes = segmentNotes(track([[0.3, 45], [0.3, 48]]));
    expect(notes.map((n) => n.pitch)).toEqual([45, 48]);
    expect(notes[1].start).toBeCloseTo(0.3, 1);
  });

  it('rounds slightly out-of-tune humming to the nearest semitone', () => {
    const notes = segmentNotes(track([[0.4, 45.35], [0.4, 46.7]]));
    expect(notes.map((n) => n.pitch)).toEqual([45, 47]);
    expect(notes[0].rawPitch).toBeCloseTo(45.35);
  });

  it('ignores vibrato and single-frame octave errors', () => {
    const frames = track([[0.6, 45]]);
    frames.forEach((f, i) => (f.freq = midiToFreq(45 + 0.35 * Math.sin(i / 3))));
    frames[20].freq = midiToFreq(57); // octave jump for one frame
    frames[21].freq = midiToFreq(57);
    const notes = segmentNotes(frames);
    expect(notes).toHaveLength(1);
    expect(notes[0].pitch).toBe(45);
  });

  it('splits at silence', () => {
    const notes = segmentNotes(track([[0.25, 50], [0.15, null], [0.25, 50]]));
    expect(notes).toHaveLength(2);
    expect(notes[1].start).toBeCloseTo(0.4, 1);
  });

  it('bridges a tiny detector dropout (level stays up)', () => {
    const notes = segmentNotes(track([[0.25, 50], [0.02, null, 0.2], [0.25, 50]]));
    expect(notes).toHaveLength(1);
  });

  it('splits a re-sung note on an energy dip', () => {
    const notes = segmentNotes(
      track([
        [0.3, 43, 0.3],
        [0.04, 43, 0.03],
        [0.3, 43, 0.3],
      ]),
    );
    expect(notes).toHaveLength(2);
    expect(notes.every((n) => n.pitch === 43)).toBe(true);
    expect(notes[1].start).toBeGreaterThan(0.3);
    expect(notes[1].start).toBeLessThan(0.36);
  });

  it('bridges metronome-gated windows inside a held note', () => {
    const notes = segmentNotes(track([[1.0, 40]], { gatedAt: [0.3, 0.7] }));
    expect(notes).toHaveLength(1);
  });

  it('drops blips shorter than the minimum', () => {
    const notes = segmentNotes(track([[0.04, 60], [0.2, null], [0.3, 45]]));
    expect(notes.map((n) => n.pitch)).toEqual([45]);
  });

  it('ignores quiet bleed relative to the take', () => {
    const notes = segmentNotes(track([[0.3, 45, 0.3], [0.2, null], [0.3, 70, 0.002]]));
    expect(notes.map((n) => n.pitch)).toEqual([45]);
  });
});
