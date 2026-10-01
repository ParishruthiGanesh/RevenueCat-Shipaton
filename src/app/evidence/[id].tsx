import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Maximize2, ScanSearch, X } from 'lucide-react-native';
import { formatWhen, sourcePhrase } from '@/core/phrasing';
import { computeBelief } from '@/core/beliefs';
import type { MediaAsset } from '@/core/types';
import { useMemory } from '@/state/memory';
import { radius, space } from '@/ui/tokens';
import { IconButton } from '@/ui/components/Button';
import { EvidenceImage, useMediaUri } from '@/ui/components/EvidenceImage';
import { T } from '@/ui/components/Text';
import { ZoomableImage } from '@/ui/components/ZoomableImage';

/**
 * "Show me" — immersive evidence. Pinch, drag and double-tap to explore; switch between the
 * object close-up and the full original photo; browse every photo ever taken of this object.
 */
export default function Evidence() {
  const { id, entityId } = useLocalSearchParams<{ id: string; entityId?: string }>();
  const { graph } = useMemory();
  const insets = useSafeAreaInsets();
  const entity = graph.entity(entityId);
  const belief = entity ? computeBelief(graph, entity.id) : undefined;

  // Every observation of this object that has a photo, newest first.
  const gallery: { media: MediaAsset; at: string; obsId: string }[] = entity
    ? graph
        .observationsOf(entity.id)
        .filter((o) => o.mediaId && graph.media(o.mediaId))
        .map((o) => ({ media: graph.media(o.mediaId)!, at: o.observedAt, obsId: o.id }))
        .reverse()
    : [];

  const [currentId, setCurrentId] = useState(id);
  const [mode, setMode] = useState<'close' | 'full'>('close');
  const current = graph.media(currentId) ?? graph.media(id);
  const full = current?.kind === 'crop' ? graph.media(current.parentMediaId) : undefined;
  const shown = mode === 'full' && full ? full : current;
  const uri = useMediaUri(shown);
  const entry = gallery.find((g) => g.media.id === currentId);
  const at = entry?.at ?? belief?.primary?.observation.observedAt;
  const bbox = mode === 'full' && full && entry ? graph.observation(entry.obsId)?.bbox : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: '#0B0A09' }}>
      {uri && shown ? (
        <Animated.View key={`${shown.id}-${mode}`} entering={FadeIn.duration(220)} style={{ flex: 1 }}>
          <ZoomableImage uri={uri} aspect={shown.width / shown.height} bbox={bbox} accessibilityLabel={entity ? `Photo of ${entity.name}` : 'Evidence photo'} />
        </Animated.View>
      ) : (
        <View style={styles.center}>
          <T variant="callout" style={{ color: 'rgba(255,255,255,0.7)' }}>
            This photo isn’t available on this device.
          </T>
        </View>
      )}

      <View style={[styles.top, { paddingTop: insets.top + space.sm }]} pointerEvents="box-none">
        <IconButton icon={X} label="Close" tone="glass" onPress={() => router.back()} />
        {full ? (
          <View style={styles.toggle}>
            {(['close', 'full'] as const).map((m) => (
              <Pressable key={m} onPress={() => setMode(m)} style={[styles.toggleBtn, mode === m && styles.toggleOn]} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}>
                {m === 'close' ? <ScanSearch size={14} color={mode === m ? '#000' : '#fff'} /> : <Maximize2 size={14} color={mode === m ? '#000' : '#fff'} />}
                <T variant="caption" style={{ color: mode === m ? '#000' : '#fff', fontFamily: 'Inter_600SemiBold' }}>
                  {m === 'close' ? 'Close-up' : 'Full photo'}
                </T>
              </Pressable>
            ))}
          </View>
        ) : (
          <View />
        )}
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.md }]} pointerEvents="box-none">
        {entity ? (
          <View style={styles.caption}>
            <T variant="heading" style={{ color: '#fff' }}>
              {entity.name}
            </T>
            <T variant="caption" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {at ? formatWhen(at) : ''}
              {belief?.primary ? ` · ${sourcePhrase(belief.primary)}` : ''}
            </T>
            <T variant="caption" style={{ color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
              Pinch to zoom · drag to explore · double-tap to zoom in
            </T>
          </View>
        ) : null}
        {gallery.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg }}>
            {gallery.map((g) => (
              <Pressable
                key={g.obsId}
                onPress={() => {
                  setCurrentId(g.media.id);
                  setMode('close');
                }}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Photo from ${formatWhen(g.at)}`}
                style={[styles.thumb, g.media.id === currentId && styles.thumbOn]}
              >
                <EvidenceImage media={g.media} size={56} rounded={radius.sm} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg },
  toggle: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: radius.pill, padding: 3 },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill },
  toggleOn: { backgroundColor: '#fff' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: space.md },
  caption: { marginHorizontal: space.lg, padding: space.lg, borderRadius: radius.xl, backgroundColor: 'rgba(0,0,0,0.5)', gap: 2 },
  thumb: { borderRadius: radius.sm + 2, borderWidth: 2, borderColor: 'transparent' },
  thumbOn: { borderColor: '#EE7A4A' },
});
