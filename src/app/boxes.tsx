import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Plus, QrCode } from 'lucide-react-native';
import { contentsOf } from '@/core/queries';
import { useDerived } from '@/state/memory';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Button } from '@/ui/components/Button';
import { EmptyState } from '@/ui/components/EmptyState';
import { Card, Header, Screen } from '@/ui/components/Layout';
import { T } from '@/ui/components/Text';

export default function Boxes() {
  const { c } = useTheme();
  const boxes = useDerived((g) =>
    g
      .entities((e) => !!e.box)
      .sort((a, b) => a.box!.number - b.box!.number)
      .map((b) => ({ b, where: g.pathLabel(g.chainFrom(g.structuralPlacement(b.id)?.parentId)), items: contentsOf(g, b.id, { recursive: true }) })),
  );
  return (
    <Screen bottomInset={60}>
      <Header title="Storage boxes" subtitle="Scan a box’s label anytime to see what’s inside." right={<Button label="Scan label" icon={QrCode} size="sm" variant="secondary" onPress={() => router.push('/scan-qr')} />} />
      {boxes.length === 0 ? <EmptyState title="No boxes yet" body="Photograph what goes in, get a QR label, and never open five boxes to find one thing." action="Pack a box" onAction={() => router.push({ pathname: '/capture', params: { mode: 'box' } })} /> : null}
      <View style={{ gap: space.md }}>
        {boxes.map(({ b, where, items }) => (
          <Card key={b.id} onPress={() => router.push(`/box/${b.id}`)} style={styles.row} accessibilityLabel={`${b.name}, ${items.length} items, ${where}`}>
            <View style={[styles.num, { backgroundColor: c.ink }]}>
              <T variant="heading" style={{ color: c.inverse }}>
                {b.box!.number}
              </T>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="subheading">{b.box!.category ?? b.name}</T>
              <T variant="caption" color="muted" numberOfLines={1}>
                {where || 'No location yet'}
              </T>
              <T variant="caption" color="faint" numberOfLines={1}>
                {items.slice(0, 4).map((i) => (i.entity.sensitive ? 'Private item' : i.entity.name)).join(', ')}
                {items.length > 4 ? ` +${items.length - 4}` : ''}
              </T>
            </View>
          </Card>
        ))}
      </View>
      {boxes.length ? <Button label="Pack another box" icon={Plus} variant="ember" onPress={() => router.push({ pathname: '/capture', params: { mode: 'box' } })} style={{ marginTop: space.xl }} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  num: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
