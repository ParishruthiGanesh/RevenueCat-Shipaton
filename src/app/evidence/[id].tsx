import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { formatWhen, sourcePhrase } from '@/core/phrasing';
import { computeBelief } from '@/core/beliefs';
import { useMemory } from '@/state/memory';
import { space } from '@/ui/tokens';
import { IconButton } from '@/ui/components/Button';
import { EvidenceImage } from '@/ui/components/EvidenceImage';
import { T } from '@/ui/components/Text';

/** Full-screen evidence with the detection outlined — "Show me". */
export default function Evidence() {
  const { id, entityId } = useLocalSearchParams<{ id: string; entityId?: string }>();
  const { graph } = useMemory();
  const insets = useSafeAreaInsets();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const media = graph.media(id);
  const entity = graph.entity(entityId);
  const belief = entity ? computeBelief(graph, entity.id) : undefined;
  const obs = belief?.primary?.observation;
  // Crops are already tight; outline only when showing a full frame.
  const bbox = media?.kind === 'frame' ? obs?.bbox : undefined;
  const aspect = media ? media.width / media.height : 1;

  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={styles.center}>
        <View onLayout={onLayout} style={{ width: '100%', aspectRatio: aspect }}>
          <EvidenceImage media={media} name={entity?.name} style={StyleSheet.absoluteFill} rounded={0} />
          {bbox && box.w ? <View pointerEvents="none" style={[styles.bbox, { left: bbox.x * box.w, top: bbox.y * box.h, width: bbox.w * box.w, height: bbox.h * box.h }]} /> : null}
        </View>
      </View>
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <IconButton icon={X} label="Close" tone="glass" onPress={() => router.back()} />
      </View>
      {entity && obs ? (
        <View style={[styles.caption, { paddingBottom: insets.bottom + space.lg }]}>
          <T variant="heading" style={{ color: '#fff' }}>
            {entity.name}
          </T>
          <T variant="callout" style={{ color: 'rgba(255,255,255,0.8)' }}>
            {formatWhen(obs.observedAt)} · {sourcePhrase(belief?.primary)}
          </T>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space.lg },
  bbox: { position: 'absolute', borderWidth: 2.5, borderColor: '#EE7A4A', borderRadius: 10 },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.xl, backgroundColor: 'rgba(0,0,0,0.5)', gap: 4 },
});
