import { useCallback, useMemo, useRef, useState } from 'react';
import { AudioEngine, type PitchFrame, type Take } from '../audio/engine';
import type { Meter } from '../music/timing';
import { BeatIndicator, NoteReadout } from './LiveIndicators';
import { PitchView } from './PitchView';
import { useSettings } from './settings';

type Mode = 'idle' | 'starting' | 'recording' | 'playing';

const BAR_OPTIONS = [1, 2, 4, 8];
const BEATS_PER_BAR = 4; // 4/4 only for now
const COUNT_IN_BARS = 1;

export function App() {
  const engine = useMemo(() => new AudioEngine(), []);
  const [settings, update] = useSettings();
  const [mode, setMode] = useState<Mode>('idle');
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // Live frames are appended in place (no React state) and drawn by rAF.
  const [frames, setFrames] = useState<PitchFrame[]>([]);
  const originRef = useRef<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const meter: Meter = useMemo(() => ({ bpm: settings.bpm, beatsPerBar: BEATS_PER_BAR }), [settings.bpm]);
  const viewMeter = take?.meter ?? meter;
  const viewBars = mode === 'recording' || mode === 'starting' || !take ? settings.bars : take.bars;

  // What the user is hearing right now, on the take timeline.
  const playhead = useCallback(() => {
    const o = originRef.current;
    return o === null ? null : engine.now - o - engine.outputLatency;
  }, [engine]);

  const record = async () => {
    setError(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Microphone needs HTTPS. Open the GitHub Pages URL (or localhost).');
      return;
    }
    const live: PitchFrame[] = [];
    setFrames(live);
    setTake(null);
    setMode('starting');
    try {
      const handle = await engine.record({
        meter: { bpm: settings.bpm, beatsPerBar: BEATS_PER_BAR },
        bars: settings.bars,
        countInBars: COUNT_IN_BARS,
        clickVolume: settings.clickVolume,
        headphones: settings.headphones,
        gateClicks: !settings.headphones,
        latencyAdjust: settings.latencyAdjustMs / 1000,
        onFrame: (f) => live.push(f),
      });
      originRef.current = handle.origin;
      stopRef.current = handle.stop;
      setMode('recording');
      const t = await handle.done;
      setTake(t);
      setFrames(t.frames);
    } catch (e) {
      setError(describeError(e));
    } finally {
      originRef.current = null;
      stopRef.current = null;
      setMode('idle');
      setVersion((v) => v + 1);
    }
  };

  const play = async () => {
    if (!take) return;
    setError(null);
    try {
      const p = await engine.playTake(take, settings.clickVolume);
      originRef.current = p.origin;
      stopRef.current = p.stop;
      setMode('playing');
      await p.ended;
    } catch (e) {
      setError(describeError(e));
    } finally {
      originRef.current = null;
      stopRef.current = null;
      setMode('idle');
      setVersion((v) => v + 1);
    }
  };

  const stop = () => stopRef.current?.();
  const busy = mode !== 'idle';
  const live = mode === 'recording' || mode === 'playing';

  return (
    <div className="app">
      <header className="topbar">
        <h1>Songcatcher</h1>
        <NoteReadout frames={frames} live={mode === 'recording'} />
      </header>

      <section className="card controls" aria-disabled={busy}>
        <div className="row">
          <span className="label">Tempo</span>
          <div className="stepper">
            <button disabled={busy} onClick={() => update({ bpm: clampBpm(settings.bpm - 1) })} aria-label="Slower">
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={30}
              max={300}
              value={settings.bpm}
              disabled={busy}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) update({ bpm: v });
              }}
              onBlur={() => update({ bpm: clampBpm(settings.bpm) })}
              aria-label="BPM"
            />
            <button disabled={busy} onClick={() => update({ bpm: clampBpm(settings.bpm + 1) })} aria-label="Faster">
              +
            </button>
          </div>
          <span className="unit">BPM · 4/4</span>
        </div>

        <div className="row">
          <span className="label">Bars</span>
          <div className="segmented" role="radiogroup" aria-label="Bars to record">
            {BAR_OPTIONS.map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={settings.bars === n}
                className={settings.bars === n ? 'on' : ''}
                disabled={busy}
                onClick={() => update({ bars: n })}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <span className="label">Output</span>
          <div className="segmented" role="radiogroup" aria-label="Listening with">
            <button
              role="radio"
              aria-checked={settings.headphones}
              className={settings.headphones ? 'on' : ''}
              disabled={busy}
              onClick={() => update({ headphones: true })}
            >
              🎧 Headphones
            </button>
            <button
              role="radio"
              aria-checked={!settings.headphones}
              className={!settings.headphones ? 'on' : ''}
              disabled={busy}
              onClick={() => update({ headphones: false })}
            >
              🔊 Speaker
            </button>
          </div>
        </div>
        <p className="hint">
          {settings.headphones
            ? 'Best: the click stays out of the mic.'
            : 'Pitch right at each click is ignored. Headphones work better.'}
        </p>

        <details className="advanced">
          <summary>More</summary>
          <label className="row">
            <span className="label">Click</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.clickVolume}
              onChange={(e) => update({ clickVolume: Number(e.target.value) })}
            />
          </label>
          <label className="row">
            <span className="label">Latency</span>
            <input
              type="range"
              min={-100}
              max={250}
              step={5}
              value={settings.latencyAdjustMs}
              disabled={busy}
              onChange={(e) => update({ latencyAdjustMs: Number(e.target.value) })}
            />
            <span className="unit">{settings.latencyAdjustMs > 0 ? '+' : ''}{settings.latencyAdjustMs} ms</span>
          </label>
          <p className="hint">
            If notes land consistently late on the grid, raise latency; if early, lower it.
            {take ? ` Last take used ${Math.round(take.latency * 1000)} ms in total.` : ''}
          </p>
        </details>
      </section>

      <BeatIndicator meter={viewMeter} bars={viewBars} playhead={playhead} live={live} />

      <PitchView
        frames={frames}
        meter={viewMeter}
        bars={viewBars}
        playhead={playhead}
        live={live}
        version={version}
      />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <footer className="transport">
        <button
          className="secondary"
          disabled={!take || mode === 'recording' || mode === 'starting'}
          onClick={mode === 'playing' ? stop : play}
        >
          {mode === 'playing' ? '■ Stop' : '▶ Play take'}
        </button>
        <button
          className={`record ${mode === 'recording' || mode === 'starting' ? 'active' : ''}`}
          disabled={mode === 'playing' || mode === 'starting'}
          onClick={mode === 'recording' ? stop : record}
          aria-label={mode === 'recording' ? 'Stop recording' : 'Record'}
        >
          <span className="record-icon" />
          {mode === 'recording' ? 'Stop' : 'Record'}
        </button>
      </footer>
    </div>
  );
}

function clampBpm(v: number) {
  return Math.max(30, Math.min(300, Math.round(v)));
}

function describeError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError') return 'Microphone permission was denied. Allow it in the browser settings and try again.';
    if (e.name === 'NotFoundError') return 'No microphone found.';
  }
  return e instanceof Error ? e.message : String(e);
}
