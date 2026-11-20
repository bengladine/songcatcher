import { freqToMidi } from './pitch';

/** The subset of a pitch-track frame segmentation needs (structurally matches audio PitchFrame). */
export interface TrackFrame {
  /** Window centre, seconds on the take timeline. */
  t: number;
  freq: number | null;
  rms: number;
  /** Pitch was discarded because a metronome click overlapped this window. */
  gated?: boolean;
}

/** A detected note before quantization. Times in seconds on the take timeline. */
export interface RawNote {
  /** Rounded MIDI pitch. */
  pitch: number;
  /** Median un-rounded MIDI pitch (to show how in-tune the hum was). */
  rawPitch: number;
  start: number;
  end: number;
}

export interface SegmentOptions {
  /** Shorter notes are discarded (blips, consonants, octave glitches). */
  minNoteDuration: number;
  /**
   * Pieces shorter than this that run straight into a neighbouring note within ±maxGlide
   * semitones are treated as a slide into / out of that note (scoops, fall-offs) and merged.
   */
  glideDuration: number;
  maxGlide: number;
  /** A sustained move by more than this many semitones from the note's pitch starts a new note. */
  splitSemitones: number;
  /** …sustained for at least this long (seconds). Shorter excursions are treated as wobble. */
  splitHold: number;
  /** Unvoiced gaps up to this long don't end a note (hummed consonants, detector dropouts). */
  maxGap: number;
  /** Gated (click) gaps up to this long are bridged: we simply don't know what happened there. */
  maxGatedGap: number;
  /**
   * An RMS dip at least this deep (dB) inside a voiced run = the same pitch sung again.
   * Deliberately deep (≈ near-silence): a held note that merely gets quieter stays one note.
   */
  onsetDb: number;
  /**
   * Around a metronome click the level isn't trustworthy (phone echo cancellation ducks the
   * voice while the click plays), so level dips this long before/after a gated window are
   * ignored.
   */
  clickDuckBefore: number;
  clickDuckAfter: number;
  /** Frames quieter than (take peak − silenceDb) count as silence. */
  silenceDb: number;
  /** Median filter length (frames, odd) applied to the pitch contour. */
  medianFrames: number;
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  minNoteDuration: 0.07,
  glideDuration: 0.12,
  maxGlide: 3,
  splitSemitones: 0.6,
  splitHold: 0.06,
  maxGap: 0.04,
  maxGatedGap: 0.16,
  onsetDb: 12,
  clickDuckBefore: 0.03,
  clickDuckAfter: 0.12,
  silenceDb: 35,
  medianFrames: 5,
};

const toDb = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

/**
 * Pitch track → notes.
 *
 * 1. Frames → continuous MIDI; frames far below the take's peak level count as silence.
 * 2. Median filter: removes single-frame octave errors (MPM's typical failure) without
 *    smearing real note changes the way a moving average would.
 * 3. Walk the contour: a note continues while the pitch stays within ±splitSemitones of the
 *    note's median; a deviation held for splitHold starts a new note (vibrato/scoops don't).
 *    Short unvoiced gaps are bridged, longer ones end the note.
 * 4. Inside each note, a deep RMS valley = the same pitch re-sung ("da-da-da") → split there.
 * 5. Clean up what a real voice does between notes (see tidyNotes): slides into and out of
 *    notes join the note they lead to, a held note broken up by a wobble is glued back
 *    together, then leftovers shorter than minNoteDuration are dropped.
 */
