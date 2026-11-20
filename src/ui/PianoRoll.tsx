import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Note } from '../music/notes';
import { freqToMidi, midiToName } from '../music/pitch';
import { beatDuration, type Meter } from '../music/timing';

interface Props {
  notes: readonly Note[];
  /** Octave offset applied for display/playback. */
  octave: number;
  meter: Meter;
  bars: number;
  grid: number;
  /** Raw pitch contour drawn faintly behind the notes. */
  frames: readonly { t: number; freq: number | null }[];
  /** Singer's tuning offset (semitones); the contour is shifted by it so it lines up with the rows. */
  tuningOffset: number;
  selectedId: number | null;
  onSelect(id: number | null): void;
  playhead: () => number | null;
  live: boolean;
}

const MIN_ROW_H = 26;
const LABEL_W = 38;
const MIN_STEP_W = 30; // keeps every grid step a usable tap target

const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

export function PianoRoll({
  notes,
  octave,
  meter,
  bars,
  grid,
  frames,
  tuningOffset,
  selectedId,
  onSelect,
  playhead,
  live,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<SVGLineElement>(null);
  const [avail, setAvail] = useState(320);
  const [availH, setAvailH] = useState(300);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => {
      setAvail(el.clientWidth - LABEL_W);
      setAvailH(el.clientHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shift = 12 * octave;
  const pitches = notes.map((n) => n.pitch + shift);
  let lo = pitches.length ? Math.min(...pitches) - 2 : 40;
  let hi = pitches.length ? Math.max(...pitches) + 2 : 52;
  while (hi - lo < 12) {
    hi++;
    if (hi - lo < 12) lo--;
  }
  const rows = hi - lo + 1;
  // Fill the available height; scroll vertically only when the riff spans a wide range.
  const ROW_H = Math.max(MIN_ROW_H, Math.floor(availH / rows));
  const totalBeats = bars * meter.beatsPerBar;
  const steps = Math.round(totalBeats / grid);
  const stepW = Math.max(MIN_STEP_W, avail / steps);
  const width = steps * stepW;
  const height = rows * ROW_H;
  const bx = (beats: number) => (beats / grid) * stepW;
  const ry = (m: number) => (hi - m) * ROW_H;

  // Scroll the selected/first note into view vertically when the range changes.
  useEffect(() => {
    const el = scrollRef.current!;
    if (pitches.length) el.scrollTop = Math.max(0, ry(Math.max(...pitches)) - ROW_H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lo, hi]);

  // Playhead without re-rendering React; follow it horizontally.
  useEffect(() => {
    let raf = 0;
    const beat = beatDuration(meter);
    const tick = () => {
      const t = playhead();
      const line = headRef.current!;
      const el = scrollRef.current!;
      if (t === null || t < 0 || !live) {
        line.style.display = 'none';
      } else {
        const x = bx(t / beat);
        line.style.display = '';
        line.setAttribute('x1', String(x));
        line.setAttribute('x2', String(x));
        const visible = el.clientWidth - LABEL_W;
        if (x > el.scrollLeft + visible * 0.8 || x < el.scrollLeft) {
          el.scrollLeft = Math.max(0, x - visible * 0.2);
        }
      }
      if (live) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, live, meter, stepW, grid]);

  // Faint raw contour (seconds → beats), broken at gaps.
  const beat = beatDuration(meter);
  let contour = '';
  let prevT = -Infinity;
  for (const f of frames) {
    if (f.freq === null || f.t < 0) {
      prevT = -Infinity;
      continue;
    }
    const x = bx(f.t / beat);
    const y = ry(freqToMidi(f.freq) - tuningOffset + shift) + ROW_H / 2;
    contour += `${f.t - prevT > 0.03 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    prevT = f.t;
  }

  const rowEls = [];
  const labelEls = [];
  for (let m = hi; m >= lo; m--) {
    rowEls.push(
      <rect key={m} x={0} y={ry(m)} width={width} height={ROW_H} className={isBlack(m) ? 'row-black' : 'row-white'} />,
    );
    labelEls.push(
      <div key={m} className={`roll-label ${isBlack(m) ? 'black' : ''}`} style={{ height: ROW_H }}>
        {midiToName(m)}
      </div>,
    );
  }
  const lines = [];
  for (let s = 0; s <= steps; s++) {
    const b = s * grid;
    const cls = b % meter.beatsPerBar === 0 ? 'bar-line' : Number.isInteger(b) ? 'beat-line' : 'step-line';
    lines.push(<line key={s} x1={bx(b)} x2={bx(b)} y1={0} y2={height} className={cls} />);
  }

  return (
    <div className="roll-scroll" ref={scrollRef}>
      <div className="roll-inner" style={{ width: width + LABEL_W }}>
        <div className="roll-labels" style={{ width: LABEL_W }}>
          {labelEls}
        </div>
        <svg width={width} height={height} className="roll-svg" onClick={() => onSelect(null)}>
          {rowEls}
          {lines}
          <path d={contour} className="roll-contour" />
          {notes.map((n) => {
            const p = n.pitch + shift;
            const w = bx(n.length) - 2;
            const sel = n.id === selectedId;
            return (
              <g
                key={n.id}
                className={`roll-note ${sel ? 'selected' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(sel ? null : n.id);
                }}
              >
                {/* Invisible, taller hit area: thumbs are bigger than rows. */}
                <rect x={bx(n.start)} y={ry(p) - 6} width={Math.max(w, 24)} height={ROW_H + 12} fill="transparent" />
                <rect x={bx(n.start) + 1} y={ry(p) + 2} width={w} height={ROW_H - 4} rx={5} />
                {w > 30 && (
                  <text x={bx(n.start) + 7} y={ry(p) + ROW_H / 2 + 1}>
                    {midiToName(p)}
                  </text>
                )}
              </g>
            );
          })}
          <line ref={headRef} y1={0} y2={height} className="roll-head" style={{ display: 'none' }} />
        </svg>
      </div>
    </div>
  );
}
