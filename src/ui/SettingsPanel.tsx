import type { Settings } from './settings';

const BAR_OPTIONS = [1, 2, 4, 8];

interface Props {
  settings: Settings;
  update(patch: Partial<Settings>): void;
  busy: boolean;
  open: boolean;
  onToggle(): void;
  lastLatency: number | null;
}

/** Recording setup. Collapses to a one-line summary so the notes get the screen. */
export function SettingsPanel({ settings, update, busy, open, onToggle, lastLatency }: Props) {
  const clampBpm = (v: number) => Math.max(30, Math.min(300, Math.round(v)));
  return (
    <section className="card controls">
      <button className="summary" onClick={onToggle} aria-expanded={open}>
        <span>
          <strong>{settings.bpm}</strong> BPM · 4/4 · {settings.bars} bar{settings.bars > 1 ? 's' : ''} ·{' '}
          {settings.headphones ? '🎧' : '🔊'}
        </span>
        <span className={`chev ${open ? 'open' : ''}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <>
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
            <span className="unit">BPM</span>
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
            <span className="unit">
              {settings.latencyAdjustMs > 0 ? '+' : ''}
              {settings.latencyAdjustMs} ms
            </span>
          </label>
          <p className="hint">
            Notes landing late on the grid → raise latency; early → lower it.
            {lastLatency !== null ? ` Last take: ${Math.round(lastLatency * 1000)} ms total.` : ''}
          </p>
        </>
      )}
    </section>
  );
}
