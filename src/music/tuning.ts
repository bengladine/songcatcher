import type { RawNote } from './segment';

/**
 * How far (in semitones, −0.5…+0.5) the singer's personal "A" sits from A440.
 *
 * Humming without a reference, people drift as a whole: a riff sung 40 cents flat is still the
 * right riff, but rounding each note to A440 independently sends some notes down a semitone and
 * not others, which bends the intervals. So we estimate one offset for the take and round
 * relative to it.
 *
 * Pitch is circular mod 1 semitone (−0.49 and +0.49 are neighbours), so this is a circular mean
 * of each note's fractional pitch, weighted by note length (long notes are sung more steadily).
 * If the notes don't agree on an offset (resultant vector short), return 0 rather than guess.
 */
export function estimateTuningOffset(notes: readonly RawNote[], minAgreement = 0.3): number {
  let x = 0;
  let y = 0;
  let total = 0;
  for (const n of notes) {
    const w = Math.max(0, n.end - n.start);
    const a = 2 * Math.PI * n.rawPitch;
    x += w * Math.cos(a);
    y += w * Math.sin(a);
    total += w;
  }
  if (total === 0 || Math.hypot(x, y) < minAgreement * total) return 0;
  return Math.atan2(y, x) / (2 * Math.PI);
}

/** Re-round each note's pitch relative to `offset` semitones. */
export function retune(notes: readonly RawNote[], offset: number): RawNote[] {
  return notes.map((n) => ({ ...n, pitch: Math.round(n.rawPitch - offset) }));
}
