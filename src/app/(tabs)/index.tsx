import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Box, Camera, CloudOff, HandHelping, QrCode, ScanLine, TriangleAlert } from 'lucide-react-native';
import { computeBelief } from '@/core/beliefs';
import { computeInsights } from '@/core/insights';
import { formatAgo, softLower } from '@/core/phrasing';
import { activeLoans, movesBetween, recentlyRemembered, uncertainItems } from '@/core/queries';
import { useDerived, useMemory } from '@/state/memory';
import { useSession } from '@/state/session';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { AskBar } from '@/ui/components/AskBar';
import { Button } from '@/ui/components/Button';
import { EmptyState } from '@/ui/components/EmptyState';
import { EvidenceImage } from '@/ui/components/EvidenceImage';
import { Card, Screen, Section } from '@/ui/components/Layout';
import { ObjectCard, ObjectTile } from '@/ui/components/ObjectCard';
import { T } from '@/ui/components/Text';

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function QuickAction({ icon: Icon, label, onPress }: { icon: typeof Camera; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.qa, { backgroundColor: c.surface, borderColor: c.line, opacity: pressed ? 0.8 : 1 }]}>
      <View style={[styles.qaIcon, { backgroundColor: c.surfaceMuted }]}>
        <Icon size={20} color={c.ink} />
      </View>
      <T variant="caption" align="center" numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: 'Inter_500Medium' }}>
        {label}
      </T>
    </Pressable>
  );
}

