import React from 'react';
import { StyleSheet, View } from 'react-native';
import { CircleHelp, Eye, History, ShieldCheck } from 'lucide-react-native';
import type { ConfidenceLevel } from '@/core/beliefs';
import { LEVEL_EXPLAINER } from '@/core/phrasing';
import { useTheme } from '../theme';
import { radius, space } from '../tokens';
import { T } from './Text';

const ICON = { high: ShieldCheck, medium: Eye, low: History, unknown: CircleHelp } as const;
const SHORT: Record<ConfidenceLevel, string> = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unknown' };

/** Confidence is never colour alone: icon + word + colour, with an accessible explanation. */
export function ConfidenceBadge({ level, compact }: { level: ConfidenceLevel; compact?: boolean }) {
  const { confidence } = useTheme();
  const k = confidence[level];
  const Icon = ICON[level];
  return (
    <View
      accessible
      accessibilityLabel={`${SHORT[level]} confidence. ${LEVEL_EXPLAINER[level]}`}
      style={[styles.badge, { backgroundColor: k.bg, paddingVertical: compact ? 3 : 5, paddingHorizontal: compact ? 8 : 10 }]}
    >
      <Icon size={compact ? 12 : 14} color={k.fg} strokeWidth={2.2} />
      <T variant={compact ? 'caption' : 'label'} style={{ color: k.fg, fontFamily: 'Inter_600SemiBold' }}>
        {compact ? SHORT[level] : `${SHORT[level]} confidence`}
      </T>
    </View>
  );
}

/** Four-step meter used on detail screens. */
export function ConfidenceMeter({ level, score }: { level: ConfidenceLevel; score: number }) {
  const { c, confidence } = useTheme();
  const filled = level === 'high' ? 4 : level === 'medium' ? 3 : level === 'low' ? 2 : score > 0 ? 1 : 0;
  return (
    <View style={styles.meterWrap} accessibilityElementsHidden>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[styles.meterSeg, { backgroundColor: i < filled ? confidence[level].dot : c.surfaceSunken }]} />
      ))}
    </View>
  );
}

export function ConfidenceExplainer({ level }: { level: ConfidenceLevel }) {
  return (
    <T variant="caption" color="muted">
      {LEVEL_EXPLAINER[level]}
    </T>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.pill, alignSelf: 'flex-start' },
  meterWrap: { flexDirection: 'row', gap: space.xs },
  meterSeg: { flex: 1, height: 6, borderRadius: 3 },
});
