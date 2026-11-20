/** Tempo/meter description of a take. Times are in seconds. */
export interface Meter {
  bpm: number;
  beatsPerBar: number;
}

export function beatDuration(m: Meter): number {
  return 60 / m.bpm;
}

export function barDuration(m: Meter): number {
  return beatDuration(m) * m.beatsPerBar;
}

export interface Click {
  /** Seconds relative to the downbeat of the first recorded bar (count-in clicks are negative). */
  time: number;
  /** Downbeat of a bar → accented click. */
  accent: boolean;
  /** True while in the count-in. */
  countIn: boolean;
}

/**
 * Every metronome click for a take: `countInBars` bars before 0, then `bars` bars of recording.
 * Pure so it can be shared by the audio scheduler, the beat indicator and the click gate.
 */
export function clickSchedule(m: Meter, countInBars: number, bars: number): Click[] {
  const beat = beatDuration(m);
  const clicks: Click[] = [];
  const firstBeat = -countInBars * m.beatsPerBar;
  const lastBeat = bars * m.beatsPerBar; // exclusive
  for (let b = firstBeat; b < lastBeat; b++) {
    clicks.push({
      time: b * beat,
      accent: ((b % m.beatsPerBar) + m.beatsPerBar) % m.beatsPerBar === 0,
      countIn: b < 0,
    });
  }
  return clicks;
}

/**
 * Click-bleed gate. When the metronome comes out of the phone speaker it leaks into the mic,
 * and a click is a sharp broadband transient that the pitch detector happily reports as a
 * (random) pitch. Clicks are on a known grid, so instead of trying to filter them out we just
 * distrust any analysis window that overlaps [click - before, click + after].
 * `after` is longer than the click itself (≈30 ms) to cover room reverb / speaker ring.
 *
 * Window and click times must be on the same (latency-corrected) timeline.
 */
export function overlapsClick(
  windowStart: number,
  windowEnd: number,
  clickTimes: readonly number[],
  before = 0.01,
  after = 0.06,
): boolean {
  // Click lists are tiny (≤ a few hundred), linear scan is fine.
  for (const c of clickTimes) {
    if (windowEnd >= c - before && windowStart <= c + after) return true;
  }
  return false;
}
