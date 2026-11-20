import { midiToFreq } from '../music/pitch';

export interface SynthNote {
  /** MIDI pitch. */
  pitch: number;
  /** Seconds relative to `origin`. */
  start: number;
  duration: number;
}

/**
 * Placeholder "guitar": two detuned saws → soft-clip distortion → low-pass whose cutoff
 * snaps open and decays (a pluck). Cheap and dependency-free; gets replaced by a sampled
 * guitar later. Returns a function that silences everything scheduled.
 */
export function scheduleSynthNotes(
  ctx: BaseAudioContext,
  dest: AudioNode,
  notes: readonly SynthNote[],
  origin: number,
  volume = 0.35,
): () => void {
  const bus = ctx.createGain();
  bus.gain.value = volume;
  const drive = ctx.createWaveShaper();
  drive.curve = softClipCurve(3);
  drive.oversample = '2x';
  drive.connect(bus).connect(dest);

  for (const n of notes) {
    const t = origin + n.start;
    if (t + n.duration < ctx.currentTime) continue;
    const f = midiToFreq(n.pitch);
    // Keep a tiny gap so repeated notes re-attack audibly.
    const end = t + Math.max(0.05, n.duration - 0.015);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.5;
    filter.frequency.setValueAtTime(Math.min(f * 12, 9000), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(f * 3, 400), t + 0.25);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.5, t + 0.004);
    amp.gain.setTargetAtTime(0.32, t + 0.004, 0.12);
    amp.gain.setValueAtTime(0.32, end); // anchor so the release starts from a known value
    amp.gain.linearRampToValueAtTime(0, end + 0.04);

    filter.connect(amp).connect(drive);
    for (const detune of [-7, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(t);
      osc.stop(end + 0.05);
    }
  }
  return () => {
    bus.gain.cancelScheduledValues(0);
    bus.gain.value = 0;
    bus.disconnect();
  };
}

function softClipCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}
