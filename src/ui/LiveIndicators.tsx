import { useEffect, useRef } from 'react';
import type { PitchFrame } from '../audio/engine';
import { freqToMidi, midiToName } from '../music/pitch';
import { beatDuration, type Meter } from '../music/timing';

/**
 * Beat dots + "count-in / bar" label. Updates its own DOM from requestAnimationFrame
 * so the rest of the app doesn't re-render 60×/s.
 */
export function BeatIndicator({
  meter,
  bars,
  playhead,
  live,
}: {
  meter: Meter;
  bars: number;
  playhead: () => number | null;
  live: boolean;
}) {
  const dotsRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = playhead();
      const dots = dotsRef.current!.children;
      const label = labelRef.current!;
      let lit = -1;
      if (t === null || !live) {
        label.textContent = 'Ready';
        label.className = 'beat-label';
      } else {
        const beatIdx = Math.floor(t / beatDuration(meter) + 1e-6);
        const inBar = ((beatIdx % meter.beatsPerBar) + meter.beatsPerBar) % meter.beatsPerBar;
        lit = inBar;
        if (beatIdx < 0) {
          label.textContent = String(-beatIdx);
          label.className = 'beat-label countin';
        } else {
          const bar = Math.floor(beatIdx / meter.beatsPerBar) + 1;
          label.textContent = bar <= bars ? `Bar ${bar} / ${bars}` : 'Done';
          label.className = 'beat-label rec';
        }
      }
      for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i === lit);
      if (live) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [meter, bars, playhead, live]);

  return (
    <div className="beat-indicator">
      <div className="beat-dots" ref={dotsRef}>
        {Array.from({ length: meter.beatsPerBar }, (_, i) => (
          <span key={i} className={i === 0 ? 'dot accent' : 'dot'} />
        ))}
      </div>
      <div className="beat-label" ref={labelRef} aria-live="polite">
        Ready
      </div>
    </div>
  );
}

/** Most recent detected note, e.g. "D3 · 146.8 Hz". */
export function NoteReadout({ frames, live }: { frames: readonly PitchFrame[]; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const last = frames[frames.length - 1];
      const el = ref.current!;
      if (last && last.freq !== null) {
        const m = freqToMidi(last.freq);
        const cents = Math.round((m - Math.round(m)) * 100);
        el.textContent = `${midiToName(m)} ${cents >= 0 ? '+' : ''}${cents}¢ · ${last.freq.toFixed(1)} Hz`;
      } else {
        el.textContent = live ? '—' : '';
      }
      if (live) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [frames, live]);
  return <div className="note-readout" ref={ref} />;
}
