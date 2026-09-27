import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Box, ChevronRight, Lock, MoveRight, Pencil, Plus, Printer, ScanLine, Trash2 } from 'lucide-react-native';
import { deleteEntity, ensurePlace, moveEntity, updateEntity } from '@/core/operations';
import { breadcrumb, formatAgo, softLower } from '@/core/phrasing';
import { contentsOf, itemCounts, placesNotScannedSince } from '@/core/queries';
import { resolvePlace } from '@/core/search';
import { useDerived, useMemory } from '@/state/memory';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { BoxLabel, printBoxLabel } from '@/ui/components/BoxLabel';
import { Breadcrumb } from '@/ui/components/Breadcrumb';
import { Button } from '@/ui/components/Button';
import { EmptyState } from '@/ui/components/EmptyState';
import { Card, Header, Row, Screen, Section, ToggleRow } from '@/ui/components/Layout';
import { ObjectCard } from '@/ui/components/ObjectCard';
import { Prompt, type PromptSpec } from '@/ui/components/Prompt';
import { T } from '@/ui/components/Text';

const CHILD_KIND = { space: 'room', room: 'fixture', fixture: 'container', container: 'container', item: 'container' } as const;
const CHILD_LABEL = { space: 'room', room: 'furniture', fixture: 'drawer or shelf', container: 'compartment', item: 'compartment' } as const;

