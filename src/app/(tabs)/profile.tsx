import React from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Accessibility, BellRing, Box, ChevronRight, Contrast, Crown, Eye, HandHelping, LogIn, LogOut, Luggage, Mic, RotateCcw, Shield, Type, UserRound, Users } from 'lucide-react-native';
import { useDerived, useMemory } from '@/state/memory';
import { usePro } from '@/state/pro';
import { useSettings } from '@/state/settings';
import { useSession } from '@/state/session';
import { signOut } from '@/services/auth';
import { track } from '@/services/analytics';
import { wipeLocal } from '@/data/db';
import { wipeMedia } from '@/data/media';
import { keyOf, type Mutation, type TableName } from '@/core/graph';
import { requestNotificationPermission } from '@/services/notifications';
import { restore } from '@/services/purchases';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Card, Row, Screen, Section, ToggleRow } from '@/ui/components/Layout';
import { T } from '@/ui/components/Text';
import { seedDemo } from '@/demo/seed';

export default function Profile() {
  const { graph } = useMemory();
  const { c } = useTheme();
  const { settings, update } = useSettings();
  const { isPro, customerInfo, require: requireFeature, setCustomerInfo, available } = usePro();
  const { user, signedIn, backend, requireSignIn } = useSession();

  const doSignOut = (removeLocal: boolean) => async () => {
    await signOut();
    track('signed_out', { removed_local: removeLocal });
    if (removeLocal) {
      wipeMedia();
      await wipeLocal();
      const snap = graph.snapshot();
      graph.commit((Object.keys(snap) as TableName[]).flatMap((t) => (snap[t] as never[]).map((row) => ({ op: 'delete', table: t, key: keyOf(t, row) }) as Mutation)));
      update({ onboarded: false, cloudSync: false });
      router.replace('/onboarding');
    }
  };
  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'Your memory can stay on this phone, or be removed from it. Your cloud backup (if on) is kept either way.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out, keep on this phone', onPress: doSignOut(false) },
      { text: 'Sign out and remove from this phone', style: 'destructive', onPress: doSignOut(true) },
    ]);

  const stats = useDerived((g) => ({
    items: g.items().length,
    places: g.entities((e) => e.kind !== 'item').length,
    observations: g.allObservations().length,
    boxes: g.entities((e) => !!e.box).length,
    corrections: g.corrections().length,
  }));
  const expires = Object.values(customerInfo?.entitlements.active ?? {})[0]?.expirationDate;

  return (
    <Screen>
      <T variant="title">You</T>

      {backend ? (
        <Card style={[styles.pro, { marginTop: space.xl }]} onPress={signedIn ? undefined : () => requireSignIn('general')}>
          <View style={[styles.proIcon, { backgroundColor: c.surfaceMuted }]}>
            <UserRound size={20} color={c.inkSoft} />
          </View>
          <View style={{ flex: 1 }}>
            <T variant="subheading">{signedIn ? (user?.name ?? user?.email ?? 'Signed in') : 'Not signed in'}</T>
            <T variant="caption" color="muted">
              {signedIn ? `${user?.email ?? ''}${user?.provider ? ` · via ${user.provider === 'apple' ? 'Apple' : user.provider === 'google' ? 'Google' : user.provider}` : ''}` : 'Sign in to capture, save and back up your memory'}
            </T>
          </View>
          {signedIn ? null : <LogIn size={18} color={c.ember} />}
        </Card>
      ) : null}

      <Card tone={isPro ? 'surface' : 'ember'} onPress={() => router.push('/paywall')} style={[styles.pro, { marginTop: backend ? space.md : space.xl }]}>
        <View style={[styles.proIcon, { backgroundColor: isPro ? c.ink : c.ember }]}>
          <Crown size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <T variant="subheading" style={!isPro ? { color: c.emberInk } : undefined}>
            {isPro ? 'Physical Memory Pro' : 'Upgrade to Pro'}
          </T>
          <T variant="caption" style={{ color: isPro ? c.muted : c.emberInk }}>
            {isPro ? (expires ? `Renews or ends ${new Date(expires).toLocaleDateString()}` : 'Active') : 'Unlimited memory, scans, history, travel & family'}
          </T>
        </View>
        <ChevronRight size={18} color={isPro ? c.faint : c.emberInk} />
      </Card>

      <View style={styles.stats}>
        {[
          ['Objects', stats.items],
          ['Places', stats.places],
          ['Sightings', stats.observations],
          ['Boxes', stats.boxes],
        ].map(([label, n]) => (
          <View key={label as string} style={[styles.stat, { backgroundColor: c.surface, borderColor: c.line }]}>
            <T variant="heading">{String(n)}</T>
            <T variant="caption" color="muted">
              {label as string}
            </T>
          </View>
        ))}
      </View>
      {stats.corrections ? (
        <T variant="caption" color="faint" style={{ marginTop: space.sm }}>
          You’ve corrected the camera {stats.corrections} {stats.corrections === 1 ? 'time' : 'times'} — each one makes your memory more accurate.
        </T>
      ) : null}

      <Section title="Everyday">
        <Card style={{ paddingVertical: space.xs }}>
          <Row icon={Box} title="Storage boxes" onPress={() => router.push('/boxes')} />
          <Row icon={HandHelping} title="Lent to others" onPress={() => router.push('/loans')} />
          <Row icon={Luggage} title="Travel mode" subtitle="Pack, confirm, leave nothing behind" onPress={() => requireFeature('travel_mode') && router.push('/trips')} />
        </Card>
      </Section>

      <Section title="Accessibility">
        <Card style={{ paddingVertical: space.xs }}>
          <ToggleRow icon={Accessibility} title="Simple mode" subtitle="Big buttons, short answers, fewer screens" value={settings.simpleMode} onValueChange={(v) => update({ simpleMode: v })} />
          <ToggleRow icon={Type} title="Large text" value={settings.largeText} onValueChange={(v) => update({ largeText: v })} />
          <ToggleRow icon={Contrast} title="High contrast" value={settings.highContrast} onValueChange={(v) => update({ highContrast: v })} />
          <ToggleRow icon={Mic} title="Voice first" subtitle="Start listening when you open Ask" value={settings.voiceFirst} onValueChange={(v) => update({ voiceFirst: v })} />
        </Card>
        <T variant="caption" color="faint" style={{ marginTop: space.sm }}>
          Physical Memory is an organisational aid. It is not a medical device and does not diagnose or treat any condition.
        </T>
      </Section>

      <Section title="Privacy & data">
        <Card style={{ paddingVertical: space.xs }}>
          {signedIn ? <Row icon={LogOut} title="Sign out" onPress={confirmSignOut} /> : null}
          <Row icon={Shield} title="Privacy center" subtitle="What’s captured, what’s uploaded, private zones, erase" onPress={() => router.push('/privacy')} />
          <ToggleRow
            icon={BellRing}
            title="Helpful reminders"
            subtitle="Loans, trips and boxes — never marketing"
            value={settings.notifications}
            onValueChange={async (v) => {
              if (v && !(await requestNotificationPermission())) {
                Alert.alert('Notifications are off', 'Enable them for Physical Memory in Settings to get reminders.');
                return;
              }
              update({ notifications: v });
            }}
          />
          <ToggleRow icon={Eye} title="Anonymous usage stats" subtitle="Counts only. Never object names, places or photos." value={settings.analytics} onValueChange={(v) => update({ analytics: v })} />
          {available ? (
            <Row
              icon={RotateCcw}
              title="Restore purchases"
              onPress={async () => {
                if (!requireSignIn('purchase')) return;
                const r = await restore();
                if (r.info) setCustomerInfo(r.info);
                Alert.alert(r.restored ? 'Pro restored' : 'Nothing to restore', r.restored ? 'Welcome back.' : (r.message ?? 'No previous Pro purchase found.'));
              }}
            />
          ) : null}
        </Card>
      </Section>

      <Section title="Coming next">
        <Card tone="muted" style={{ gap: space.sm }}>
          <View style={styles.soon}>
            <Users size={16} color={c.inkSoft} />
            <T variant="callout" color="inkSoft" style={{ flex: 1 }}>
              Family spaces — shared homes with per-person privacy. The backend permissions are in place; invites ship next.
            </T>
          </View>
          <T variant="caption" color="muted">
            Also on the way: room recognition, smart-glasses and tracker integrations, and opt-in passive memory. See the Privacy center for how passive capture will work.
          </T>
        </Card>
      </Section>

      {__DEV__ ? (
        <Section title="Developer">
          <Card style={{ paddingVertical: space.xs }}>
            <Row
              title="Load demo scenario"
              subtitle="Adds the Shipaton demo home (no photos). Dev builds only."
              onPress={() => {
                seedDemo(graph);
                Alert.alert('Demo loaded', 'A sample home with a passport, Box 7 and a history was added.');
              }}
            />
            <Row title="Replay onboarding" onPress={() => { update({ onboarded: false }); router.replace('/onboarding'); }} />
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pro: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  proIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  stat: { flex: 1, alignItems: 'center', paddingVertical: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  soon: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
});
