import type { RawNote } from './segment';
import { beatDuration, type Meter } from './timing';

/** A quantized, editable note. Times are in beats from the downbeat of bar 1. */
export interface Note {
  id: number;
  /** MIDI pitch as sung (before the octave offset). */
  pitch: number;
  start: number;
  length: number;
}

/** Grid sizes in beats (quarter-note beats in 4/4). */
export const GRID = { '1/8': 0.5, '1/16': 0.25 } as const;
export type GridName = keyof typeof GRID;

let idCounter = 1;
export const newNoteId = () => idCounter++;

const EPS = 1e-9;

/**
 * Snap raw notes to the grid.
 * Start and end are rounded independently (so a note held "to the next eighth" keeps its
 * length), every note is at least one grid step, and the result is strictly monophonic:
 * if two notes land on the same step the longer one (as sung) wins, and a note that runs
 * into the next one is cut at its start.
 */
export function quantizeNotes(
  raw: readonly RawNote[],
  meter: Meter,
  grid: number,
  totalBeats: number,
): Note[] {
  const beat = beatDuration(meter);
  const snap = (sec: number) => Math.round(sec / beat / grid) * grid;

  const cands = raw
    .map((r) => {
      const start = Math.max(0, snap(r.start));
      const end = Math.min(totalBeats, Math.max(snap(r.end), start + grid));
      return { pitch: r.pitch, start, end, weight: r.end - r.start };
    })
    .filter((c) => c.start < totalBeats - EPS && c.end - c.start > EPS)
    .sort((a, b) => a.start - b.start || b.weight - a.weight);

  const out: Note[] = [];
  for (const c of cands) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.start - c.start) < EPS) continue; // same slot: keep the heavier one
    if (prev && prev.start + prev.length > c.start) prev.length = c.start - prev.start;
    out.push({ id: newNoteId(), pitch: c.pitch, start: c.start, length: c.end - c.start });
  }
  return out;
}

// ---- edits (pure; return a new array, or the same array if the edit isn't possible) ----------

function neighbours(notes: readonly Note[], id: number) {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const i = sorted.findIndex((n) => n.id === id);
  return { note: sorted[i], prev: sorted[i - 1], next: sorted[i + 1] };
}

const replace = (notes: readonly Note[], n: Note) => notes.map((x) => (x.id === n.id ? n : x));

export function transposeNote(notes: readonly Note[], id: number, semitones: number): readonly Note[] {
  const n = notes.find((x) => x.id === id);
  if (!n) return notes;
  const pitch = Math.max(0, Math.min(127, n.pitch + semitones));
  return pitch === n.pitch ? notes : replace(notes, { ...n, pitch });
}

/** Lengthen/shorten by `delta` beats. Can't go below one grid step or past the next note / end. */
export function resizeNote(
  notes: readonly Note[],
  id: number,
  delta: number,
  grid: number,
  totalBeats: number,
): readonly Note[] {
  const { note, next } = neighbours(notes, id);
  if (!note) return notes;
  const limit = next ? next.start : totalBeats;
  const length = Math.min(limit - note.start, Math.max(grid, note.length + delta));
  return Math.abs(length - note.length) < EPS ? notes : replace(notes, { ...note, length });
}

/** Shift in time by `delta` beats without overlapping neighbours or leaving the take. */
export function moveNote(
  notes: readonly Note[],
  id: number,
  delta: number,
  totalBeats: number,
): readonly Note[] {
  const { note, prev, next } = neighbours(notes, id);
  if (!note) return notes;
  const start = note.start + delta;
  const lo = prev ? prev.start + prev.length : 0;
  const hi = (next ? next.start : totalBeats) - note.length;
  if (start < lo - EPS || start > hi + EPS) return notes;
  return replace(notes, { ...note, start });
}

export function deleteNote(notes: readonly Note[], id: number): readonly Note[] {
  return notes.filter((n) => n.id !== id);
}

// ---- octave -----------------------------------------------------------------------------------

export interface PitchRange {
  low: number;
  high: number;
}

/**
 * Standard-tuned guitar, open low E (E2) up to the 15th fret on the high E string — where
 * riffs actually live. Milestone 3 derives this from the chosen tuning instead.
 */
export const GUITAR_RANGE: PitchRange = { low: 40, high: 79 };

export const OCTAVE_MIN = -2;
export const OCTAVE_MAX = 2;

/**
 * Octave offset (−2…+2) that puts the most of the riff inside `range`.
 * Cost = semitones outside the range summed over notes; ties go to the smallest shift
 * (don't move what already fits), then downward (riffs sit low on the neck).
 */
export function fitOctave(notes: readonly Pick<Note, 'pitch'>[], range: PitchRange = GUITAR_RANGE): number {
  let best = 0;
  let bestCost = Infinity;
  const order = [0, -1, 1, -2, 2];
  for (const k of order) {
    let cost = 0;
    for (const n of notes) {
      const p = n.pitch + 12 * k;
      if (p < range.low) cost += range.low - p;
      else if (p > range.high) cost += p - range.high;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = k;
    }
  }
  return best;
}
