/**
 * AudioWorklet that copies mic input to the main thread in ~21 ms chunks (1024 samples).
 * Each chunk carries the context frame index of its first sample so the main thread can
 * place it exactly on the AudioContext clock — the same clock the metronome is scheduled on.
 * No DSP here: the audio thread must never block, and pitch detection is cheap enough on main.
 */

// Minimal typings for the AudioWorkletGlobalScope (not part of lib.dom).
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const CHUNK = 1024;

class CaptureProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(CHUNK);
  private filled = 0;
  private chunkStartFrame = 0;
  private running = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === 'stop') this.running = false;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (ch && ch.length) {
      let i = 0;
      while (i < ch.length) {
        if (this.filled === 0) this.chunkStartFrame = currentFrame + i;
        const n = Math.min(CHUNK - this.filled, ch.length - i);
        this.buf.set(ch.subarray(i, i + n), this.filled);
        this.filled += n;
        i += n;
        if (this.filled === CHUNK) {
          this.port.postMessage({ samples: this.buf, startFrame: this.chunkStartFrame }, [
            this.buf.buffer,
          ]);
          this.buf = new Float32Array(CHUNK);
          this.filled = 0;
        }
      }
    }
    return this.running;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