export function segmentNotes(
  frames: readonly TrackFrame[],
  options: Partial<SegmentOptions> = {},
): RawNote[] {
  const o = { ...DEFAULT_SEGMENT_OPTIONS, ...options };
  const n = frames.length;
  if (n < 2) return [];
  const hop = medianDiff(frames);

  const peakDb = toDb(Math.max(...frames.map((f) => (f.gated ? 0 : f.rms))));
  const floorDb = peakDb - o.silenceDb;
  const db = frames.map((f) => toDb(f.rms));
  const raw: (number | null)[] = frames.map((f, i) =>
    f.freq !== null && f.freq > 0 && db[i] >= floorDb ? freqToMidi(f.freq) : null,
  );
  const midi = medianFilter(raw, o.medianFrames);

  // --- 3. pitch-continuity segmentation -------------------------------------------------------
  type Seg = { i0: number; i1: number; pitches: number[]; onset: Onset };
  const segs: Seg[] = [];
  let cur: Seg | null = null;
  let unvoicedTime = 0; // non-gated unvoiced time since last voiced frame
  let gatedTime = 0;
  let devStart = -1; // index where a sustained deviation began
  let devPitches: number[] = [];
  const holdFrames = Math.max(1, Math.round(o.splitHold / hop));

  let lastVoiced = -1;
  const close = () => {
    // Frames still sliding when the note ends (a fall-off) count towards its length, not pitch.
    if (cur) segs.push({ ...cur, i1: Math.max(cur.i1, lastVoiced) });
    cur = null;
    devStart = -1;
    devPitches = [];
  };

  for (let i = 0; i < n; i++) {
    const m = midi[i];
    if (m === null) {
      if (!cur) continue;
      if (frames[i].gated) gatedTime += hop;
      else unvoicedTime += hop;
      if (unvoicedTime > o.maxGap || gatedTime > o.maxGatedGap) close();
      continue;
    }
    unvoicedTime = 0;
    gatedTime = 0;
    lastVoiced = i;
    if (!cur) {
      cur = { i0: i, i1: i, pitches: [m], onset: 'gap' };
      continue;
    }
    const ref = median(cur.pitches);
    if (Math.abs(m - ref) > o.splitSemitones) {
      if (devStart < 0 || Math.abs(m - median(devPitches)) > o.splitSemitones) {
        devStart = i;
        devPitches = [];
      }
      devPitches.push(m);
      if (devPitches.length >= holdFrames) {
        const next: Seg = { i0: devStart, i1: i, pitches: devPitches, onset: 'pitch' };
        // Legato: the old note lasts until the new one starts (the slide between them
        // belongs to the old note's length, not its pitch).
        segs.push({ ...cur, i1: devStart - 1 });
        cur = next;
        devStart = -1;
        devPitches = [];
      }
    } else {
      devStart = -1;
      devPitches = [];
      cur.pitches.push(m);
      cur.i1 = i;
    }
  }
  close();

  // --- 4. energy re-articulation splits -------------------------------------------------------
  const out: Piece[] = [];
  const valleyWin = 3;
  const peakWin = Math.max(4, Math.round(0.1 / hop));
  const minFrames = Math.max(1, Math.round(o.minNoteDuration / hop));
  const nearClick = markNearGated(frames, o.clickDuckBefore, o.clickDuckAfter);
  const usableDb = (i: number) => (nearClick[i] ? NaN : db[i]);

  for (const s of segs) {
    const cuts = [s.i0];
    for (let j = s.i0 + minFrames; j <= s.i1 - minFrames; j++) {
      const v = usableDb(j);
      if (Number.isNaN(v)) continue;
      let isMin = true;
      for (let k = Math.max(s.i0, j - valleyWin); k <= Math.min(s.i1, j + valleyWin); k++) {
        const u = usableDb(k);
        if (k !== j && !Number.isNaN(u) && u < v) isMin = false;
      }
      if (!isMin) continue;
      const before = maxOf(usableDb, Math.max(cuts[cuts.length - 1], j - peakWin), j);
      const after = maxOf(usableDb, j, Math.min(s.i1, j + peakWin));
      if (Math.min(before, after) - v >= o.onsetDb && j - cuts[cuts.length - 1] >= minFrames) {
        cuts.push(j + 1); // the new note starts as the level rises again
        j += minFrames;
      }
    }
    cuts.push(s.i1 + 1);
    for (let c = 0; c + 1 < cuts.length; c++) {
      const onset: Onset = c === 0 ? s.onset : 'energy';
      const a = cuts[c];
      const b = cuts[c + 1] - 1;
      const ps: number[] = [];
      for (let i = a; i <= b; i++) {
        const m = midi[i];
        if (m !== null && Math.abs(m - median(s.pitches)) <= o.splitSemitones) ps.push(m);
      }
      if (!ps.length) continue;
      const start = frames[a].t;
      const end = frames[b].t + hop;
      let voiced = 0;
      for (let i = a; i <= b; i++) if (midi[i] !== null) voiced += hop;
      out.push({ rawPitch: median(ps), start, end, onset, voiced });
    }
  }
  // Two pieces "touch" if the gap between them is short, or consists only of click-gated
  // windows (we can't hear what happened there, so assume the voice carried on).
  const bridgeable = (t0: number, t1: number) => {
    if (t1 - t0 <= o.maxGap + 1.5 * hop) return true;
    if (t1 - t0 > o.maxGatedGap + 1.5 * hop) return false;
    let ungated = 0;
    for (const f of frames) if (f.t >= t0 && f.t < t1 && !f.gated) ungated += hop;
    return ungated <= o.maxGap;
  };
  return tidyNotes(out, bridgeable, o).map(({ rawPitch, start, end }) => ({
    pitch: Math.round(rawPitch),
    rawPitch,
    start,
    end,
  }));
}

