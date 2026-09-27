import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { MapPin, X } from 'lucide-react-native';
import { findBoxByCode, moveEntity } from '@/core/operations';
import { contentsOf } from '@/core/queries';
import { resolvePlace } from '@/core/search';
import type { Entity } from '@/core/types';
import { useMemory } from '@/state/memory';
import { track } from '@/services/analytics';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Button, IconButton } from '@/ui/components/Button';
import { Prompt, type PromptSpec } from '@/ui/components/Prompt';
import { T } from '@/ui/components/Text';

/** Scan a box label → instantly see its contents, and record where the box is now. */
export default function ScanQR() {
  const { graph } = useMemory();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [box, setBox] = useState<Entity | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [prompt, setPrompt] = useState<PromptSpec | null>(null);
  const lock = useRef(false);

  const onScan = ({ data }: { data: string }) => {
    if (lock.current || box) return;
    lock.current = true;
    const found = findBoxByCode(graph, data);
    Haptics.notificationAsync(found ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    if (found) {
      setBox(found);
      track('box_scanned', { via: 'qr' });
    } else {
      setUnknown(true);
      setTimeout(() => {
        setUnknown(false);
        lock.current = false;
      }, 1800);
    }
  };

  if (!permission?.granted) {
    return (
      <View style={[styles.perm, { backgroundColor: c.bg, paddingTop: insets.top + space.xl }]}>
        <T variant="title">Scan a box label</T>
        <T variant="body" color="muted">
          The camera reads the QR code on your box label. Nothing is recorded.
        </T>
        <Button label="Allow camera" variant="ember" onPress={requestPermission} />
        <Button label="Close" variant="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  const where = box ? graph.pathLabel(graph.chainFrom(graph.structuralPlacement(box.id)?.parentId)) : '';
  const items = box ? contentsOf(graph, box.id, { recursive: true }) : [];

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={box ? undefined : onScan} />
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <IconButton icon={X} label="Close" tone="glass" onPress={() => router.back()} />
      </View>
      {!box ? (
        <View style={styles.center} pointerEvents="none">
          <View style={styles.reticle} />
          <T variant="bodyStrong" style={{ color: '#fff', marginTop: space.lg }}>
            {unknown ? 'That label isn’t one of your boxes' : 'Point at a box label'}
          </T>
        </View>
      ) : (
        <Animated.View entering={FadeInUp.springify()} style={[styles.sheet, { backgroundColor: c.bgElevated, paddingBottom: insets.bottom + space.lg }]}>
          <T variant="overline" color="muted">
            Storage box #{box.box!.number}
          </T>
          <T variant="title">{box.box!.category ?? box.name}</T>
          <T variant="callout" color="muted">
            {where || 'No location recorded'}
          </T>
          <T variant="body" style={{ marginTop: space.sm }}>
            {items.length ? items.map((i) => (i.entity.sensitive ? 'Private item' : i.entity.name)).join(' · ') : 'No contents recorded yet.'}
          </T>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
            <Button label="Open box" onPress={() => router.replace(`/box/${box.id}`)} style={{ flex: 1 }} />
            <Button
              label="It’s here now"
              icon={MapPin}
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() =>
                setPrompt({
                  title: `Where is ${box.name} now?`,
                  placeholder: 'e.g. Storage unit, rack 4',
                  suggestions: graph.entities((e) => e.kind === 'room' || e.kind === 'fixture' || e.kind === 'space').map((e) => e.name).slice(0, 6),
                  confirm: 'Update',
                  onSubmit: (v) => {
                    const dest = resolvePlace(graph, v);
                    if (dest && dest.id !== box.id) {
                      moveEntity(graph, box.id, dest.id, 'qr_scan');
                      router.replace(`/box/${box.id}`);
                    }
                  },
                })
              }
            />
          </View>
          <Button label="Scan another" variant="ghost" onPress={() => { setBox(null); lock.current = false; }} />
        </Animated.View>
      )}
      <Prompt spec={prompt} onClose={() => setPrompt(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  perm: { flex: 1, padding: space.xl, gap: space.lg },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  reticle: { width: 230, height: 230, borderRadius: radius.xxl, borderWidth: 3, borderColor: '#fff' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: space.xl, gap: space.xs },
});
