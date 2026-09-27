import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme';
import { motion, radius, shadow, space } from '../tokens';
import { T } from './Text';

type Variant = 'primary' | 'ember' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  loading?: boolean;
  full?: boolean;
  style?: ViewStyle;
  haptic?: boolean;
}

const APressable = Animated.createAnimatedComponent(Pressable);

export function Button({ label, variant = 'primary', size = 'md', icon: Icon, loading, full, style, disabled, onPress, haptic = true, ...rest }: ButtonProps) {
  const { c } = useTheme();
  const pressed = useSharedValue(0);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: withSpring(pressed.value ? 0.97 : 1, motion.spring) }] }));

  const palette: Record<Variant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.ink, fg: c.inverse },
    ember: { bg: c.ember, fg: '#FFFFFF' },
    secondary: { bg: c.surface, fg: c.ink, border: c.line },
    ghost: { bg: 'transparent', fg: c.ink },
    danger: { bg: c.surface, fg: c.danger, border: c.line },
  };
  const p = palette[variant];
  const h = size === 'lg' ? 56 : size === 'sm' ? 36 : 48;

  return (
    <APressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={disabled || loading}
      onPressIn={() => (pressed.value = 1)}
      onPressOut={() => (pressed.value = 0)}
      onPress={(e) => {
        if (haptic) Haptics.selectionAsync().catch(() => undefined);
        onPress?.(e);
      }}
      style={[
        styles.base,
        { height: h, backgroundColor: p.bg, borderColor: p.border ?? 'transparent', paddingHorizontal: size === 'sm' ? space.md : space.xl, opacity: disabled ? 0.45 : 1 },
        full && { alignSelf: 'stretch' },
        variant === 'ember' && shadow.ember,
        anim,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {Icon ? <Icon size={size === 'sm' ? 16 : 19} color={p.fg} strokeWidth={2} /> : null}
          <T variant={size === 'sm' ? 'label' : 'bodyStrong'} style={{ color: p.fg }}>
            {label}
          </T>
        </View>
      )}
    </APressable>
  );
}

export function IconButton({ icon: Icon, label, onPress, tone = 'default', size = 40 }: { icon: LucideIcon; label: string; onPress?: () => void; tone?: 'default' | 'inverse' | 'glass'; size?: number }) {
  const { c } = useTheme();
  const bg = tone === 'inverse' ? c.ink : tone === 'glass' ? 'rgba(20,18,15,0.45)' : c.surface;
  const fg = tone === 'default' ? c.ink : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        Haptics.selectionAsync().catch(() => undefined);
        onPress?.();
      }}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1, borderWidth: tone === 'default' ? StyleSheet.hairlineWidth : 0, borderColor: c.line }]}
    >
      <Icon size={size * 0.48} color={fg} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
