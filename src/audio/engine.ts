import captureWorkletUrl from './capture-processor.ts?worker&url';
import { scheduleClicks } from './metronome';
import { McLeodDetector } from './pitch/McLeodDetector';
import type { PitchDetector } from './pitch/PitchDetector';
import { PitchTracker } from './pitch/PitchTracker';
import { barDuration, beatDuration, clickSchedule, overlapsClick, type Meter } from '../music/timing';

/** A pitch-track frame on the take timeline (0 = downbeat of the first recorded bar). */
export interface PitchFrame {
  /** Centre of the analysis window, seconds. */
  t: number;
  freq: number | null;
  clarity: number;
  rms: number;
  /** Window overlapped a metronome click; pitch was discarded. */
  gated: boolean;
}

export interface Take {
  meter: Meter;
  bars: number;
  sampleRate: number;
  frames: PitchFrame[];
  /** Raw mic audio, latency-corrected; sample 0 is at take time `audioStart`. */
  audio: Float32Array;
  audioStart: number;
  /** Seconds subtracted from capture times to line the take up with what the user heard. */
  latency: number;
}

export interface RecordOptions {
  meter: Meter;
  bars: number;
  countInBars: number;
  clickVolume: number;
  /** Speaker mode: discard pitch near clicks (see overlapsClick). */
  gateClicks: boolean;
  /** Added to the auto-estimated round-trip latency, seconds. */
  latencyAdjust: number;
  onFrame?: (f: PitchFrame) => void;
}

export interface RecordingHandle {
  /** AudioContext time of take time 0 (as scheduled, before output latency). */
  origin: number;
  done: Promise<Take>;
  /** Stop early. The partial take is still resolved. */
  stop(): void;
}

export interface MicOptions {
  /** With headphones we want the raw signal; on speaker we let the browser's AEC remove the click. */
  headphones: boolean;
}

/**
 * Owns the AudioContext and the mic. Kept open between takes so repeated takes start instantly
 * and don't re-prompt for permission.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private workletLoaded: Promise<void> | null = null;
  private stream: MediaStream | null = null;
  private streamKey = '';
  private detectorFactory: () => PitchDetector = () => new McLeodDetector();

  /** Must be called from a user gesture the first time (iOS/Chrome autoplay rules). */
  async context(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.workletLoaded = this.ctx.audioWorklet.addModule(captureWorkletUrl);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    await this.workletLoaded;
    return this.ctx;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** What the listener hears lags ctx.currentTime by this much. Used to sync visuals. */
  get outputLatency(): number {
    if (!this.ctx) return 0;
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }

  setDetectorFactory(f: () => PitchDetector) {
    this.detectorFactory = f;
  }

  private async mic(opts: MicOptions): Promise<MediaStream> {
    const key = JSON.stringify(opts);
    if (this.stream && this.streamKey === key && this.stream.active) return this.stream;
    this.releaseMic();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: !opts.headphones,
        // Noise suppression treats a steady hum as noise and eats it; AGC pumps the level and
        // confuses onset detection. Both off.
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.streamKey = key;
    return this.stream;
  }

  releaseMic() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  /**
   * Round-trip latency estimate: a note sung "on" a click the user hears reaches us
   * output latency + input latency after the click was scheduled.
   * Browsers report these unevenly (Safari: no outputLatency; only Chrome has track latency),
   * so this is a best guess and the UI offers a manual adjustment.
   */
  private estimateLatency(ctx: AudioContext, stream: MediaStream): number {
    const settings = stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & {
      latency?: number;
    };
    const input = typeof settings?.latency === 'number' ? settings.latency : 0.02;
    return (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + input;
  }

  async record(opts: RecordOptions & MicOptions): Promise<RecordingHandle> {
    const ctx = await this.context();
    const stream = await this.mic(opts);
    const sr = ctx.sampleRate;
    const latency = Math.max(0, this.estimateLatency(ctx, stream) + opts.latencyAdjust);

    const clicks = clickSchedule(opts.meter, opts.countInBars, opts.bars);
    const clickTimes = clicks.map((c) => c.time);
    const takeEnd = opts.bars * barDuration(opts.meter);
    // Keep half a beat before the downbeat: people often start a hair early.
    const keepFrom = -beatDuration(opts.meter) / 2;

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    // The worklet only runs if it's pulled by the graph, so connect it to the output via a
    // muted gain (we never want to monitor the mic through the speaker).
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(node).connect(sink).connect(ctx.destination);

    const lead = 0.15; // scheduling headroom so the first count-in click isn't late
    const origin = ctx.currentTime + lead + opts.countInBars * barDuration(opts.meter);
    const stopClicks = scheduleClicks(ctx, ctx.destination, clicks, origin, opts.clickVolume);

    const tracker = new PitchTracker(this.detectorFactory(), sr, 512);
    const frames: PitchFrame[] = [];
    const audioChunks: Float32Array[] = [];
    let audioStart = NaN;

    let finish!: () => void;
    const done = new Promise<Take>((resolve) => {
      let finished = false;
      finish = () => {
        if (finished) return;
        finished = true;
        node.port.onmessage = null;
        node.port.postMessage('stop');
        source.disconnect();
        node.disconnect();
        sink.disconnect();
        stopClicks();
        resolve({
          meter: opts.meter,
          bars: opts.bars,
          sampleRate: sr,
          frames,
          audio: concat(audioChunks),
          audioStart: Number.isNaN(audioStart) ? 0 : audioStart,
          latency,
        });
      };
    });

    node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; startFrame: number }>) => {
      const { samples, startFrame } = e.data;
      // Map capture time onto the take timeline, compensating round-trip latency.
      const t0 = startFrame / sr - origin - latency;
      const t1 = t0 + samples.length / sr;
      if (t1 < keepFrom) return;
      if (Number.isNaN(audioStart)) audioStart = t0;
      audioChunks.push(samples);
      for (const f of tracker.push(samples, t0)) {
        const gated = opts.gateClicks && overlapsClick(f.start, f.end, clickTimes);
        const frame: PitchFrame = {
          t: (f.start + f.end) / 2,
          freq: gated ? null : f.freq,
          clarity: gated ? 0 : f.clarity,
          rms: f.rms,
          gated,
        };
        frames.push(frame);
        opts.onFrame?.(frame);
      }
      if (t1 >= takeEnd) finish();
    };

    return { origin, done, stop: () => finish() };
  }

  /** Play a take's raw audio back with the metronome, aligned as recorded. */
  async playTake(take: Take, clickVolume: number): Promise<{ origin: number; stop(): void; ended: Promise<void> }> {
    const ctx = await this.context();
    const buf = ctx.createBuffer(1, Math.max(1, take.audio.length), take.sampleRate);
    buf.copyToChannel(take.audio as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const lead = 0.1 - Math.min(0, take.audioStart);
    const origin = ctx.currentTime + lead;
    src.start(origin + take.audioStart);
    const clicks = clickSchedule(take.meter, 0, take.bars);
    const stopClicks = scheduleClicks(ctx, ctx.destination, clicks, origin, clickVolume);
    const ended = new Promise<void>((r) => (src.onended = () => r()));
    return {
      origin,
      ended,
      stop: () => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
        stopClicks();
      },
    };
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
