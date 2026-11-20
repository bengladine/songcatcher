import { GRID, OCTAVE_MAX, OCTAVE_MIN, type GridName } from '../music/notes';

interface Props {
  grid: GridName;
  onGrid(g: GridName): void;
  octave: number;
  onOctave(o: number): void;
  onFit(): void;
  hasSelection: boolean;
  onEdit(action: EditAction): void;
  disabled: boolean;
}

export type EditAction = 'down' | 'up' | 'earlier' | 'later' | 'shorter' | 'longer' | 'delete';

const EDITS: { action: EditAction; icon: string; label: string }[] = [
  { action: 'down', icon: '▼', label: 'Down' },
  { action: 'up', icon: '▲', label: 'Up' },
  { action: 'earlier', icon: '←', label: 'Earlier' },
  { action: 'later', icon: '→', label: 'Later' },
  { action: 'shorter', icon: '−', label: 'Shorter' },
  { action: 'longer', icon: '+', label: 'Longer' },
  { action: 'delete', icon: '✕', label: 'Delete' },
];

export function NotesToolbar(p: Props) {
  const fmt = (o: number) => (o > 0 ? `+${o}` : String(o));
  return (
    <div className="notes-toolbar">
      <div className="row tight">
        <div className="segmented small" role="radiogroup" aria-label="Grid">
          {(Object.keys(GRID) as GridName[]).map((g) => (
            <button
              key={g}
              role="radio"
              aria-checked={p.grid === g}
              className={p.grid === g ? 'on' : ''}
              disabled={p.disabled}
              onClick={() => p.onGrid(g)}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="stepper small" aria-label="Octave">
          <button disabled={p.disabled || p.octave <= OCTAVE_MIN} onClick={() => p.onOctave(p.octave - 1)} aria-label="Octave down">
            −
          </button>
          <span className="stepper-value" title="Octave shift">
            Oct {fmt(p.octave)}
          </span>
          <button disabled={p.disabled || p.octave >= OCTAVE_MAX} onClick={() => p.onOctave(p.octave + 1)} aria-label="Octave up">
            +
          </button>
        </div>
        <button className="pill" disabled={p.disabled} onClick={p.onFit}>
          Fit guitar
        </button>
      </div>
      {p.hasSelection ? (
        <div className="edit-row">
          {EDITS.map((e) => (
            <button
              key={e.action}
              disabled={p.disabled}
              className={e.action === 'delete' ? 'danger' : ''}
              onClick={() => p.onEdit(e.action)}
            >
              <span className="icon">{e.icon}</span>
              <span className="cap">{e.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="hint edit-hint">Tap a note to edit it.</p>
      )}
    </div>
  );
}
