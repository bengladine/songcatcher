import { describe, expect, it } from 'vitest';
import { freqToMidi, midiToFreq, midiToName } from './pitch';

describe('pitch helpers', () => {
  it('maps frequencies to MIDI', () => {
    expect(freqToMidi(440)).toBeCloseTo(69);
    expect(freqToMidi(82.4069)).toBeCloseTo(40, 3); // low E string
    expect(midiToFreq(freqToMidi(123.4))).toBeCloseTo(123.4);
  });

  it('names notes', () => {
    expect(midiToName(40)).toBe('E2');
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(37)).toBe('C#2');
    expect(midiToName(38.4)).toBe('D2');
  });
});
