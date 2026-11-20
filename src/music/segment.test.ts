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

/** Frames from a pitch function of time (seconds), for slides and wobble. */
function contour(seconds: number, pitchAt: (t: number) => number | null, rmsAt: (t: number) => number = () => 0.2) {
  const frames: TrackFrame[] = [];
  for (let t = 0; t < seconds - 1e-9; t += HOP) {
    const m = pitchAt(t);
    frames.push({ t, freq: m === null ? null : midiToFreq(m), rms: m === null ? 0.001 : rmsAt(t) });
  }
  return frames;
}

// Deterministic pseudo-random jitter.
const jitter = (t: number) => 0.25 * Math.sin(t * 47) + 0.15 * Math.sin(t * 131 + 1);

describe('segmentNotes with a real voice', () => {
  it('keeps a held note whole through a wobble (screenshot: B3 split in two)', () => {
    const notes = segmentNotes(contour(0.7, (t) => 59 + jitter(t) + (t > 0.3 && t < 0.39 ? 0.9 : 0)));
    expect(notes.map((n) => n.pitch)).toEqual([59]);
    expect(notes[0].end - notes[0].start).toBeGreaterThan(0.65);
  });

  it('merges a slide up into the note it lands on (screenshot: short A3 + A3)', () => {
    const notes = segmentNotes(contour(0.5, (t) => (t < 0.08 ? 55 + (t / 0.08) * 2 : 57) + jitter(t) * 0.5));
    expect(notes.map((n) => n.pitch)).toEqual([57]);
    expect(notes[0].start).toBeCloseTo(0, 2);
  });

  it('merges a fall-off at the end into the note', () => {
    const notes = segmentNotes(contour(0.5, (t) => (t < 0.4 ? 55 : 55 - ((t - 0.4) / 0.1) * 3)));
    expect(notes.map((n) => n.pitch)).toEqual([55]);
    expect(notes[0].end).toBeGreaterThan(0.45);
  });

  it('merges the drop from one note into the next (screenshot: short G#3 before G3)', () => {
    const notes = segmentNotes(
      contour(0.9, (t) => (t < 0.3 ? 57 : t < 0.38 ? 57 - ((t - 0.3) / 0.08) * 2 : 55) + jitter(t) * 0.5),
    );
    expect(notes.map((n) => n.pitch)).toEqual([57, 55]);
  });

  it('still separates fast real notes', () => {
    const notes = segmentNotes(contour(0.45, (t) => (t < 0.15 ? 50 : t < 0.3 ? 52 : 53)));
    expect(notes.map((n) => n.pitch)).toEqual([50, 52, 53]);
  });

  it('still separates a re-sung note even right after a slide', () => {
    const notes = segmentNotes(
      contour(
        0.8,
        (t) => (t < 0.06 ? 50 + (t / 0.06) * 2 : 52),
        (t) => (t > 0.38 && t < 0.42 ? 0.02 : 0.3),
      ),
    );
    expect(notes.map((n) => n.pitch)).toEqual([52, 52]);
  });
});

describe('segmentNotes in speaker mode (screenshot: F#3 F#3 split on the beat)', () => {
  /** Held note; a click is gated at `clickAt` and echo cancellation ducks the voice right after. */
  function heldWithClick(clickAt: number, duckDb: number) {
    const frames = contour(
      0.9,
      (t) => 54 + jitter(t) * 0.6,
      (t) => (t > clickAt + 0.07 && t < clickAt + 0.11 ? 0.3 * 10 ** (-duckDb / 20) : 0.3),
    );
    for (const f of frames) if (f.t >= clickAt - 0.03 && f.t < clickAt + 0.08) Object.assign(f, { freq: null, gated: true });
    return frames;
  }

  it('ignores echo-cancellation ducking right after a click', () => {
    expect(segmentNotes(heldWithClick(0.4, 18)).map((n) => n.pitch)).toEqual([54]);
  });

  it('keeps a note whole when it only gets quieter', () => {
    const notes = segmentNotes(contour(0.8, () => 54, (t) => (t > 0.38 && t < 0.42 ? 0.3 * 10 ** (-8 / 20) : 0.3)));
    expect(notes).toHaveLength(1);
  });

  it('merges a slide into a note across a gated click gap', () => {
    const frames = contour(0.7, (t) => (t < 0.1 ? 53 : 52) + jitter(t) * 0.3);
    for (const f of frames) if (f.t >= 0.1 && f.t < 0.2) Object.assign(f, { freq: null, gated: true });
    expect(segmentNotes(frames).map((n) => n.pitch)).toEqual([52]);
  });

  it('still splits at a real gap', () => {
    const notes = segmentNotes(contour(0.8, (t) => (t > 0.35 && t < 0.45 ? null : 54)));
    expect(notes).toHaveLength(2);
  });
});
