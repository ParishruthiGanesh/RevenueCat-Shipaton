import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme';
import { radius, shadow, space } from '../tokens';
import { T } from './Text';

export function Screen({ children, scroll = true, padded = true, style, contentStyle, bottomInset = 120, ...rest }: { children: React.ReactNode; scroll?: boolean; padded?: boolean; style?: ViewStyle; contentStyle?: ViewStyle; bottomInset?: number } & ScrollViewProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const pad: ViewStyle = { paddingTop: insets.top + space.sm, paddingHorizontal: padded ? space.xl : 0, paddingBottom: insets.bottom + bottomInset };
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: c.bg }, pad, style]}>{children}</View>;
  return (
    <ScrollView style={[{ flex: 1, backgroundColor: c.bg }, style]} contentContainerStyle={[pad, contentStyle]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} {...rest}>
      {children}
    </ScrollView>
  );
}

export function Header({ title, subtitle, back = true, right, large = true }: { title?: string; subtitle?: string; back?: boolean; right?: React.ReactNode; large?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ marginBottom: space.xl }}>
      <View style={styles.headerBar}>
        {back ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={[styles.back, { backgroundColor: c.surface, borderColor: c.line }]}>
            <ChevronLeft size={20} color={c.ink} />
          </Pressable>
        ) : (
          <View />
        )}
        <View style={{ flexDirection: 'row', gap: space.sm }}>{right}</View>
      </View>
      {title ? (
        <T variant={large ? 'title' : 'heading'} accessibilityRole="header" style={{ marginTop: back ? space.lg : 0 }}>
          {title}
        </T>
      ) : null}
      {subtitle ? (
        <T variant="callout" color="muted" style={{ marginTop: space.xs }}>
          {subtitle}
        </T>
      ) : null}
    </View>
  );
}

export function Card({ children, style, onPress, tone = 'surface', accessibilityLabel }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: 'surface' | 'muted' | 'ember'; accessibilityLabel?: string }) {
  const { c } = useTheme();
  const bg = tone === 'muted' ? c.surfaceMuted : tone === 'ember' ? c.emberSoft : c.surface;
  const body = <View style={[styles.card, { backgroundColor: bg, borderColor: c.line }, tone === 'surface' && shadow.card, style]}>{children}</View>;
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
      {body}
    </Pressable>
  );
}

export function Section({ title, action, onAction, children, style }: { title: string; action?: string; onAction?: () => void; children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ marginTop: space.xxxl }, style]}>
      <View style={styles.sectionHead}>
        <T variant="overline" color="muted" accessibilityRole="header">
          {title}
        </T>
        {action ? (
          <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10}>
            <T variant="label" color="ember">
              {action}
            </T>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function Row({ icon: Icon, title, subtitle, onPress, right, danger, iconTint }: { icon?: LucideIcon; title: string; subtitle?: string; onPress?: () => void; right?: React.ReactNode; danger?: boolean; iconTint?: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, { borderBottomColor: c.line, opacity: pressed ? 0.7 : 1 }]}>
      {Icon ? (
        <View style={[styles.rowIcon, { backgroundColor: c.surfaceMuted }]}>
          <Icon size={18} color={danger ? c.danger : (iconTint ?? c.inkSoft)} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" style={danger ? { color: c.danger } : undefined}>
          {title}
        </T>
        {subtitle ? (
          <T variant="caption" color="muted" numberOfLines={2}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right ?? (onPress ? <ChevronRight size={18} color={c.faint} /> : null)}
    </Pressable>
  );
}

export function ToggleRow({ icon, title, subtitle, value, onValueChange, disabled }: { icon?: LucideIcon; title: string; subtitle?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Row
      icon={icon}
      title={title}
      subtitle={subtitle}
      right={<Switch accessibilityLabel={title} value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ true: c.ember, false: c.surfaceSunken }} thumbColor="#FFFFFF" />}
    />
  );
}

export function Chip({ label, selected, onPress, icon: Icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: LucideIcon }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, { backgroundColor: selected ? c.ink : c.surface, borderColor: selected ? c.ink : c.line, opacity: pressed ? 0.8 : 1 }]}
    >
      {Icon ? <Icon size={15} color={selected ? c.inverse : c.inkSoft} /> : null}
      <T variant="label" style={{ color: selected ? c.inverse : c.ink }}>
        {label}
      </T>
    </Pressable>
  );
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginVertical: space.lg }} />;
}

const styles = StyleSheet.create({
  headerBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  card: { borderRadius: radius.xl, padding: space.lg, borderWidth: StyleSheet.hairlineWidth },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 56 },
  rowIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, height: 36, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
});
