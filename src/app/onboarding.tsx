import React, { useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ArrowRight, Camera, Lock } from 'lucide-react-native';
import { createEntity } from '@/core/operations';
import type { SpaceType } from '@/core/types';
import { useMemory } from '@/state/memory';
import { useSettings } from '@/state/settings';
import { track } from '@/services/analytics';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Button } from '@/ui/components/Button';
import { DrawerIllustration } from '@/ui/components/EmptyState';
import { Chip } from '@/ui/components/Layout';
import { T } from '@/ui/components/Text';

function PointRememberFind() {
  const { c } = useTheme();
  return (
    <Svg width={220} height={120} viewBox="0 0 220 120">
      <Rect x="8" y="30" width="56" height="60" rx="12" fill={c.surface} stroke={c.lineStrong} strokeWidth="1.5" />
      <Circle cx="36" cy="60" r="12" fill={c.ember} />
      <Path d="M72 60 h28" stroke={c.lineStrong} strokeWidth="2" strokeDasharray="4 5" />
      <Rect x="108" y="36" width="48" height="48" rx="24" fill={c.emberSoft} />
      <Path d="M122 60 l8 8 l14 -16" stroke={c.ember} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M162 60 h20" stroke={c.lineStrong} strokeWidth="2" strokeDasharray="4 5" />
      <Circle cx="198" cy="56" r="12" fill="none" stroke={c.ink} strokeWidth="3" />
      <Path d="M207 65 l8 8" stroke={c.ink} strokeWidth="3" strokeLinecap="round" />
    </Svg>
  );
}

function LastSeenCard() {
  const { c, confidence } = useTheme();
  return (
    <View style={[styles.mock, { backgroundColor: c.surface, borderColor: c.line }]}>
      <T variant="overline" color="muted">
        Passport
      </T>
      <T variant="subheading">Last seen in the top drawer of the black dresser</T>
      <T variant="caption" color="muted">
        Today at 8:14 PM
      </T>
      <View style={[styles.pill, { backgroundColor: confidence.high.bg }]}>
        <View style={[styles.dot, { backgroundColor: confidence.high.dot }]} />
        <T variant="caption" style={{ color: confidence.high.fg, fontFamily: 'Inter_600SemiBold' }}>
          High confidence
        </T>
      </View>
    </View>
  );
}

const SLIDES = [
  { title: 'Never ask “where did I put that?” again.', body: 'A searchable memory of the physical things in your life.', art: () => <DrawerIllustration size={170} /> },
  { title: 'Point. Remember. Find.', body: 'Show the camera where something is going, say it out loud, and ask for it later in plain words.', art: () => <PointRememberFind /> },
  { title: 'Honest, not magical.', body: 'Physical Memory tells you where things were last seen, when, and how sure it is — with the photo as proof.', art: () => <LastSeenCard /> },
  { title: 'Your home stays yours.', body: 'Nothing is captured unless you press the shutter. Mark rooms and objects private. Delete anything, anytime.', art: () => <PrivacyArt /> },
];

function PrivacyArt() {
  const { c } = useTheme();
  return (
    <View style={[styles.lock, { backgroundColor: c.emberSoft }]}>
      <Lock size={56} color={c.ember} strokeWidth={1.6} />
    </View>
  );
}

const SPACES: { type: SpaceType; label: string; name: string }[] = [
  { type: 'home', label: 'Home', name: 'Home' },
  { type: 'dorm', label: 'Dorm', name: 'Dorm' },
  { type: 'office', label: 'Office', name: 'Office' },
  { type: 'family_home', label: 'Family home', name: 'Family home' },
  { type: 'storage_unit', label: 'Storage unit', name: 'Storage unit' },
];

export default function Onboarding() {
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { graph } = useMemory();
  const { update } = useSettings();
  const scroller = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const [spaceType, setSpaceType] = useState<SpaceType>('home');
  const [spaceName, setSpaceName] = useState('Home');
  const total = SLIDES.length + 1;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  const next = () => {
    // Programmatic scrolls don't emit momentum events, so track the page explicitly.
    const p = Math.min(page + 1, total - 1);
    scroller.current?.scrollTo({ x: p * width, animated: true });
    setPage(p);
  };

  const finish = (thenCapture: boolean) => {
    const existing = graph.spaces()[0];
    const s = existing ?? createEntity(graph, { kind: 'space', name: spaceName.trim() || 'Home', spaceType });
    update({ onboarded: true, defaultSpaceId: s.id });
    track('onboarding_completed', { space: spaceType });
    router.replace('/(tabs)');
    if (thenCapture) setTimeout(() => router.push('/capture'), 250);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }}>
      <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} keyboardShouldPersistTaps="handled">
        {SLIDES.map((s, i) => (
          <View key={s.title} style={[styles.page, { width }]}>
            <View style={styles.art}>{page === i || i === 0 ? <Animated.View entering={FadeIn.duration(500)}>{s.art()}</Animated.View> : s.art()}</View>
            <Animated.View entering={FadeInDown.delay(120)}>
              <T variant="hero">{s.title}</T>
              <T variant="body" color="muted" style={{ marginTop: space.md }}>
                {s.body}
              </T>
            </Animated.View>
          </View>
        ))}
        <View style={[styles.page, { width }]}>
          <T variant="overline" color="ember">
            First space
          </T>
          <T variant="title" style={{ marginTop: space.sm }}>
            Where will you start?
          </T>
          <T variant="callout" color="muted" style={{ marginTop: space.sm }}>
            You don’t need to set up rooms. They appear as you remember things.
          </T>
          <View style={styles.chips}>
            {SPACES.map((s) => (
              <Chip
                key={s.type}
                label={s.label}
                selected={spaceType === s.type}
                onPress={() => {
                  setSpaceType(s.type);
                  setSpaceName(s.name);
                }}
              />
            ))}
          </View>
          <TextInput value={spaceName} onChangeText={setSpaceName} style={[styles.input, { borderColor: c.line, backgroundColor: c.surface, color: c.ink }]} accessibilityLabel="Space name" />
          <View style={{ flex: 1 }} />
          <Button label="Remember my first object" icon={Camera} variant="ember" size="lg" full onPress={() => finish(true)} />
          <Button label="Look around first" variant="ghost" onPress={() => finish(false)} style={{ marginTop: space.sm }} />
        </View>
      </ScrollView>

      {page < SLIDES.length ? (
        <View style={styles.footer}>
          <View style={styles.dots}>
            {Array.from({ length: total }).map((_, i) => (
              <View key={i} style={[styles.pageDot, { backgroundColor: i === page ? c.ink : c.lineStrong, width: i === page ? 22 : 7 }]} />
            ))}
          </View>
          <Button label={page === SLIDES.length - 1 ? 'Get started' : 'Next'} icon={ArrowRight} onPress={next} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xxl, paddingTop: space.xxl, flex: 1 },
  art: { height: 260, alignItems: 'center', justifyContent: 'center', marginBottom: space.xxl },
  mock: { width: 280, padding: space.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginTop: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  lock: { width: 140, height: 140, borderRadius: 70, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xl },
  input: { height: 52, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, fontSize: 17, fontFamily: 'Inter_500Medium', marginTop: space.lg },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xxl },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  pageDot: { height: 7, borderRadius: 4 },
});
