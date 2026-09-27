import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, CircleDashed, CircleHelp, PlaneLanding, ScanLine } from 'lucide-react-native';
import { computeBelief } from '@/core/beliefs';
import { tripStatus } from '@/core/insights';
import { setTripItemState } from '@/core/operations';
import { formatAgo } from '@/core/phrasing';
import type { TripItemState } from '@/core/types';
import { useDerived, useMemory } from '@/state/memory';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Button } from '@/ui/components/Button';
import { Card, Header, Screen, Section } from '@/ui/components/Layout';
import { T } from '@/ui/components/Text';

const LABEL: Record<TripItemState, string> = { packed: 'Packed', not_packed: 'Not packed', needs_confirmation: 'Needs confirmation', arrived: 'Arrived', left_behind: 'Left behind' };

export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { graph } = useMemory();
  const { c, confidence } = useTheme();
  const data = useDerived(
    (g) => {
      const trip = g.trips().find((t) => t.id === id);
      if (!trip) return null;
      return { trip, rows: tripStatus(g, trip).map((s) => ({ s, e: g.entity(s.itemId), b: computeBelief(g, s.itemId) })), bag: g.entity(trip.bagIds[0]) };
    },
    [id],
  );
  if (!data) return <Screen><Header title="Trip not found" /></Screen>;
  const { trip, rows, bag } = data;
  const color = (s: TripItemState) => (s === 'packed' || s === 'arrived' ? confidence.high : s === 'needs_confirmation' ? confidence.medium : s === 'left_behind' ? confidence.low : confidence.unknown);
  const cycle = (st: TripItemState): TripItemState => (st === 'not_packed' ? 'packed' : st === 'packed' || st === 'needs_confirmation' ? 'not_packed' : st);
  const departed = trip.departsAt ? new Date(trip.departsAt) < new Date() : false;

  return (
    <Screen bottomInset={60}>
      <Header title={trip.name} subtitle={bag ? `Packing into ${bag.name}` : 'No bag selected — items are confirmed by what you tick'} />
      {bag ? <Button label={`Scan ${bag.name}`} icon={ScanLine} variant="ember" onPress={() => router.push({ pathname: '/capture', params: { mode: 'scan', targetId: bag.id } })} /> : null}
      <T variant="caption" color="muted" style={{ marginTop: space.sm }}>
        Scanning the open bag confirms what’s actually inside.
      </T>

      <Section title="Checklist">
        <Card style={{ paddingVertical: space.xs }}>
          {rows.map(({ s, e, b }) =>
            e ? (
              <Pressable key={s.itemId} onPress={() => setTripItemState(graph, trip.id, s.itemId, cycle(s.state))} style={[styles.row, { borderBottomColor: c.line }]} accessibilityRole="button" accessibilityLabel={`${e.name}: ${LABEL[s.state]}`}>
                {s.state === 'packed' || s.state === 'arrived' ? <CircleCheck size={22} color={color(s.state).dot} /> : s.state === 'needs_confirmation' ? <CircleHelp size={22} color={color(s.state).dot} /> : <CircleDashed size={22} color={c.faint} />}
                <View style={{ flex: 1 }}>
                  <T variant="bodyStrong">{e.name}</T>
                  <T variant="caption" color="muted">
                    {s.observedInBag ? 'Seen in the bag' : b.primary ? `Last seen in ${graph.entity(b.primary.currentChain[0])?.name} ${formatAgo(b.primary.observation.observedAt)}` : 'Not seen yet'}
                  </T>
                </View>
                <View style={[styles.state, { backgroundColor: color(s.state).bg }]}>
                  <T variant="caption" style={{ color: color(s.state).fg, fontFamily: 'Inter_600SemiBold' }}>
                    {LABEL[s.state]}
                  </T>
                </View>
              </Pressable>
            ) : null,
          )}
        </Card>
      </Section>

      {departed && !trip.closedAt ? (
        <Section title="On arrival">
          <Card style={{ gap: space.sm }}>
            <T variant="subheading">Did everything arrive?</T>
            <T variant="callout" color="muted">
              Scan your bag at the hotel to confirm, or tick items off.
            </T>
            <Button
              label="Mark all packed items as arrived"
              icon={PlaneLanding}
              variant="secondary"
              onPress={() => rows.filter((r) => r.s.state === 'packed').forEach((r) => setTripItemState(graph, trip.id, r.s.itemId, 'arrived'))}
            />
          </Card>
        </Section>
      ) : null}

      {!trip.closedAt ? (
        <Button
          label="Finish trip"
          variant="ghost"
          style={{ marginTop: space.xl }}
          onPress={() => graph.commit([{ op: 'upsert', table: 'trips', row: { ...trip, closedAt: new Date().toISOString() } }])}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  state: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
});
