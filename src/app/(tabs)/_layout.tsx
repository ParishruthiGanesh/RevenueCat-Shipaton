import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Camera, House, Map, Search, UserRound } from 'lucide-react-native';
import { useTheme } from '@/ui/theme';
import { radius, shadow, space } from '@/ui/tokens';
import { T } from '@/ui/components/Text';

type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, typeof House> = { index: House, spaces: Map, search: Search, profile: UserRound };
const LABELS: Record<string, string> = { index: 'Home', spaces: 'Spaces', search: 'Ask', profile: 'You' };

/** Floating tab bar with the Capture action as the unmistakable centre of gravity. */
function TabBar({ state, navigation }: TabBarProps) {
  const { c, simple } = useTheme();
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((r) => ICONS[r.name] && (!simple || r.name === 'index' || r.name === 'search'));
  const left = routes.slice(0, Math.ceil(routes.length / 2));
  const right = routes.slice(Math.ceil(routes.length / 2));

  const tab = (route: (typeof routes)[number]) => {
    const focused = state.routes[state.index]?.key === route.key;
    const Icon = ICONS[route.name];
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={LABELS[route.name]}
        onPress={() => {
          Haptics.selectionAsync().catch(() => undefined);
          const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
        }}
        style={styles.tab}
      >
        <Icon size={22} color={focused ? c.ink : c.faint} strokeWidth={focused ? 2.3 : 1.9} />
        <T variant="caption" style={{ color: focused ? c.ink : c.faint, fontFamily: focused ? 'Inter_600SemiBold' : 'Inter_500Medium', fontSize: 11 }}>
          {LABELS[route.name]}
        </T>
      </Pressable>
    );
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
      <View style={[styles.bar, { backgroundColor: c.bgElevated, borderColor: c.line }, shadow.lifted]}>
        {left.map(tab)}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remember this — open camera"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
            router.push('/capture');
          }}
          style={({ pressed }) => [styles.capture, { backgroundColor: c.ember, transform: [{ scale: pressed ? 0.94 : 1 }] }, shadow.ember]}
        >
          <Camera size={26} color="#fff" strokeWidth={2.2} />
        </Pressable>
        {right.map(tab)}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(p) => <TabBar {...p} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="spaces" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', height: 72, borderRadius: radius.xxl, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.sm },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, height: '100%' },
  capture: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', marginTop: -26 },
});
