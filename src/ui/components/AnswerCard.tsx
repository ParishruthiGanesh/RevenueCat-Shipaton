import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Camera, EyeOff, Image as ImageIcon, Info, MapPinOff } from 'lucide-react-native';
import type { LocationBelief } from '@/core/beliefs';
import type { MemoryGraph } from '@/core/graph';
import { markNoLongerThere } from '@/core/operations';
import { breadcrumb, formatWhen, sourcePhrase, type Answer } from '@/core/phrasing';
import type { Entity } from '@/core/types';
import { track } from '@/services/analytics';
import { recordedBy } from '@/core/family';
import { useFamily } from '@/state/family';
import { useSession } from '@/state/session';
import { useTheme } from '../theme';
import { radius, space } from '../tokens';
import { Breadcrumb } from './Breadcrumb';
import { Button } from './Button';
import { ConfidenceBadge, ConfidenceExplainer, ConfidenceMeter } from './Confidence';
import { EvidenceImage } from './EvidenceImage';
import { Card } from './Layout';
import { T } from './Text';

/**
 * The answer to "Where is my passport?" — last seen, where, when, how sure, with the photo
 * that proves it. Every sentence traces back to a specific observation.
 */
export function AnswerCard({ graph, entity, belief, answer, note, simple }: { graph: MemoryGraph; entity: Entity; belief: LocationBelief; answer: Answer; note?: string; simple?: boolean }) {
  const { c } = useTheme();
  const { members } = useFamily();
  const { userId } = useSession();
  const [revealed, setRevealed] = useState(false);
  const p = belief.primary;
  const by = recordedBy(p?.observation, members, userId);
  const media = graph.media(p?.observation.mediaId ?? entity.coverMediaId);
  const path = p ? breadcrumb(graph, p.currentChain) : [];

  const confirmGone = () =>
    Alert.alert(`${entity.name} is no longer there?`, 'The old sighting stays in its history. Its location becomes unknown until you remember it again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark as no longer there',
        style: 'destructive',
        onPress: () => {
          markNoLongerThere(graph, entity.id);
          track('location_corrected', { kind: 'removed' });
        },
      },
    ]);

  if (simple) {
    return (
      <Animated.View entering={FadeInDown.duration(320)}>
        <Card style={{ gap: space.lg, padding: space.xl }}>
          <T variant="overline" color="muted">
            {entity.name}
          </T>
          <T variant="title">{answer.simple}</T>
          {media ? <EvidenceImage media={media} name={entity.name} style={{ width: '100%', aspectRatio: 4 / 3 }} sensitive={entity.sensitive} revealed={revealed} /> : null}
          <Button label="Show me the photo" icon={ImageIcon} size="lg" full onPress={() => router.push(`/item/${entity.id}`)} />
        </Card>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.duration(320)}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {media ? (
          <Pressable onPress={() => (entity.sensitive && !revealed ? setRevealed(true) : router.push({ pathname: '/evidence/[id]', params: { id: media.id, entityId: entity.id } }))} accessibilityRole="imagebutton" accessibilityLabel={entity.sensitive && !revealed ? 'Reveal sensitive photo' : 'Open evidence photo'}>
            <EvidenceImage media={media} name={entity.name} category={entity.category} style={{ width: '100%', aspectRatio: 16 / 10 }} rounded={0} sensitive={entity.sensitive} revealed={revealed} />
            {p ? (
              <View style={[styles.stamp, { backgroundColor: c.cameraScrim }]}>
                <T variant="caption" style={{ color: '#fff' }}>
                  {formatWhen(p.observation.observedAt)}
                </T>
              </View>
            ) : null}
          </Pressable>
        ) : null}

        <View style={{ padding: space.xl, gap: space.lg }}>
          <View style={{ gap: space.sm }}>
            <T variant="overline" color="muted">
              {entity.name}
            </T>
            <T variant="heading" accessibilityRole="header">
              {answer.headline}
            </T>
            {note ? (
              <T variant="bodyStrong" color="ember">
                {note}
              </T>
            ) : null}
          </View>

          {path.length ? <Breadcrumb path={path} vertical /> : null}

          {belief.status !== 'lent' && belief.status !== 'removed' && p ? (
            <View style={[styles.confBox, { backgroundColor: c.surfaceMuted }]}>
              <View style={styles.confHead}>
                <ConfidenceBadge level={belief.level} />
                <T variant="caption" color="muted">
                  {sourcePhrase(p)}
                  {by ? ` · added by ${by}` : ''}
                </T>
              </View>
              <ConfidenceMeter level={belief.level} score={belief.score} />
              <ConfidenceExplainer level={belief.level} />
            </View>
          ) : null}

          {answer.caveats.length ? (
            <View style={{ gap: space.sm }}>
              {answer.caveats.map((cv) => (
                <View key={cv} style={styles.caveat}>
                  <Info size={15} color={c.muted} style={{ marginTop: 3 }} />
                  <T variant="callout" color="inkSoft" style={{ flex: 1 }}>
                    {cv}
                  </T>
                </View>
              ))}
            </View>
          ) : null}

          {belief.alternatives.length ? (
            <View style={{ gap: space.xs }}>
              <T variant="overline" color="muted">
                Other possible places
              </T>
              {belief.alternatives.map((a) => (
                <T key={a.observation.id} variant="callout" color="inkSoft">
                  · {breadcrumb(graph, a.currentChain).map((e) => e.name).slice(-2).join(' › ')} — {formatWhen(a.observation.observedAt)}
                </T>
              ))}
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button label="Show me" icon={ImageIcon} onPress={() => router.push(`/item/${entity.id}`)} style={{ flex: 1 }} />
            <Button label="Update" icon={Camera} variant="secondary" onPress={() => router.push({ pathname: '/capture', params: { mode: 'remember', itemId: entity.id } })} style={{ flex: 1 }} />
          </View>
          {belief.status === 'located' || belief.status === 'unknown' ? (
            <Pressable accessibilityRole="button" onPress={confirmGone} style={styles.gone} hitSlop={6}>
              <MapPinOff size={16} color={c.muted} />
              <T variant="label" color="muted">
                That’s no longer there
              </T>
            </Pressable>
          ) : null}
          {entity.sensitive ? (
            <View style={styles.caveat}>
              <EyeOff size={14} color={c.faint} style={{ marginTop: 2 }} />
              <T variant="caption" color="faint" style={{ flex: 1 }}>
                Sensitive item — its photo stays blurred until you tap it, and no text on it is ever read or stored.
              </T>
            </View>
          ) : null}
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stamp: { position: 'absolute', left: space.md, bottom: space.md, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  confBox: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  confHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  caveat: { flexDirection: 'row', gap: space.sm },
  actions: { flexDirection: 'row', gap: space.sm },
  gone: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: space.xs },
});
