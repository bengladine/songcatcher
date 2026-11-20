import type { Click } from '../music/timing';

/**
 * Schedules metronome clicks on the audio clock (sample-accurate, unaffected by UI jank).
 * All clicks of a take are known up front, so we schedule them all at once instead of the
 * usual look-ahead timer loop. Returns a function that silences anything not yet played.
 *
 * @param origin AudioContext time that corresponds to click time 0.
 */
export function scheduleClicks(
  ctx: BaseAudioContext,
  dest: AudioNode,
  clicks: readonly Click[],
  origin: number,
  volume: number,
): () => void {
  const bus = ctx.createGain();
  bus.gain.value = volume;
  bus.connect(dest);
  for (const c of clicks) {
    const t = origin + c.time;
    if (t < ctx.currentTime) continue;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    // Short sine "blip": higher pitch on the downbeat. Exponential decay keeps it percussive
    // (~30 ms), which also keeps the window we have to gate out of pitch detection short.
    osc.frequency.value = c.accent ? 1760 : 1175;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(c.accent ? 1 : 0.6, t + 0.001);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    osc.connect(env).connect(bus);
    osc.start(t);
    osc.stop(t + 0.04);
  }
  return () => {
    bus.gain.cancelScheduledValues(0);
    bus.gain.value = 0;
    bus.disconnect();
  };
}
