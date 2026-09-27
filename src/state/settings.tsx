import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { kvGet, kvSet } from '@/data/db';

/**
 * User preferences. Privacy-relevant defaults are the conservative choice.
 */
export interface Settings {
  onboarded: boolean;
  /** Send frames to the cloud vision model. Off → manual/voice labelling only. */
  cloudAI: boolean;
  /** Back up & sync the memory graph to the user's private cloud (Pro). */
  cloudSync: boolean;
  /** Store only object crops (never full frames) when people are detected in a capture. */
  minimizePeople: boolean;
  /** Never ask the model to read text on anything; strips OCR-ish fields. */
  sensitiveMode: boolean;
  /** V3: consented background observation (off; requires explicit opt-in per session). */
  passiveMemory: boolean;
  largeText: boolean;
  highContrast: boolean;
  simpleMode: boolean;
  voiceFirst: boolean;
  notifications: boolean;
  analytics: boolean;
  defaultSpaceId?: string;
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  cloudAI: true,
  cloudSync: false,
  minimizePeople: true,
  sensitiveMode: true,
  passiveMemory: false,
  largeText: false,
  highContrast: false,
  simpleMode: false,
  voiceFirst: false,
  notifications: true,
  analytics: true,
  haptics: true,
};

interface Ctx {
  settings: Settings;
  ready: boolean;
  update: (patch: Partial<Settings>) => void;
}

const SettingsContext = createContext<Ctx | null>(null);
const KEY = 'settings.v1';

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    kvGet(KEY)
      .then((raw) => {
        if (raw) setSettings({ ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) });
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      kvSet(KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, ready, update }), [settings, ready, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
