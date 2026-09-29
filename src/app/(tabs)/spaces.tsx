import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Box, ChevronRight, DoorOpen, Home, Lock, Plus, Warehouse } from 'lucide-react-native';
import { createEntity, ensurePlace } from '@/core/operations';
import { itemCounts } from '@/core/queries';
import type { Entity, SpaceType } from '@/core/types';
import { useDerived, useMemory } from '@/state/memory';
import { useSession } from '@/state/session';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Button } from '@/ui/components/Button';
import { EmptyState } from '@/ui/components/EmptyState';
import { Card, Screen } from '@/ui/components/Layout';
import { Prompt, type PromptSpec } from '@/ui/components/Prompt';
import { T } from '@/ui/components/Text';

const SPACE_TYPES: { type: SpaceType; label: string }[] = [
  { type: 'home', label: 'Home' },
  { type: 'office', label: 'Office' },
  { type: 'dorm', label: 'Dorm' },
  { type: 'family_home', label: 'Parents’ house' },
  { type: 'storage_unit', label: 'Storage unit' },
  { type: 'garage', label: 'Garage' },
  { type: 'lab', label: 'Lab' },
  { type: 'workshop', label: 'Workshop' },
];

/** Memory Map — a browsable digital twin of everything you own. */
export default function Spaces() {
  const { graph } = useMemory();
  const { c } = useTheme();
  const [prompt, setPrompt] = useState<PromptSpec | null>(null);
  const { requireSignIn } = useSession();

  const tree = useDerived((g) => {
    const counts = itemCounts(g);
    return g.spaces().map((s) => ({
      space: s,
      count: counts.get(s.id) ?? 0,
      rooms: g.structuralChildren(s.id).map((r) => ({
        room: r,
        count: counts.get(r.id) ?? 0,
        children: g.structuralChildren(r.id).map((f) => ({ e: f, count: counts.get(f.id) ?? 0, sub: g.structuralChildren(f.id).map((x) => ({ e: x, count: counts.get(x.id) ?? 0 })) })),
      })),
    }));
  });

  const addSpace = () =>
    requireSignIn('save') &&
    setPrompt({
      title: 'Add a space',
      message: 'A place with its own rooms — home, office, parents’ house, storage unit…',
      placeholder: 'Name',
      suggestions: SPACE_TYPES.map((s) => s.label),
      onSubmit: (v) => {
        const t = SPACE_TYPES.find((s) => s.label.toLowerCase() === v.toLowerCase())?.type ?? 'other';
        createEntity(graph, { kind: 'space', name: v, spaceType: t });
      },
    });
  const addRoom = (s: Entity) =>
    requireSignIn('save') &&
    setPrompt({ title: `Add a room to ${s.name}`, placeholder: 'Room', suggestions: ['Bedroom', 'Kitchen', 'Living room', 'Office', 'Bathroom', 'Garage', 'Closet'], onSubmit: (v) => ensurePlace(graph, s.id, v, 'room') });

  return (
    <Screen>
      <T variant="title">Memory map</T>
      <T variant="callout" color="muted" style={{ marginTop: space.xs, marginBottom: space.xl }}>
        Everything you’ve shown the camera, organised the way your world is.
      </T>

      {tree.length === 0 ? (
        <EmptyState title="No spaces yet" body="Spaces appear as you remember things — or add one now." action="Add a space" onAction={addSpace} />
      ) : null}

      {tree.map(({ space: s, count, rooms }, si) => (
        <Animated.View key={s.id} entering={FadeInDown.delay(si * 60)} style={{ marginBottom: space.xxl }}>
          <Pressable onPress={() => router.push(`/place/${s.id}`)} style={styles.spaceHead} accessibilityRole="button">
            <View style={[styles.spaceIcon, { backgroundColor: c.ink }]}>{s.spaceType === 'storage_unit' || s.spaceType === 'garage' ? <Warehouse size={18} color={c.inverse} /> : <Home size={18} color={c.inverse} />}</View>
            <View style={{ flex: 1 }}>
              <T variant="heading">{s.name}</T>
              <T variant="caption" color="muted">
                {count} {count === 1 ? 'item' : 'items'} · {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'}
              </T>
            </View>
            <ChevronRight size={18} color={c.faint} />
          </Pressable>

          <View style={styles.grid}>
            {rooms.map(({ room, count: rc, children }) => (
              <View key={room.id} style={styles.cell}>
              <Card onPress={() => router.push(`/place/${room.id}`)} style={styles.roomCard} accessibilityLabel={`${room.name}, ${rc} items`}>
                <View style={styles.roomTop}>
                  <DoorOpen size={18} color={c.inkSoft} />
                  {room.privateZone ? <Lock size={14} color={c.ember} /> : null}
                </View>
                <T variant="subheading" numberOfLines={1}>
                  {room.name}
                </T>
                <T variant="caption" color="muted">
                  {rc} {rc === 1 ? 'item' : 'items'}
                </T>
                <View style={{ gap: 4, marginTop: space.sm }}>
                  {children.slice(0, 3).map(({ e, count: fc, sub }) => (
                    <View key={e.id}>
                      <View style={styles.childRow}>
                        {e.box ? <Box size={12} color={c.faint} /> : <View style={[styles.bullet, { backgroundColor: c.lineStrong }]} />}
                        <T variant="caption" color="inkSoft" numberOfLines={1} style={{ flex: 1 }}>
                          {e.name}
                        </T>
                        <T variant="caption" color="faint">
                          {fc}
                        </T>
                      </View>
                      {sub.slice(0, 2).map((x) => (
                        <View key={x.e.id} style={[styles.childRow, { paddingLeft: 12 }]}>
                          <View style={[styles.bullet, { backgroundColor: c.line }]} />
                          <T variant="caption" color="muted" numberOfLines={1} style={{ flex: 1 }}>
                            {x.e.name}
                          </T>
                          <T variant="caption" color="faint">
                            {x.count}
                          </T>
                        </View>
                      ))}
                    </View>
                  ))}
                  {children.length > 3 ? (
                    <T variant="caption" color="faint">
                      +{children.length - 3} more
                    </T>
                  ) : null}
                </View>
              </Card>
              </View>
            ))}
            <Pressable onPress={() => addRoom(s)} style={[styles.cell, styles.roomCard, styles.addRoom, { borderColor: c.lineStrong }]} accessibilityRole="button" accessibilityLabel={`Add a room to ${s.name}`}>
              <Plus size={20} color={c.muted} />
              <T variant="label" color="muted">
                Add room
              </T>
            </Pressable>
          </View>
        </Animated.View>
      ))}

      {tree.length ? <Button label="Add a space" icon={Plus} variant="secondary" onPress={addSpace} /> : null}
      <Prompt spec={prompt} onClose={() => setPrompt(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  spaceHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  spaceIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { width: '47.5%' },
  roomCard: { minHeight: 150, padding: space.md, gap: 2 },
  roomTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.sm },
  addRoom: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  childRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bullet: { width: 5, height: 5, borderRadius: 3 },
});
