import { useEffect, useState } from 'react';

export interface Settings {
  bpm: number;
  bars: number;
  headphones: boolean;
  clickVolume: number;
  /** Manual latency correction, ms (added to the auto estimate). */
  latencyAdjustMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  bpm: 100,
  bars: 2,
  headphones: true,
  clickVolume: 0.6,
  latencyAdjustMs: 0,
};

const KEY = 'songcatcher.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* private mode / blocked storage: fall back to defaults */
  }
  return DEFAULT_SETTINGS;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  return [settings, update] as const;
}