/** Why a piece started: after silence, on a pitch change, or on a level re-attack. */
type Onset = 'gap' | 'pitch' | 'energy';
interface Piece {
  rawPitch: number;
  start: number;
  end: number;
  onset: Onset;
  /** Seconds actually heard (excludes click gaps / dropouts inside the span). */
  voiced: number;
}

/**
 * Voices don't jump cleanly between notes: they slide in from below, wobble, and fall off at
 * the end. Pitch segmentation turns each of those into a short extra piece. Repair:
 *  - a short piece glued to a longer, nearby-pitched neighbour is a slide → merge into it
 *    (prefer the following note: scoops into a note are more common than fall-offs);
 *  - two touching pieces at the same pitch split only by a pitch excursion → one note
 *    (re-attacks after an energy dip or silence stay separate: those are re-sung notes);
 *  - anything still shorter than minNoteDuration is dropped.
 */
function tidyNotes(
  pieces: Piece[],
  bridgeable: (t0: number, t1: number) => boolean,
  o: SegmentOptions,
): Piece[] {
  const ps = pieces.map((p) => ({ ...p }));
  const dur = (p: Piece) => p.voiced;
  const touching = (a: Piece, b: Piece) => bridgeable(a.end, b.start);
  const near = (a: Piece, b: Piece) => Math.abs(a.rawPitch - b.rawPitch) <= o.maxGlide;

  let changed = true;
  while (changed) {
    changed = false;
    // Shortest first, so a wobble between two halves of a note is absorbed before the halves
    // are compared.
    const order = ps.map((_, i) => i).sort((a, b) => dur(ps[a]) - dur(ps[b]));
    for (const i of order) {
      const p = ps[i];
      if (dur(p) >= o.glideDuration) break;
      const next = ps[i + 1];
      const prev = ps[i - 1];
      if (next && next.onset !== 'energy' && touching(p, next) && near(p, next) && dur(next) >= dur(p)) {
        next.start = p.start;
        next.onset = p.onset;
        next.voiced += p.voiced;
      } else if (prev && p.onset !== 'energy' && touching(prev, p) && near(prev, p) && dur(prev) >= dur(p)) {
        prev.end = p.end;
        prev.voiced += p.voiced;
      } else continue;
      ps.splice(i, 1);
      changed = true;
      break;
    }
    if (changed) continue;
    for (let i = 0; i + 1 < ps.length; i++) {
      const a = ps[i];
      const b = ps[i + 1];
      // Same pitch, no real silence in between → it was one held note.
      if (b.onset !== 'energy' && touching(a, b) && Math.abs(a.rawPitch - b.rawPitch) < 0.5) {
        a.rawPitch = (a.rawPitch * dur(a) + b.rawPitch * dur(b)) / (dur(a) + dur(b));
        a.end = b.end;
        a.voiced += b.voiced;
        ps.splice(i + 1, 1);
        changed = true;
        break;
      }
    }
  }
  return ps.filter((p) => p.end - p.start >= o.minNoteDuration && p.voiced >= o.minNoteDuration * 0.6);
}

function markNearGated(frames: readonly TrackFrame[], before: number, after: number): boolean[] {
  const mark = frames.map(() => false);
  let j = 0;
  for (let i = 0; i < frames.length; i++) {
    if (!frames[i].gated) continue;
    const t = frames[i].t;
    while (j < frames.length && frames[j].t < t - before) j++;
    for (let k = j; k < frames.length && frames[k].t <= t + after; k++) mark[k] = true;
  }
  return mark;
}

function maxOf(f: (i: number) => number, a: number, b: number): number {
  let m = -Infinity;
  for (let i = a; i <= b; i++) {
    const v = f(i);
    if (!Number.isNaN(v) && v > m) m = v;
  }
  return m;
}

function medianDiff(frames: readonly TrackFrame[]): number {
  const d: number[] = [];
  for (let i = 1; i < Math.min(frames.length, 64); i++) d.push(frames[i].t - frames[i - 1].t);
  return median(d) || 512 / 48000;
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

/** Median over voiced neighbours; unvoiced frames stay unvoiced. */
export function medianFilter(xs: readonly (number | null)[], size: number): (number | null)[] {
  const r = size >> 1;
  return xs.map((x, i) => {
    if (x === null) return null;
    const w: number[] = [];
    for (let k = Math.max(0, i - r); k <= Math.min(xs.length - 1, i + r); k++) {
      const v = xs[k];
      if (v !== null) w.push(v);
    }
    return median(w);
  });
}