export default function Home() {
  const { graph } = useMemory();
  const { c, simple } = useTheme();
  const { online, backend } = useSession();
  const [q, setQ] = useState('');

  const data = useDerived((g) => {
    const now = new Date();
    const recent = recentlyRemembered(g, 10).map((e) => ({ e, b: computeBelief(g, e.id, now) }));
    const moved = movesBetween(g, new Date(now.getTime() - 7 * 86400e3).toISOString(), now.toISOString()).slice(0, 4);
    const uncertain = uncertainItems(g, now).slice(0, 3);
    const boxes = g.entities((e) => !!e.box).sort((a, b) => b.box!.number - a.box!.number);
    const insights = computeInsights(g, now).slice(0, 3);
    const itemCount = g.items().length;
    const suggestions = recent.slice(0, 3).map(({ e }) => `Where is my ${softLower(e.name)}?`);
    return { recent, moved, uncertain, boxes, insights, itemCount, loans: activeLoans(g).length, suggestions };
  });

  const ask = (text: string) => router.push({ pathname: '/(tabs)/search', params: { q: text } });

  if (data.itemCount === 0) {
    return (
      <Screen>
        <T variant="overline" color="muted">
          {greeting()}
        </T>
        <T variant="hero" style={{ marginTop: space.sm }}>
          Never ask “where did I put that?” again.
        </T>
        <EmptyState title="Let’s remember your first object" body="Point your camera at something and where you’re putting it — a passport in a drawer, keys on a hook. Say it out loud if you like." action="Remember something" onAction={() => router.push('/capture')} />
        <Card tone="muted" style={{ gap: space.sm }}>
          <T variant="subheading">Packing boxes?</T>
          <T variant="callout" color="muted">
            Storage Box mode photographs what goes in, prints a QR label, and tells you later which box has the coffee grinder.
          </T>
          <Button label="Create a box" icon={Box} variant="secondary" onPress={() => router.push({ pathname: '/capture', params: { mode: 'box' } })} style={{ alignSelf: 'flex-start', marginTop: space.xs }} />
        </Card>
      </Screen>
    );
  }

  if (simple) {
    return (
      <Screen>
        <T variant="hero">What are you looking for?</T>
        <View style={{ marginTop: space.xl }}>
          <AskBar value={q} onChangeText={setQ} onSubmit={ask} placeholder="Where are my glasses?" />
        </View>
        <View style={{ gap: space.md, marginTop: space.xl }}>
          {data.suggestions.map((s) => (
            <Button key={s} label={s} variant="secondary" size="lg" full onPress={() => ask(s)} />
          ))}
          <Button label="Remember where I’m putting something" icon={Camera} variant="ember" size="lg" full onPress={() => router.push('/capture')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.topRow}>
        <T variant="overline" color="muted">
          {greeting()}
        </T>
        {backend && !online ? (
          <View style={[styles.offline, { backgroundColor: c.surfaceMuted }]}>
            <CloudOff size={13} color={c.muted} />
            <T variant="caption" color="muted">
              Offline — memory still works
            </T>
          </View>
        ) : null}
      </View>
      <T variant="hero" style={{ marginTop: space.sm, marginBottom: space.xl }}>
        What are you looking for?
      </T>
      <AskBar value={q} onChangeText={setQ} onSubmit={ask} />
      {data.suggestions.length ? (
        <View style={styles.suggestions}>
          {data.suggestions.map((s) => (
            <Pressable key={s} onPress={() => ask(s)} style={[styles.suggestion, { borderColor: c.line }]} accessibilityRole="button">
              <T variant="caption" color="inkSoft">
                {s}
              </T>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.qaRow}>
        <QuickAction icon={Camera} label="Remember" onPress={() => router.push('/capture')} />
        <QuickAction icon={ScanLine} label="Scan area" onPress={() => router.push({ pathname: '/capture', params: { mode: 'scan' } })} />
        <QuickAction icon={Box} label="New box" onPress={() => router.push({ pathname: '/capture', params: { mode: 'box' } })} />
        <QuickAction icon={QrCode} label="Scan label" onPress={() => router.push('/scan-qr')} />
      </View>

      {data.insights.length ? (
        <Section title="Needs attention">
          <View style={{ gap: space.sm }}>
            {data.insights.map((i, idx) => (
              <Animated.View key={i.id} entering={FadeInDown.delay(idx * 60)}>
                <Card tone="ember" onPress={() => i.entityId && router.push(graph.entity(i.entityId)?.box ? `/box/${i.entityId}` : `/item/${i.entityId}`)} style={styles.insight}>
                  {i.kind === 'loan_overdue' ? <HandHelping size={20} color={c.emberInk} /> : <TriangleAlert size={20} color={c.emberInk} />}
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong" style={{ color: c.emberInk }}>
                      {i.title}
                    </T>
                    <T variant="caption" style={{ color: c.emberInk }}>
                      {i.body}
                    </T>
                  </View>
                </Card>
              </Animated.View>
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Recently remembered" action="See all" onAction={() => router.push('/(tabs)/spaces')}>
        <FlatList
          horizontal
          data={data.recent}
          keyExtractor={(x) => x.e.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.md, paddingRight: space.xl }}
          style={{ marginHorizontal: -space.xl, paddingLeft: space.xl }}
          renderItem={({ item }) => <ObjectTile graph={graph} entity={item.e} belief={item.b} />}
        />
      </Section>

      {data.uncertain.length ? (
        <Section title="Uncertain locations" action="All" onAction={() => ask('What objects have uncertain locations?')}>
          <View style={{ gap: space.sm }}>
            {data.uncertain.map((b) => {
              const e = graph.entity(b.entityId)!;
              return <ObjectCard key={e.id} graph={graph} entity={e} belief={b} />;
            })}
          </View>
        </Section>
      ) : null}

      {data.moved.length ? (
        <Section title="Recently moved">
          <Card style={{ gap: space.md }}>
            {data.moved.map((m) => (
              <Pressable key={m.to.id} onPress={() => router.push(`/item/${m.entity.id}`)} style={styles.moveRow} accessibilityRole="button">
                <EvidenceImage media={graph.media(m.to.mediaId ?? m.entity.coverMediaId)} name={m.entity.name} size={40} rounded={radius.sm} sensitive={m.entity.sensitive} />
                <View style={{ flex: 1 }}>
                  <T variant="bodyStrong">{m.entity.name}</T>
                  <T variant="caption" color="muted" numberOfLines={1}>
                    {graph.entity(m.from.placement!.parentId)?.name} → {graph.entity(m.to.placement!.parentId)?.name}
                  </T>
                </View>
                <T variant="caption" color="faint">
                  {formatAgo(m.to.observedAt)}
                </T>
              </Pressable>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Storage boxes" action={data.boxes.length ? 'All boxes' : undefined} onAction={() => router.push('/boxes')}>
        {data.boxes.length ? (
          <FlatList
            horizontal
            data={data.boxes.slice(0, 8)}
            keyExtractor={(b) => b.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.md, paddingRight: space.xl }}
            style={{ marginHorizontal: -space.xl, paddingLeft: space.xl }}
            renderItem={({ item }) => {
              const chain = graph.chainFrom(graph.structuralPlacement(item.id)?.parentId);
              return (
                <Card onPress={() => router.push(`/box/${item.id}`)} style={{ width: 150, gap: space.xs }} accessibilityLabel={item.name}>
                  <View style={[styles.boxNum, { backgroundColor: c.ink }]}>
                    <T variant="heading" style={{ color: c.inverse }}>
                      {item.box!.number}
                    </T>
                  </View>
                  <T variant="label" numberOfLines={1}>
                    {item.box!.category ?? item.name}
                  </T>
                  <T variant="caption" color="muted" numberOfLines={1}>
                    {graph.entity(chain[0])?.name ?? 'No location yet'}
                  </T>
                </Card>
              );
            }}
          />
        ) : (
          <Card tone="muted" onPress={() => router.push({ pathname: '/capture', params: { mode: 'box' } })}>
            <T variant="bodyStrong">Pack a box with a QR label</T>
            <T variant="caption" color="muted">
              Photograph the contents before you close it.
            </T>
          </Card>
        )}
      </Section>

      {data.loans ? (
        <Section title="Lent out">
          <Card onPress={() => router.push('/loans')}>
            <T variant="bodyStrong">
              {data.loans} {data.loans === 1 ? 'thing is' : 'things are'} with other people
            </T>
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.md },
  suggestion: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  qaRow: { flexDirection: 'row', gap: space.sm, marginTop: space.xxl },
  qa: { flex: 1, alignItems: 'center', gap: space.sm, paddingVertical: space.md, paddingHorizontal: 4, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  qaIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  insight: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  boxNum: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
});
