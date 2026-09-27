/**
 * Physical Memory design tokens.
 *
 * Direction: warm, calm, trustworthy. Paper-like neutrals, one ember accent reserved for the
 * act of remembering, and a separate, semantic scale for confidence that is never decorative.
 */

import type { ConfidenceLevel } from '@/core/beliefs';

export type ColorScheme = 'light' | 'dark';

const light = {
  bg: '#F6F2EC',
  bgElevated: '#FFFDFA',
  surface: '#FFFFFF',
  surfaceMuted: '#EFE9E1',
  surfaceSunken: '#E8E1D7',
  line: '#E2DBD0',
  lineStrong: '#CFC6B8',
  ink: '#1D1B18',
  inkSoft: '#3B3833',
  muted: '#6F695F',
  faint: '#9A9387',
  inverse: '#FFFDFA',
  ember: '#D9602F',
  emberSoft: '#F8E3D7',
  emberInk: '#8F3514',
  focus: '#2F5DD6',
  overlay: 'rgba(20,18,15,0.45)',
  cameraScrim: 'rgba(10,9,8,0.55)',
  success: '#3F7D58',
  danger: '#B3412C',
};

const dark: typeof light = {
  bg: '#121110',
  bgElevated: '#1A1917',
  surface: '#1F1D1B',
  surfaceMuted: '#2A2825',
  surfaceSunken: '#0D0C0B',
  line: '#2F2C29',
  lineStrong: '#433F3A',
  ink: '#F4EFE8',
  inkSoft: '#DAD3C9',
  muted: '#A69E92',
  faint: '#766F65',
  inverse: '#121110',
  ember: '#EE7A4A',
  emberSoft: '#3A2419',
  emberInk: '#FFC2A5',
  focus: '#7FA0FF',
  overlay: 'rgba(0,0,0,0.6)',
  cameraScrim: 'rgba(0,0,0,0.6)',
  success: '#6FBF8E',
  danger: '#F08A74',
};

/** High-contrast variant for the accessibility setting. */
const highContrast: typeof light = {
  ...light,
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F0F0F0',
  line: '#555555',
  lineStrong: '#000000',
  ink: '#000000',
  inkSoft: '#000000',
  muted: '#2E2E2E',
  faint: '#4A4A4A',
  ember: '#B23E10',
  emberInk: '#6E2204',
};

export const palettes = { light, dark, highContrast };
export type Palette = typeof light;

/** Confidence is semantic: colour + icon + words, never colour alone. */
export const confidenceColors: Record<ColorScheme, Record<ConfidenceLevel, { fg: string; bg: string; dot: string }>> = {
  light: {
    high: { fg: '#2C6446', bg: '#E1EFE5', dot: '#3F8A5E' },
    medium: { fg: '#7A5A12', bg: '#F6EBCD', dot: '#C49324' },
    low: { fg: '#8C3A22', bg: '#F7E1D8', dot: '#C4613F' },
    unknown: { fg: '#55504A', bg: '#ECE7E0', dot: '#9A9387' },
  },
  dark: {
    high: { fg: '#9FDDB7', bg: '#1C3326', dot: '#5DBB84' },
    medium: { fg: '#F1CF7E', bg: '#3A2E12', dot: '#D8A73A' },
    low: { fg: '#F7AF94', bg: '#3E2118', dot: '#E0805E' },
    unknown: { fg: '#C9C1B6', bg: '#2A2825', dot: '#8A8378' },
  },
};

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, xxl: 28, pill: 999 } as const;

export const fonts = {
  display: 'Fraunces_600SemiBold',
  displayItalic: 'Fraunces_500Medium_Italic',
  displayRegular: 'Fraunces_400Regular',
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const type = {
  hero: { fontFamily: fonts.display, fontSize: 38, lineHeight: 42, letterSpacing: -0.8 },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 33, letterSpacing: -0.5 },
  heading: { fontFamily: fonts.display, fontSize: 22, lineHeight: 27, letterSpacing: -0.3 },
  subheading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23 },
  callout: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17 },
  overline: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 1.1, textTransform: 'uppercase' as const },
} as const;

export type TypeVariant = keyof typeof type;

export const shadow = {
  card: { shadowColor: '#3B2A17', shadowOpacity: 0.06, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  lifted: { shadowColor: '#3B2A17', shadowOpacity: 0.14, shadowRadius: 28, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  ember: { shadowColor: '#D9602F', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
} as const;

export const motion = {
  fast: 160,
  base: 240,
  slow: 420,
  spring: { damping: 18, stiffness: 220, mass: 0.9 },
} as const;
