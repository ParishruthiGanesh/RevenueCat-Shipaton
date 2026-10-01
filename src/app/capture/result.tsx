import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { ArrowRight, Check, CirclePlus, EyeOff, MoveRight, Printer, Search } from 'lucide-react-native';
import { breadcrumb, softLower } from '@/core/phrasing';
import { captureSession, useCaptureSession } from '@/state/capture-session';
import { useMemory } from '@/state/memory';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Breadcrumb } from '@/ui/components/Breadcrumb';
import { Button } from '@/ui/components/Button';
import { Card, Screen } from '@/ui/components/Layout';
import { T } from '@/ui/components/Text';
import { BoxLabel, printBoxLabel } from '@/ui/components/BoxLabel';

export default function Result() {
  const { result, draft } = useCaptureSession();
  const { graph } = useMemory();
  const { c } = useTheme();

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, []);

  // Navigating during render isn't allowed; redirect declaratively (e.g. after a reload).
  if (!result || !draft) return <Redirect href="/" />;

  const done = () => {
    captureSession.clear();
    router.replace('/');
  };
  const target = graph.entity(result.targetId);
  const primary = result.savedItems[0]?.entity;
  const d = result.diff;
  const isBox = !!target?.box;

  return (
    <Screen bottomInset={40}>
      <Animated.View entering={ZoomIn.springify()} style={[styles.badge, { backgroundColor: c.ember }]}>
        <Check size={34} color="#fff" strokeWidth={3} />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120)}>
        <T variant="title" align="center" style={{ marginTop: space.xl }}>
          {isBox && draft.mode === 'box' ? `${target!.name} is ready` : draft.mode === 'scan' ? `${target?.name ?? 'Area'} scanned` : 'Remembered'}
        </T>
        <T variant="callout" color="muted" align="center" style={{ marginTop: space.xs }}>
          {result.savedItems.length} {result.savedItems.length === 1 ? 'object' : 'objects'} saved with photo evidence and time.
        </T>
      </Animated.View>

      {target ? (
        <Animated.View entering={FadeInDown.delay(200)}>
          <Card style={{ marginTop: space.xxl }}>
            <T variant="overline" color="muted" style={{ marginBottom: space.sm }}>
              Location
            </T>
            <Breadcrumb path={breadcrumb(graph, graph.chainFrom(target.id))} vertical />
          </Card>
        </Animated.View>
      ) : null}

      {isBox ? (
        <Animated.View entering={FadeInDown.delay(260)} style={{ marginTop: space.lg, gap: space.md }}>
          <BoxLabel graph={graph} box={target!} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Print / share label" icon={Printer} variant="secondary" onPress={() => printBoxLabel(graph, target!)} style={{ flex: 1 }} />
          </View>
        </Animated.View>
      ) : null}

      {draft.mode !== 'remember' && (d.added.length || d.notDetected.length || d.movedIn.length || d.stillHere.length) ? (
        <Animated.View entering={FadeInDown.delay(300)}>
          <T variant="overline" color="muted" style={{ marginTop: space.xxl, marginBottom: space.md }}>
            What changed
          </T>
          <Card style={{ gap: space.lg }}>
            <DiffGroup icon={CirclePlus} tint={c.success} title="Added" names={d.added.map((e) => e.name)} />
            <DiffGroup icon={MoveRight} tint={c.focus} title="Moved here" names={d.movedIn.map((m) => `${m.entity.name}  (from ${graph.entity(m.fromChain[0])?.name ?? 'elsewhere'})`)} />
            <DiffGroup icon={Check} tint={c.muted} title="Still here" names={d.stillHere.map((e) => e.name)} />
            <DiffGroup icon={EyeOff} tint={c.ember} title="Not detected this time" names={d.notDetected.map((e) => e.name)} />
          </Card>
          {d.notDetected.length ? (
            <T variant="caption" color="muted" style={{ marginTop: space.sm }}>
              Not being seen isn’t proof something is gone — it may have been out of view. Their last confirmed sightings stay on record.
            </T>
          ) : null}
        </Animated.View>
      ) : (
        <Animated.View entering={FadeInDown.delay(300)} style={{ gap: space.sm, marginTop: space.lg }}>
          {result.savedItems.map((s) => (
            <Card key={s.entity.id} onPress={() => router.push(`/item/${s.entity.id}`)} style={styles.savedRow}>
              <T variant="bodyStrong" style={{ flex: 1 }}>
                {s.entity.name}
              </T>
              <T variant="caption" color="muted">
                {s.isNew ? 'New' : 'Updated'}
              </T>
              <ArrowRight size={16} color={c.faint} />
            </Card>
          ))}
        </Animated.View>
      )}

      <View style={{ gap: space.sm, marginTop: space.xxl }}>
        {primary && !isBox ? (
          <Button
            label={`Try it: “Where is my ${softLower(primary.name)}?”`}
            icon={Search}
            variant="secondary"
            onPress={() => {
              captureSession.clear();
              router.replace({ pathname: '/(tabs)/search', params: { q: `Where is my ${softLower(primary.name)}?` } });
            }}
          />
        ) : null}
        <Button label="Done" size="lg" onPress={done} />
        <Button label="Remember another" variant="ghost" onPress={() => { captureSession.clear(); router.replace({ pathname: '/capture', params: { mode: draft.mode } }); }} />
      </View>
    </Screen>
  );
}

function DiffGroup({ icon: Icon, tint, title, names }: { icon: typeof Check; tint: string; title: string; names: string[] }) {
  if (!names.length) return null;
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Icon size={16} color={tint} />
        <T variant="label" style={{ color: tint }}>
          {title}
        </T>
      </View>
      {names.map((n) => (
        <T key={n} variant="body" style={{ marginLeft: 24 }}>
          {n}
        </T>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: space.xxl },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg },
});
