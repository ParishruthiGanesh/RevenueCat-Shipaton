import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Undo2 } from 'lucide-react-native';
import { returnLoan } from '@/core/operations';
import { formatAgo } from '@/core/phrasing';
import { activeLoans } from '@/core/queries';
import { useDerived, useMemory } from '@/state/memory';
import { space } from '@/ui/tokens';
import { Button } from '@/ui/components/Button';
import { EmptyState } from '@/ui/components/EmptyState';
import { Card, Header, Screen } from '@/ui/components/Layout';
import { T } from '@/ui/components/Text';

export default function Loans() {
  const { graph } = useMemory();
  const loans = useDerived((g) => activeLoans(g).map((l) => ({ l, item: g.entity(l.itemId), who: g.person(l.personId) })));
  return (
    <Screen bottomInset={60}>
      <Header title="Lent to others" subtitle="Things marked as lent report the loan instead of a stale location." />
      {loans.length === 0 ? <EmptyState illustration={false} title="Nothing lent out" body="Open any object and choose “Lend to someone”, or say “I lent this camera to Sarah” while capturing." /> : null}
      <View style={{ gap: space.md }}>
        {loans.map(({ l, item, who }) =>
          item ? (
            <Card key={l.id} onPress={() => router.push(`/item/${item.id}`)} style={{ gap: space.sm }}>
              <T variant="subheading">{item.name}</T>
              <T variant="callout" color="muted">
                With {who?.name ?? 'someone'} · lent {formatAgo(l.lentAt)}
              </T>
              <Button label="Mark as returned" icon={Undo2} size="sm" variant="secondary" onPress={() => returnLoan(graph, l.id)} style={{ alignSelf: 'flex-start' }} />
            </Card>
          ) : null,
        )}
      </View>
    </Screen>
  );
}
