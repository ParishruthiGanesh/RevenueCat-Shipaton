import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme';
import { space } from '../tokens';
import { Button } from './Button';
import { T } from './Text';

/** A drawer with one softly glowing object — the app's visual metaphor. */
export function DrawerIllustration({ size = 140 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width={size} height={size * 0.8} viewBox="0 0 140 112">
      <Rect x="14" y="30" width="112" height="70" rx="10" fill={c.surfaceMuted} stroke={c.lineStrong} strokeWidth="1.5" />
      <Rect x="6" y="18" width="128" height="30" rx="8" fill={c.surface} stroke={c.lineStrong} strokeWidth="1.5" />
      <Rect x="58" y="29" width="24" height="5" rx="2.5" fill={c.lineStrong} />
      <Circle cx="70" cy="74" r="20" fill={c.emberSoft} />
      <Circle cx="70" cy="74" r="9" fill={c.ember} />
      <Path d="M70 50 v-8 M90 58 l6 -6 M50 58 l-6 -6" stroke={c.ember} strokeWidth="2" strokeLinecap="round" />
    </Svg>
    </View>
  );
}

export function EmptyState({ title, body, action, onAction, illustration = true }: { title: string; body?: string; action?: string; onAction?: () => void; illustration?: boolean }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxxl, gap: space.md }}>
      {illustration ? <DrawerIllustration /> : null}
      <T variant="heading" align="center">
        {title}
      </T>
      {body ? (
        <T variant="callout" color="muted" align="center" style={{ maxWidth: 300 }}>
          {body}
        </T>
      ) : null}
      {action ? <Button label={action} onPress={onAction} variant="ember" style={{ marginTop: space.sm }} /> : null}
    </View>
  );
}
