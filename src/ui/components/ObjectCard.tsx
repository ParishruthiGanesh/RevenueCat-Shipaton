import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { HandHelping } from 'lucide-react-native';
import type { LocationBelief } from '@/core/beliefs';
import type { MemoryGraph } from '@/core/graph';
import { formatAgo, shortPlace } from '@/core/phrasing';
import type { Entity } from '@/core/types';
import { useTheme } from '../theme';
import { radius, space } from '../tokens';
import { ConfidenceBadge } from './Confidence';
import { EvidenceImage } from './EvidenceImage';
import { Card } from './Layout';
import { T } from './Text';

export function placeLine(graph: MemoryGraph, b: LocationBelief | undefined): string {
  if (!b) return '';
  if (b.status === 'lent' && b.loan) return `Lent to ${graph.person(b.loan.personId)?.name ?? 'someone'}`;
  if (b.status === 'removed') return 'Marked as no longer there';
  if (!b.primary) return 'No sightings yet';
  const s = shortPlace(graph, b.primary.currentChain, b.primary.observation.placement!.relation);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Compact, scannable object card: evidence thumbnail, where, when, how sure. */
export function ObjectCard({ graph, entity, belief, subtitle }: { graph: MemoryGraph; entity: Entity; belief?: LocationBelief; subtitle?: string }) {
  const { c } = useTheme();
  const media = graph.media(belief?.primary?.observation.mediaId ?? entity.coverMediaId);
  const when = belief?.primary ? formatAgo(belief.primary.observation.observedAt) : undefined;
  return (
    <Card onPress={() => router.push(`/item/${entity.id}`)} accessibilityLabel={`${entity.name}. ${subtitle ?? placeLine(graph, belief)}`} style={styles.card}>
      <EvidenceImage media={media} name={entity.name} category={entity.category} size={64} rounded={radius.md} sensitive={entity.sensitive} />
      <View style={{ flex: 1, gap: 3 }}>
        <T variant="subheading" numberOfLines={1}>
          {entity.name}
        </T>
        <T variant="caption" color="muted" numberOfLines={2}>
          {subtitle ?? placeLine(graph, belief)}
          {when && !subtitle ? ` · ${when}` : ''}
        </T>
        <View style={{ flexDirection: 'row', gap: space.xs, marginTop: 3 }}>
          {belief?.status === 'lent' ? (
            <View style={[styles.lent, { backgroundColor: c.surfaceMuted }]}>
              <HandHelping size={12} color={c.inkSoft} />
              <T variant="caption" color="inkSoft">
                Lent
              </T>
            </View>
          ) : belief ? (
            <ConfidenceBadge level={belief.level} compact />
          ) : null}
        </View>
      </View>
    </Card>
  );
}

/** Square tile for horizontal carousels ("Recently remembered"). */
export function ObjectTile({ graph, entity, belief }: { graph: MemoryGraph; entity: Entity; belief?: LocationBelief }) {
  const { confidence } = useTheme();
  const media = graph.media(belief?.primary?.observation.mediaId ?? entity.coverMediaId);
  return (
    <Card onPress={() => router.push(`/item/${entity.id}`)} accessibilityLabel={entity.name} style={{ width: 148, padding: space.sm }}>
      <EvidenceImage media={media} name={entity.name} category={entity.category} style={{ width: '100%', aspectRatio: 1 }} rounded={radius.lg} sensitive={entity.sensitive} />
      <View style={{ paddingHorizontal: 4, paddingTop: space.sm, gap: 2 }}>
        <T variant="label" numberOfLines={1}>
          {entity.name}
        </T>
        <T variant="caption" color="muted" numberOfLines={1}>
          {placeLine(graph, belief)}
        </T>
      </View>
      {belief && belief.status !== 'lent' ? <View style={[styles.dot, { backgroundColor: confidence[belief.level].dot }]} accessibilityElementsHidden /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  lent: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  dot: { position: 'absolute', top: 14, right: 14, width: 8, height: 8, borderRadius: 4 },
});
