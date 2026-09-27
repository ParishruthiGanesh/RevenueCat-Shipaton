import React from 'react';
import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '../theme';
import { type as typeScale, type Palette, type TypeVariant } from '../tokens';

export interface TProps extends TextProps {
  variant?: TypeVariant;
  color?: keyof Palette | (string & {});
  align?: TextStyle['textAlign'];
  weight?: 'regular' | 'medium' | 'semibold';
}

/** Typography primitive: every string in the app goes through this for scaling & theming. */
export function T({ variant = 'body', color = 'ink', align, style, children, ...rest }: TProps) {
  const { c, scale } = useTheme();
  const base = typeScale[variant];
  const resolved = (c as Record<string, string>)[color] ?? color;
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[
        base,
        { color: resolved, textAlign: align },
        scale !== 1 && { fontSize: base.fontSize * scale, lineHeight: base.lineHeight * scale },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