export default function PlaceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { graph } = useMemory();
  const { c } = useTheme();
  const [prompt, setPrompt] = useState<PromptSpec | null>(null);

  const data = useDerived(
    (g) => {
      const place = g.entity(id);
      if (!place) return null;
      const counts = itemCounts(g);
      const parent = g.structuralPlacement(place.id)?.parentId;
      const lastScan = placesNotScannedSince(g, 0).find((x) => x.place.id === place.id)?.lastScan;
      return {
        place,
        path: breadcrumb(g, g.chainFrom(parent)),
        children: g.structuralChildren(place.id).map((ch) => ({ e: ch, count: counts.get(ch.id) ?? 0 })),
        direct: contentsOf(g, place.id),
        nested: contentsOf(g, place.id, { recursive: true }).filter((x) => x.depth > 0),
        lastScan,
      };
    },
    [id],
  );

  if (!data) {
    return (
      <Screen>
        <Header title="Not found" />
      </Screen>
    );
  }
  const { place, path, children, direct, nested, lastScan } = data;
  const isBox = !!place.box;

  const addChild = () =>
    setPrompt({
      title: `Add a ${CHILD_LABEL[place.kind]}`,
      placeholder: 'Name',
      suggestions: place.kind === 'fixture' ? ['Top drawer', 'Middle drawer', 'Bottom drawer', 'Shelf 1', 'Shelf 2'] : place.kind === 'room' ? ['Dresser', 'Desk', 'Nightstand', 'Closet', 'Bookshelf', 'Cabinet'] : [],
      onSubmit: (v) => ensurePlace(graph, place.id, v, CHILD_KIND[place.kind]),
    });
  const rename = () => setPrompt({ title: 'Rename', initial: place.name, onSubmit: (v) => updateEntity(graph, place.id, { name: v }) });
  const move = () =>
    setPrompt({
      title: `Move ${place.name}`,
      message: 'Where is it now? Everything inside moves with it.',
      placeholder: 'e.g. Storage unit, garage shelf',
      suggestions: graph.entities((e) => e.kind === 'room' || e.kind === 'fixture' || e.kind === 'space').filter((e) => e.id !== place.id).map((e) => e.name).slice(0, 6),
      confirm: 'Move',
      onSubmit: (v) => {
        const dest = resolvePlace(graph, v);
        if (dest && dest.id !== place.id && !graph.chainFrom(dest.id).includes(place.id)) moveEntity(graph, place.id, dest.id, 'manual');
        else Alert.alert('Unknown place', `I don’t know “${v}” yet. Add it on the Memory map first, or scan the box’s label where it is.`);
      },
    });
  const remove = () =>
    Alert.alert(`Delete ${place.name}?`, direct.length || children.length ? 'Things recorded inside keep their history, but will show as “unknown place” until you remember them again.' : 'This place will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteEntity(graph, place.id);
          router.back();
        },
      },
    ]);

  return (
    <Screen bottomInset={60}>
      <Header back />
      {path.length ? <Breadcrumb path={path} /> : null}
      <T variant="overline" color="muted" style={{ marginTop: space.md }}>
        {isBox ? `Storage box #${place.box!.number}` : place.kind === 'space' ? 'Space' : place.kind === 'room' ? 'Room' : place.kind === 'fixture' ? 'Furniture' : 'Container'}
      </T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <T variant="title" style={{ flexShrink: 1 }}>
          {place.name}
        </T>
        {place.privateZone ? <Lock size={18} color={c.ember} /> : null}
      </View>
      <T variant="callout" color="muted">
        {direct.length + nested.length} {direct.length + nested.length === 1 ? 'thing' : 'things'} last recorded here
        {lastScan ? ` · scanned ${formatAgo(lastScan)}` : ''}
      </T>

      <View style={styles.actions}>
        <Button label={isBox ? 'Rescan contents' : 'Scan this'} icon={ScanLine} onPress={() => router.push({ pathname: '/capture', params: { mode: isBox ? 'box' : 'scan', targetId: place.id } })} style={{ flex: 1 }} />
        {place.kind !== 'space' && (isBox || place.kind === 'fixture' || place.kind === 'container') ? <Button label="Move" icon={MoveRight} variant="secondary" onPress={move} style={{ flex: 1 }} /> : null}
      </View>

      {isBox ? (
        <Section title="Label">
          <BoxLabel graph={graph} box={place} />
          <Button label="Print / share label" icon={Printer} variant="secondary" onPress={() => printBoxLabel(graph, place)} style={{ marginTop: space.md }} />
        </Section>
      ) : null}

      {children.length ? (
        <Section title="Inside" action={`Add ${CHILD_LABEL[place.kind]}`} onAction={addChild}>
          <Card style={{ paddingVertical: space.xs }}>
            {children.map(({ e, count }) => (
              <Row key={e.id} icon={e.box ? Box : undefined} title={e.name} subtitle={`${count} ${count === 1 ? 'item' : 'items'}`} onPress={() => router.push(`/place/${e.id}`)} right={<ChevronRight size={18} color={c.faint} />} />
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Things here">
        {direct.length === 0 && nested.length === 0 ? (
          <EmptyState illustration={false} title="Nothing recorded here yet" body={`Scan ${softLower(place.name)} to remember everything in it at once.`} />
        ) : (
          <View style={{ gap: space.sm }}>
            {direct.map((x) => (
              <ObjectCard key={x.entity.id} graph={graph} entity={x.entity} belief={x.belief} />
            ))}
            {nested.length ? (
              <T variant="overline" color="muted" style={{ marginTop: space.md }}>
                Deeper inside
              </T>
            ) : null}
            {nested.map((x) => (
              <ObjectCard key={x.entity.id} graph={graph} entity={x.entity} belief={x.belief} />
            ))}
          </View>
        )}
      </Section>

      <Section title="Settings">
        <Card style={{ paddingVertical: space.xs }}>
          <ToggleRow icon={Lock} title="Private zone" subtitle="No passive recognition here. Contents are hidden from shared family members." value={place.privateZone} onValueChange={(v) => updateEntity(graph, place.id, { privateZone: v })} />
          <Row icon={Pencil} title="Rename" onPress={rename} />
          {!children.length ? <Row icon={Plus} title={`Add ${CHILD_LABEL[place.kind]}`} onPress={addChild} /> : null}
          <Row icon={Trash2} title="Delete place" danger onPress={remove} />
        </Card>
      </Section>
      <Prompt spec={prompt} onClose={() => setPrompt(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xl },
  tile: { borderRadius: radius.lg },
});
