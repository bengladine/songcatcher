import { describe, expect, it } from 'vitest';
import {
  deleteNote,
  fitOctave,
  moveNote,
  quantizeNotes,
  resizeNote,
  transposeNote,
  type Note,
} from './notes';
import type { RawNote } from './segment';

const meter = { bpm: 120, beatsPerBar: 4 }; // 1 beat = 0.5 s
const raw = (pitch: number, start: number, end: number): RawNote => ({ pitch, rawPitch: pitch, start, end });
const strip = (ns: readonly Note[]) => ns.map(({ pitch, start, length }) => ({ pitch, start, length }));

describe('quantizeNotes', () => {
  it('snaps start and end to an eighth grid', () => {
    const q = quantizeNotes([raw(40, 0.02, 0.23), raw(43, 0.27, 0.71)], meter, 0.5, 8);
    expect(strip(q)).toEqual([
      { pitch: 40, start: 0, length: 0.5 },
      { pitch: 43, start: 0.5, length: 1 },
    ]);
  });

  it('uses a finer grid when asked', () => {
    const q = quantizeNotes([raw(40, 0.13, 0.24)], meter, 0.25, 8);
    expect(strip(q)).toEqual([{ pitch: 40, start: 0.25, length: 0.25 }]);
  });

  it('gives very short notes one grid step', () => {
    const q = quantizeNotes([raw(40, 0.5, 0.56)], meter, 0.5, 8);
    expect(strip(q)).toEqual([{ pitch: 40, start: 1, length: 0.5 }]);
  });

  it('keeps the longer note when two land on the same step', () => {
    const q = quantizeNotes([raw(40, 0.0, 0.08), raw(45, 0.1, 0.5)], meter, 0.5, 8);
    expect(strip(q)).toEqual([{ pitch: 45, start: 0, length: 1 }]);
  });

  it('cuts a note that overlaps the next one', () => {
    const q = quantizeNotes([raw(40, 0, 0.9), raw(42, 0.5, 1.0)], meter, 0.5, 8);
    expect(strip(q)).toEqual([
      { pitch: 40, start: 0, length: 1 },
      { pitch: 42, start: 1, length: 1 },
    ]);
  });

  it('pulls slightly early notes onto beat 1 and clips at the end of the take', () => {
    const q = quantizeNotes([raw(40, -0.08, 0.5), raw(41, 3.8, 4.4), raw(42, 4.1, 4.3)], meter, 0.5, 8);
    expect(strip(q)).toEqual([
      { pitch: 40, start: 0, length: 1 },
      { pitch: 41, start: 7.5, length: 0.5 },
    ]);
  });
});

describe('note edits', () => {
  const base: Note[] = [
    { id: 1, pitch: 40, start: 0, length: 1 },
    { id: 2, pitch: 43, start: 2, length: 1 },
  ];

  it('transposes one note', () => {
    expect(transposeNote(base, 2, -1)[1].pitch).toBe(42);
    expect(transposeNote(base, 2, -1)[0]).toBe(base[0]);
  });

  it('resizes within limits', () => {
    expect(resizeNote(base, 1, 0.5, 0.5, 8)[0].length).toBe(1.5);
    expect(resizeNote(base, 1, 5, 0.5, 8)[0].length).toBe(2); // stops at next note
    expect(resizeNote(base, 1, -5, 0.5, 8)[0].length).toBe(0.5); // at least one step
    expect(resizeNote(base, 2, 9, 0.5, 8)[1].length).toBe(6); // stops at end
  });

  it('moves without overlapping', () => {
    expect(moveNote(base, 1, 0.5, 8)[0].start).toBe(0.5);
    expect(moveNote(base, 1, 1.5, 8)).toBe(base); // would overlap note 2
    expect(moveNote(base, 1, -0.5, 8)).toBe(base); // before the take
    expect(moveNote(base, 2, 5, 8)[1].start).toBe(7);
  });

  it('deletes', () => {
    expect(deleteNote(base, 1).map((n) => n.id)).toEqual([2]);
  });
});

describe('fitOctave', () => {
  it('leaves a riff that fits alone', () => {
    expect(fitOctave([{ pitch: 45 }, { pitch: 52 }])).toBe(0);
  });
  it('drops a high (whistled / higher voice) riff into range', () => {
    expect(fitOctave([{ pitch: 84 }, { pitch: 88 }])).toBe(-1);
    expect(fitOctave([{ pitch: 96 }, { pitch: 100 }])).toBe(-2);
  });
  it('raises a riff hummed below the low E', () => {
    expect(fitOctave([{ pitch: 33 }, { pitch: 38 }])).toBe(1);
  });
  it('respects a custom range (e.g. drop C)', () => {
    expect(fitOctave([{ pitch: 37 }], { low: 36, high: 75 })).toBe(0);
  });
});
