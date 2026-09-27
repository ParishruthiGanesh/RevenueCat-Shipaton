import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Building2, ChevronRight, DoorOpen, Home, Package, Sofa, Warehouse } from 'lucide-react-native';
import type { Entity } from '@/core/types';
import { useTheme } from '../theme';
import { radius, space } from '../tokens';
import { T } from './Text';

function iconFor(e: Entity) {
  if (e.kind === 'space') return e.spaceType === 'home' || e.spaceType === 'family_home' ? Home : e.spaceType === 'storage_unit' || e.spaceType === 'garage' ? Warehouse : Building2;
  if (e.kind === 'room') return DoorOpen;
  if (e.kind === 'fixture') return Sofa;
  return Package;
}

/**
 * The physical hierarchy as a readable path: Home › Bedroom › Black dresser › Top drawer.
 * `vertical` renders the indented tree used on answer cards.
 */
export function Breadcrumb({ path, vertical, navigable = true }: { path: Entity[]; vertical?: boolean; navigable?: boolean }) {
  const { c } = useTheme();
  if (vertical) {
    return (
      <View accessible accessibilityLabel={path.map((p) => p.name).join(', inside ')}>
        {path.map((e, i) => {
          const Icon = iconFor(e);
          const last = i === path.length - 1;
          return (
            <Pressable key={e.id} disabled={!navigable} onPress={() => router.push(e.kind === 'item' ? `/item/${e.id}` : `/place/${e.id}`)} style={[styles.vRow, { paddingLeft: i * 14 }]}>
              {i > 0 ? <View style={[styles.elbow, { borderColor: c.lineStrong, left: (i - 1) * 14 + 12 }]} /> : null}
              <View style={[styles.vIcon, { backgroundColor: last ? c.ink : c.surfaceMuted }]}>
                <Icon size={13} color={last ? c.inverse : c.inkSoft} />
              </View>
              <T variant={last ? 'bodyStrong' : 'callout'} color={last ? 'ink' : 'inkSoft'}>
                {e.name}
              </T>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View style={styles.hWrap} accessible accessibilityLabel={path.map((p) => p.name).join(' › ')}>
      {path.map((e, i) => (
        <React.Fragment key={e.id}>
          {i > 0 ? <ChevronRight size={12} color={c.faint} /> : null}
          <Pressable disabled={!navigable} onPress={() => router.push(`/place/${e.id}`)} style={[styles.hChip, i === path.length - 1 && { backgroundColor: c.surfaceMuted }]}>
            <T variant="caption" color={i === path.length - 1 ? 'ink' : 'muted'} numberOfLines={1}>
              {e.name}
            </T>
          </Pressable>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  vRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 5 },
  elbow: { position: 'absolute', left: 0, top: -6, width: 10, height: 18, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderBottomLeftRadius: 6, marginLeft: -2 },
  vIcon: { width: 24, height: 24, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  hWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 2 },
  hChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm },
});
