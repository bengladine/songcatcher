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
  /** A sustained move by more than this many semitones from the note's pitch starts a new note. */
  splitSemitones: number;
  /** …sustained for at least this long (seconds). Shorter excursions are treated as wobble. */
  splitHold: number;
  /** Unvoiced gaps up to this long don't end a note (hummed consonants, detector dropouts). */
  maxGap: number;
  /** Gated (click) gaps up to this long are bridged: we simply don't know what happened there. */
  maxGatedGap: number;
  /** An RMS dip at least this deep (dB) inside a voiced run = re-articulation of the same pitch. */
  onsetDb: number;
  /** Frames quieter than (take peak − silenceDb) count as silence. */
  silenceDb: number;
  /** Median filter length (frames, odd) applied to the pitch contour. */
  medianFrames: number;
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  minNoteDuration: 0.07,
  splitSemitones: 0.6,
  splitHold: 0.03,
  maxGap: 0.04,
  maxGatedGap: 0.16,
  onsetDb: 6,
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
 * 5. Drop notes shorter than minNoteDuration; round pitch to the nearest semitone.
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
  type Seg = { i0: number; i1: number; pitches: number[] };
  const segs: Seg[] = [];
  let cur: Seg | null = null;
  let unvoicedTime = 0; // non-gated unvoiced time since last voiced frame
  let gatedTime = 0;
  let devStart = -1; // index where a sustained deviation began
  let devPitches: number[] = [];
  const holdFrames = Math.max(1, Math.round(o.splitHold / hop));

  const close = () => {
    if (cur) segs.push(cur);
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
    if (!cur) {
      cur = { i0: i, i1: i, pitches: [m] };
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
        const next: Seg = { i0: devStart, i1: i, pitches: devPitches };
        // The old note ends at its last in-tune frame before the deviation.
        if (cur.i1 >= cur.i0) segs.push(cur);
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
  const out: RawNote[] = [];
  const valleyWin = 3;
  const peakWin = Math.max(4, Math.round(0.1 / hop));
  const minFrames = Math.max(1, Math.round(o.minNoteDuration / hop));
  const usableDb = (i: number) => (frames[i].gated ? NaN : db[i]);

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
      if (end - start < o.minNoteDuration) continue;
      const rawPitch = median(ps);
      out.push({ pitch: Math.round(rawPitch), rawPitch, start, end });
    }
  }
  return out;
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
