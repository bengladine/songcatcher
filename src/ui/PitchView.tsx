import { useEffect, useRef } from 'react';
import type { PitchFrame } from '../audio/engine';
import { freqToMidi, midiToName } from '../music/pitch';
import { barDuration, beatDuration, type Meter } from '../music/timing';

interface Props {
  frames: readonly PitchFrame[];
  meter: Meter;
  bars: number;
  /** Returns the playhead in take seconds, or null for none. Polled every animation frame. */
  playhead: () => number | null;
  /** Redraw continuously while true (recording / playing). */
  live: boolean;
  /** Bump to force a redraw when not live. */
  version: number;
}

const DEFAULT_LO = 40; // E2 — low E string
const DEFAULT_HI = 64; // E4

/** Raw pitch contour over the bar/beat grid. Canvas, because it redraws ~60×/s while recording. */
export function PitchView({ frames, meter, bars, playhead, live, version }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let raf = 0;
    const draw = () => {
      drawPitch(canvas, frames, meter, bars, playhead());
      if (live) raf = requestAnimationFrame(draw);
    };
    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [frames, meter, bars, playhead, live, version]);

  return <canvas ref={canvasRef} className="pitch-view" aria-label="Detected pitch" />;
}

function cssVar(el: Element, name: string) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

function drawPitch(
  canvas: HTMLCanvasElement,
  frames: readonly PitchFrame[],
  meter: Meter,
  bars: number,
  playhead: number | null,
) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const colGrid = cssVar(canvas, '--grid');
  const colGridStrong = cssVar(canvas, '--grid-strong');
  const colText = cssVar(canvas, '--muted');
  const colLine = cssVar(canvas, '--accent');
  const colGate = cssVar(canvas, '--gate');
  const colHead = cssVar(canvas, '--text');

  // Vertical range: default guitar-ish window, grown to fit whatever was sung.
  let lo = DEFAULT_LO;
  let hi = DEFAULT_HI;
  for (const f of frames) {
    if (f.freq === null) continue;
    const m = freqToMidi(f.freq);
    if (m - 1 < lo) lo = Math.floor(m - 1);
    if (m + 1 > hi) hi = Math.ceil(m + 1);
  }

  const labelW = 34;
  const plotW = w - labelW;
  const pad = 10;
  const total = bars * barDuration(meter);
  const x = (t: number) => labelW + (t / total) * plotW;
  const y = (m: number) => pad + ((hi - m) / (hi - lo)) * (h - 2 * pad);

  // Semitone lines; label naturals E and C (string-ish landmarks) to keep it readable.
  g.font = '11px system-ui, sans-serif';
  g.textBaseline = 'middle';
  for (let m = Math.ceil(lo); m <= hi; m++) {
    const pc = ((m % 12) + 12) % 12;
    const strong = pc === 4 || pc === 0;
    g.strokeStyle = strong ? colGridStrong : colGrid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(labelW, y(m));
    g.lineTo(w, y(m));
    g.stroke();
    if (strong) {
      g.fillStyle = colText;
      g.fillText(midiToName(m), 2, y(m));
    }
  }

  // Beat / bar lines.
  const beat = beatDuration(meter);
  for (let b = 0; b <= bars * meter.beatsPerBar; b++) {
    const bar = b % meter.beatsPerBar === 0;
    g.strokeStyle = bar ? colGridStrong : colGrid;
    g.lineWidth = bar ? 2 : 1;
    g.beginPath();
    g.moveTo(x(b * beat), 0);
    g.lineTo(x(b * beat), h);
    g.stroke();
  }

  // Gated (click) windows as faint bands, so it's visible why the line has holes.
  g.fillStyle = colGate;
  for (const f of frames) {
    if (f.gated && f.t >= 0 && f.t <= total) g.fillRect(x(f.t) - 1, 0, 2, h);
  }

  // Raw contour: connect consecutive voiced frames; break on gaps.
  g.strokeStyle = colLine;
  g.lineWidth = 2.5;
  g.lineJoin = 'round';
  g.beginPath();
  let prevT = -Infinity;
  for (const f of frames) {
    if (f.freq === null || f.t < 0 || f.t > total) {
      prevT = -Infinity;
      continue;
    }
    const px = x(f.t);
    const py = y(freqToMidi(f.freq));
    if (f.t - prevT > 0.03) g.moveTo(px, py);
    else g.lineTo(px, py);
    prevT = f.t;
  }
  g.stroke();

  if (playhead !== null && playhead >= 0 && playhead <= total) {
    g.strokeStyle = colHead;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x(playhead), 0);
    g.lineTo(x(playhead), h);
    g.stroke();
  }
}
