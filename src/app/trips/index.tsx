import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Check, Luggage, Plus } from 'lucide-react-native';
import { createTrip } from '@/core/operations';
import { searchItems } from '@/core/search';
import { tripStatus } from '@/core/insights';
import { useDerived, useMemory } from '@/state/memory';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Button } from '@/ui/components/Button';
import { Card, Chip, Header, Screen, Section } from '@/ui/components/Layout';
import { T } from '@/ui/components/Text';

const ESSENTIALS = ['passport', 'wallet', 'charger', 'laptop', 'headphones', 'medication', 'keys', 'camera', 'glasses'];

export default function Trips() {
  const { graph } = useMemory();
  const { c } = useTheme();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [days, setDays] = useState(1);
  const [bagId, setBagId] = useState<string | undefined>();
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const trips = useDerived((g) => g.trips().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((t) => ({ t, status: tripStatus(g, t) })));
  const bags = useDerived((g) => g.items().filter((e) => e.isContainer && /bag|backpack|suitcase|luggage|carry|duffel|tote/i.test(`${e.name} ${e.category ?? ''}`)));
  const suggestions = useDerived((g) => {
    const out = new Map<string, string>();
    for (const term of ESSENTIALS) for (const h of searchItems(g, term, { limit: 2 })) if (h.score > 0.5) out.set(h.entity.id, h.entity.name);
    for (const e of g.items().slice(0, 40)) if (!out.has(e.id) && out.size < 24) out.set(e.id, e.name);
    return [...out.entries()];
  });

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const create = () => {
    const t = createTrip(graph, name.trim() || 'Trip', [...picked], bagId ? [bagId] : [], new Date(Date.now() + days * 86400e3).toISOString());
    setCreating(false);
    router.push(`/trips/${t.id}`);
  };

  return (
    <Screen bottomInset={60}>
      <Header title="Travel mode" subtitle="Know what’s packed — because the camera saw it in the bag, not because you ticked a box." />
      {!creating ? <Button label="Plan a trip" icon={Plus} variant="ember" onPress={() => setCreating(true)} /> : null}

      {creating ? (
        <Card style={{ gap: space.lg }}>
          <TextInput value={name} onChangeText={setName} placeholder="Trip name, e.g. Tokyo" placeholderTextColor={c.faint} style={[styles.input, { color: c.ink, borderColor: c.line }]} accessibilityLabel="Trip name" />
          <View>
            <T variant="label" color="muted">
              Leaving
            </T>
            <View style={styles.wrap}>
              {[
                ['Today', 0],
                ['Tomorrow', 1],
                ['In 3 days', 3],
                ['Next week', 7],
              ].map(([l, d]) => (
                <Chip key={l as string} label={l as string} selected={days === d} onPress={() => setDays(d as number)} />
              ))}
            </View>
          </View>
          <View>
            <T variant="label" color="muted">
              Bag
            </T>
            <View style={styles.wrap}>
              {bags.length ? bags.map((b) => <Chip key={b.id} label={b.name} icon={Luggage} selected={bagId === b.id} onPress={() => setBagId(b.id)} />) : <T variant="caption" color="muted">Remember your suitcase or backpack first (it becomes a container).</T>}
            </View>
          </View>
          <View>
            <T variant="label" color="muted">
              Bring
            </T>
            <View style={{ marginTop: space.sm, gap: 2 }}>
              {suggestions.map(([id, n]) => (
                <Pressable key={id} onPress={() => toggle(id)} style={styles.pick} accessibilityRole="checkbox" accessibilityState={{ checked: picked.has(id) }}>
                  <View style={[styles.box, { borderColor: picked.has(id) ? c.ink : c.lineStrong, backgroundColor: picked.has(id) ? c.ink : 'transparent' }]}>{picked.has(id) ? <Check size={12} color={c.inverse} /> : null}</View>
                  <T variant="body">{n}</T>
                </Pressable>
              ))}
            </View>
          </View>
          <Button label={`Create trip · ${picked.size} items`} onPress={create} disabled={!picked.size} />
        </Card>
      ) : null}

      {trips.length ? (
        <Section title="Trips">
          <View style={{ gap: space.md }}>
            {trips.map(({ t, status }) => {
              const packed = status.filter((s) => s.state === 'packed' || s.state === 'arrived').length;
              return (
                <Card key={t.id} onPress={() => router.push(`/trips/${t.id}`)} style={{ gap: space.xs }}>
                  <T variant="subheading">{t.name}</T>
                  <T variant="caption" color="muted">
                    {packed}/{status.length} confirmed packed{t.closedAt ? ' · completed' : ''}
                  </T>
                  <View style={[styles.bar, { backgroundColor: c.surfaceSunken }]}>
                    <View style={[styles.fill, { width: `${status.length ? (packed / status.length) * 100 : 0}%`, backgroundColor: c.success }]} />
                  </View>
                </Card>
              );
            })}
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { height: 50, borderBottomWidth: 1, fontSize: 20, fontFamily: 'Fraunces_600SemiBold' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  pick: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 6, borderRadius: radius.pill, overflow: 'hidden', marginTop: space.sm },
  fill: { height: 6, borderRadius: radius.pill },
});
