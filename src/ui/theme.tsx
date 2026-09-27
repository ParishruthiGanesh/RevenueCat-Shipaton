import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useSettings } from '@/state/settings';
import { confidenceColors, palettes, type ColorScheme, type Palette } from './tokens';

export interface Theme {
  scheme: ColorScheme;
  c: Palette;
  confidence: (typeof confidenceColors)['light'];
  /** Multiplier applied to all type sizes (Large Text setting). */
  scale: number;
  simple: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const { settings } = useSettings();
  const value = useMemo<Theme>(() => {
    const scheme: ColorScheme = settings.highContrast ? 'light' : system === 'dark' ? 'dark' : 'light';
    const c = settings.highContrast ? palettes.highContrast : palettes[scheme];
    return { scheme, c, confidence: confidenceColors[scheme], scale: settings.largeText || settings.simpleMode ? 1.22 : 1, simple: settings.simpleMode };
  }, [system, settings.highContrast, settings.largeText, settings.simpleMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme must be used within ThemeProvider');
  return t;
}
