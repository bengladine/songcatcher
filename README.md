# Songcatcher

Hum a riff to a metronome → notes → guitar tab. Mobile-first PWA, no backend.

**Status:**
- Milestone 1 (capture): metronome with a 1-bar count-in, recording N bars from the mic, live raw pitch line, playback of the take.
- Milestone 2 (notes): pitch track → notes, quantize to 1/8 or 1/16, octave shift and fit-to-guitar, piano roll editing (pitch, timing, length, delete), synth playback with the click.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # production build in dist/
```

The mic only works on a **secure origin** (HTTPS or `localhost`). To try it on a phone, use the
GitHub Pages deploy (or Chrome remote debugging with port forwarding to `localhost`).

## Deploy

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` to GitHub Pages on every push
to `main`. One-time setup: *Settings → Pages → Build and deployment → Source: GitHub Actions*.

## Layout

```
src/audio   Web Audio: engine (context, mic, recording), metronome, capture worklet,
            pitch/ (PitchDetector interface, McLeod/pitchy backend, PitchTracker framing)
src/music   Pure music logic: timing grid, click schedule, click gate, pitch ↔ MIDI,
            note segmentation, quantization, note edits, octave fit
src/ui      React components
public/     PWA manifest, icons, service worker
```

## Audio notes

- **Clock:** everything (clicks, capture, playback) runs on the `AudioContext` clock. The capture
  worklet stamps each 1024-sample chunk with its frame index, so detected pitch lines up with the
  scheduled clicks regardless of UI jank.
- **Latency:** capture times are shifted back by an estimate of output + input latency so a note
  sung on a click lands on the beat. Browsers report latency unevenly; *More → Latency* adjusts it.
- **Click bleed:** *Headphones* mode records raw audio (no echo cancellation, noise suppression or
  AGC). *Speaker* mode enables the browser's echo cancellation and also throws away pitch for any
  analysis window that overlaps a click (shown as grey bands).
- **Pitch:** McLeod pitch method (`pitchy`), 2048-sample window, 512 hop, behind the
  `PitchDetector` interface so pYIN/CREPE can be swapped in later.
- **Notes:** `segmentNotes` median-filters the contour (kills single-frame octave errors), starts a
  new note when the pitch moves > 0.6 semitone for ≥ 30 ms, bridges short dropouts and click gaps,
  splits re-sung same-pitch notes on a ≥ 6 dB level dip, and drops notes shorter than 70 ms.
  `quantizeNotes` snaps start and end separately and keeps the line monophonic.
