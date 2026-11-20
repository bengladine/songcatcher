import { useCallback, useMemo, useRef, useState } from 'react';
import { AudioEngine, type Playback, type PitchFrame, type Take } from '../audio/engine';
import {
  deleteNote,
  fitOctave,
  GRID,
  moveNote,
  quantizeNotes,
  resizeNote,
  transposeNote,
  type GridName,
  type Note,
} from '../music/notes';
import { segmentNotes, type RawNote } from '../music/segment';
import { beatDuration, type Meter } from '../music/timing';
import { BeatIndicator, NoteReadout } from './LiveIndicators';
import { NotesToolbar, type EditAction } from './NotesToolbar';
import { PianoRoll } from './PianoRoll';
import { PitchView } from './PitchView';
import { SettingsPanel } from './SettingsPanel';
import { useSettings } from './settings';

type Mode = 'idle' | 'starting' | 'recording' | 'playing';
type View = 'notes' | 'pitch';

const BEATS_PER_BAR = 4; // 4/4 only for now
const COUNT_IN_BARS = 1;

export function App() {
  const engine = useMemo(() => new AudioEngine(), []);
  const [settings, update] = useSettings();
  const [mode, setMode] = useState<Mode>('idle');
  const [view, setView] = useState<View>('notes');
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const [take, setTake] = useState<Take | null>(null);
  // Live frames are appended in place while recording and drawn by rAF.
  const [frames, setFrames] = useState<PitchFrame[]>([]);
  const [rawNotes, setRawNotes] = useState<RawNote[]>([]);
  const [notes, setNotes] = useState<readonly Note[]>([]);
  const [edited, setEdited] = useState(false);
  const [octave, setOctave] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  const originRef = useRef<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const meter: Meter = useMemo(() => ({ bpm: settings.bpm, beatsPerBar: BEATS_PER_BAR }), [settings.bpm]);
  const recording = mode === 'recording' || mode === 'starting';
  const viewMeter = (!recording && take?.meter) || meter;
  const viewBars = recording || !take ? settings.bars : take.bars;
  const grid = GRID[settings.grid];
  const totalBeats = viewBars * BEATS_PER_BAR;

  // What the user is hearing right now, on the take timeline.
  const playhead = useCallback(() => {
    const o = originRef.current;
    return o === null ? null : engine.now - o - engine.outputLatency;
  }, [engine]);

  const runPlayback = async (start: () => Promise<Playback>) => {
    setError(null);
    try {
      const p = await start();
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

  const record = async () => {
    setError(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Microphone needs HTTPS. Open the GitHub Pages URL (or localhost).');
      return;
    }
    const live: PitchFrame[] = [];
    setFrames(live);
    setSelected(null);
    setView('pitch');
    setMode('starting');
    try {
      const handle = await engine.record({
        meter,
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
      const raw = segmentNotes(t.frames);
      setTake(t);
      setFrames(t.frames);
      setRawNotes(raw);
      setNotes(quantizeNotes(raw, t.meter, grid, t.bars * BEATS_PER_BAR));
      setEdited(false);
      setOctave(0);
      setView('notes');
      setSettingsOpen(false);
    } catch (e) {
      setError(describeError(e));
      if (take) setFrames(take.frames);
    } finally {
      originRef.current = null;
      stopRef.current = null;
      setMode('idle');
      setVersion((v) => v + 1);
    }
  };

  const play = () => {
    if (!take) return;
    if (view === 'pitch') return runPlayback(() => engine.playTake(take, settings.clickVolume));
    const beat = beatDuration(take.meter);
    const synth = notes.map((n) => ({
      pitch: n.pitch + 12 * octave,
      start: n.start * beat,
      duration: n.length * beat,
    }));
    return runPlayback(() => engine.playNotes(synth, take.meter, take.bars, settings.clickVolume));
  };

  const changeGrid = (g: GridName) => {
    if (g === settings.grid) return;
    if (take && edited && !confirm('Changing the grid re-reads the notes from the recording. Your edits will be lost.')) return;
    update({ grid: g });
    if (take) {
      setNotes(quantizeNotes(rawNotes, take.meter, GRID[g], take.bars * BEATS_PER_BAR));
      setEdited(false);
      setSelected(null);
    }
  };

  const edit = (action: EditAction) => {
    if (selected === null) return;
    let next: readonly Note[] = notes;
    switch (action) {
      case 'up': next = transposeNote(notes, selected, 1); break;
      case 'down': next = transposeNote(notes, selected, -1); break;
      case 'earlier': next = moveNote(notes, selected, -grid, totalBeats); break;
      case 'later': next = moveNote(notes, selected, grid, totalBeats); break;
      case 'shorter': next = resizeNote(notes, selected, -grid, grid, totalBeats); break;
      case 'longer': next = resizeNote(notes, selected, grid, grid, totalBeats); break;
      case 'delete': next = deleteNote(notes, selected); setSelected(null); break;
    }
    if (next !== notes) {
      setNotes(next);
      setEdited(true);
    }
  };

  const stop = () => stopRef.current?.();
  const busy = mode !== 'idle';
  const live = mode === 'recording' || mode === 'playing';
  const showNotes = view === 'notes' && !recording && take;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Songcatcher</h1>
        <NoteReadout frames={frames} live={mode === 'recording'} />
      </header>

      <SettingsPanel
        settings={settings}
        update={update}
        busy={busy}
        open={settingsOpen}
        onToggle={() => setSettingsOpen((o) => !o)}
        lastLatency={take?.latency ?? null}
      />

      <div className="view-bar">
        <div className="segmented small tabs" role="tablist">
          <button role="tab" aria-selected={view === 'notes'} className={view === 'notes' ? 'on' : ''} disabled={busy} onClick={() => setView('notes')}>
            Notes{take ? ` (${notes.length})` : ''}
          </button>
          <button role="tab" aria-selected={view === 'pitch'} className={view === 'pitch' ? 'on' : ''} disabled={busy} onClick={() => setView('pitch')}>
            Pitch
          </button>
        </div>
        <BeatIndicator meter={viewMeter} bars={viewBars} playhead={playhead} live={live} />
      </div>

      {showNotes ? (
        <>
          <PianoRoll
            notes={notes}
            octave={octave}
            meter={viewMeter}
            bars={viewBars}
            grid={grid}
            frames={frames}
            selectedId={selected}
            onSelect={setSelected}
            playhead={playhead}
            live={live}
          />
          <NotesToolbar
            grid={settings.grid}
            onGrid={changeGrid}
            octave={octave}
            onOctave={setOctave}
            onFit={() => setOctave(fitOctave(notes))}
            hasSelection={selected !== null}
            onEdit={edit}
            disabled={busy}
          />
        </>
      ) : view === 'notes' && !recording ? (
        <div className="empty">
          <p>Hit <strong>Record</strong>, wait for the count-in, then hum your riff.</p>
          <p className="hint">The notes show up here, ready to fix and play back.</p>
        </div>
      ) : (
        <PitchView frames={frames} meter={viewMeter} bars={viewBars} playhead={playhead} live={live} version={version} />
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <footer className="transport">
        <button className="secondary" disabled={!take || recording} onClick={mode === 'playing' ? stop : play}>
          {mode === 'playing' ? '■ Stop' : view === 'pitch' ? '▶ Play take' : '▶ Play notes'}
        </button>
        <button
          className={`record ${recording ? 'active' : ''}`}
          disabled={mode === 'playing' || mode === 'starting'}
          onClick={mode === 'recording' ? stop : record}
          aria-label={mode === 'recording' ? 'Stop recording' : 'Record'}
        >
          <span className="record-icon" />
          {mode === 'recording' ? 'Stop' : take ? 'New take' : 'Record'}
        </button>
      </footer>
    </div>
  );
}

function describeError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError') return 'Microphone permission was denied. Allow it in the browser settings and try again.';
    if (e.name === 'NotFoundError') return 'No microphone found.';
  }
  return e instanceof Error ? e.message : String(e);
}
