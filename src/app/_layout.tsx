import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { seedDemo } from '@/demo/seed';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
// Per-weight imports so only the four Inter and three Fraunces files ship in the bundle.
import { Fraunces_400Regular } from '@expo-google-fonts/fraunces/400Regular';
import { Fraunces_500Medium_Italic } from '@expo-google-fonts/fraunces/500Medium_Italic';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { SettingsProvider, useSettings } from '@/state/settings';
import { MemoryProvider, useMemory } from '@/state/memory';
import { SessionProvider, useSession } from '@/state/session';
import { ProProvider } from '@/state/pro';
import { ThemeProvider, useTheme } from '@/ui/theme';
import { BackgroundTasks } from '@/state/background';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Shell() {
  const { c, scheme } = useTheme();
  const { ready, graph } = useMemory();
  const { ready: settingsReady, update } = useSettings();
  const loaded = ready && settingsReady;

  // Dev-only: `?demo=1` in the web preview loads the sample home (used to capture store screenshots).
  const demo = __DEV__ && Platform.OS === 'web' && typeof window !== 'undefined' && window.location.search.includes('demo=1');
  const [seeded, setSeeded] = useState(!demo);
  useEffect(() => {
    if (!demo || !loaded || seeded) return;
    if (!graph.items().length) seedDemo(graph);
    update({ onboarded: true });
    Promise.resolve().then(() => setSeeded(true));
  }, [demo, loaded, seeded, graph, update]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded]);

  if (!loaded || !seeded) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <BackgroundTasks />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="capture/index" options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom' }} />
        <Stack.Screen name="capture/review" options={{ gestureEnabled: false }} />
        <Stack.Screen name="capture/result" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
        <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
        <Stack.Screen name="scan-qr" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="evidence/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      </Stack>
    </>
  );
}

function WithPro({ children }: { children: React.ReactNode }) {
  const { userId } = useSession();
  return <ProProvider userId={userId}>{children}</ProProvider>;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Fraunces_400Regular, Fraunces_500Medium_Italic, Fraunces_600SemiBold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <MemoryProvider>
            <SessionProvider>
              <WithPro>
                <ThemeProvider>
                  <Shell />
                </ThemeProvider>
              </WithPro>
            </SessionProvider>
          </MemoryProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
