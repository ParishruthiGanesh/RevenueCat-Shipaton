import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInLeft } from 'react-native-reanimated';
import { ArrowRight, EyeOff, HandHelping, MapPinOff, ScanLine } from 'lucide-react-native';
import type { MemoryGraph } from '@/core/graph';
import { formatDateShort, formatWhen } from '@/core/phrasing';
import type { HistoryEntry } from '@/core/queries';
import type { Loan } from '@/core/types';
import { useTheme } from '../theme';
import { radius, space } from '../tokens';
import { EvidenceImage } from './EvidenceImage';
import { T } from './Text';

/**
 * Object Journey — every observation, oldest to newest, with the place as it was THEN.
 * Distinguishes sightings, "not detected" scans and explicit removals.
 */
export function Timeline({ graph, entries, loans = [], onPressEntry, sensitive }: { graph: MemoryGraph; entries: HistoryEntry[]; loans?: Loan[]; onPressEntry?: (e: HistoryEntry) => void; sensitive?: boolean }) {
  const { c, confidence } = useTheme();
  type Row = { kind: 'obs'; at: string; e: HistoryEntry } | { kind: 'loan'; at: string; loan: Loan; returned?: boolean };
  const rows: Row[] = [
    ...entries.map((e) => ({ kind: 'obs' as const, at: e.observation.observedAt, e })),
    ...loans.flatMap((l) => [{ kind: 'loan' as const, at: l.lentAt, loan: l }, ...(l.returnedAt ? [{ kind: 'loan' as const, at: l.returnedAt, loan: l, returned: true }] : [])]),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <View>
      {rows.map((r, idx) => {
        const last = idx === rows.length - 1;
        if (r.kind === 'loan') {
          const who = graph.person(r.loan.personId)?.name ?? 'someone';
          return (
            <View key={`${r.loan.id}-${r.returned ? 'r' : 'l'}`} style={styles.row}>
              <Rail last={last} color={c.lineStrong} dot={c.faint} />
              <View style={styles.body}>
                <T variant="caption" color="muted">
                  {formatWhen(r.at)}
                </T>
                <View style={styles.inline}>
                  <HandHelping size={15} color={c.inkSoft} />
                  <T variant="bodyStrong">{r.returned ? `Returned by ${who}` : `Lent to ${who}`}</T>
                </View>
              </View>
            </View>
          );
        }
        const o = r.e.observation;
        const place = [...r.e.chain].reverse().map((id) => graph.entity(id)?.name).filter(Boolean);
        const media = graph.media(o.mediaId);
        const isAbsence = o.type === 'absence';
        const isRemoval = o.type === 'removal';
        return (
          <Animated.View key={o.id} entering={FadeInLeft.delay(Math.min(idx, 8) * 40).duration(260)} style={styles.row}>
            <Rail last={last} color={c.lineStrong} dot={isAbsence || isRemoval ? c.faint : idx === 0 ? confidence.high.dot : c.ink} hollow={isAbsence} />
            <Pressable style={styles.body} onPress={() => onPressEntry?.(r.e)} disabled={!onPressEntry} accessibilityRole={onPressEntry ? 'button' : undefined}>
              <T variant="caption" color="muted">
                {formatWhen(o.observedAt)}
                {r.e.moved ? '  ·  moved' : ''}
              </T>
              {isAbsence ? (
                <View style={styles.inline}>
                  <ScanLine size={15} color={c.muted} />
                  <T variant="callout" color="muted">
                    Not detected when scanning {place[place.length - 1] ?? 'this spot'}
                  </T>
                </View>
              ) : isRemoval ? (
                <View style={styles.inline}>
                  <MapPinOff size={15} color={c.muted} />
                  <T variant="callout" color="muted">
                    Marked as no longer in {place[place.length - 1] ?? 'its spot'}
                  </T>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T variant="bodyStrong">{place.slice(-2).join(' › ') || 'Unknown place'}</T>
                    <T variant="caption" color="faint" numberOfLines={1}>
                      {place.slice(0, -2).join(' › ')}
                    </T>
                    {o.verification === 'corrected' && o.detectedLabel ? (
                      <View style={styles.inline}>
                        <T variant="caption" color="muted">
                          AI saw “{o.detectedLabel}”
                        </T>
                        <ArrowRight size={11} color={c.muted} />
                        <T variant="caption" color="muted">
                          you corrected it
                        </T>
                      </View>
                    ) : null}
                  </View>
                  {media ? <EvidenceImage media={media} size={48} rounded={radius.sm} sensitive={sensitive} /> : sensitive ? <EyeOff size={16} color={c.faint} /> : null}
                </View>
              )}
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

function Rail({ last, color, dot, hollow }: { last: boolean; color: string; dot: string; hollow?: boolean }) {
  return (
    <View style={styles.rail}>
      <View style={[styles.dot, hollow ? { borderWidth: 2, borderColor: dot, backgroundColor: 'transparent' } : { backgroundColor: dot }]} />
      {!last ? <View style={[styles.line, { backgroundColor: color }]} /> : null}
    </View>
  );
}

/** Compact horizontal journey for cards: Sep 3 Office → Sep 9 Bedroom → … */
export function JourneyStrip({ graph, entries }: { graph: MemoryGraph; entries: HistoryEntry[] }) {
  const { c } = useTheme();
  const sightings = entries.filter((e) => e.observation.type === 'sighting').slice(-4);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      {sightings.map((e, i) => (
        <React.Fragment key={e.observation.id}>
          {i > 0 ? <ArrowRight size={12} color={c.faint} /> : null}
          <View style={{ backgroundColor: c.surfaceMuted, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 }}>
            <T variant="caption" color="muted">
              {formatDateShort(e.observation.observedAt)}
            </T>
            <T variant="label" numberOfLines={1}>
              {graph.entity(e.chain[0])?.name ?? '—'}
            </T>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md },
  rail: { width: 16, alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 5 },
  line: { width: 2, flex: 1, marginVertical: 4, borderRadius: 1 },
  body: { flex: 1, paddingBottom: space.xl, gap: 4 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
