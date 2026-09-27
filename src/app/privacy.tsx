import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Cloud, CloudDownload, EyeOff, Lock, ScanEye, ShieldCheck, Trash2, UserRoundX, Wifi } from 'lucide-react-native';
import { updateEntity } from '@/core/operations';
import { keyOf, type MemoryGraph, type Mutation, type TableName } from '@/core/graph';
import { wipeLocal } from '@/data/db';
import { wipeMedia } from '@/data/media';
import { pullAll } from '@/data/sync';
import { invoke } from '@/services/supabase';
import { useDerived, useMemory } from '@/state/memory';
import { usePro } from '@/state/pro';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';
import { Card, Header, Row, Screen, Section, ToggleRow } from '@/ui/components/Layout';
import { T } from '@/ui/components/Text';

function allDeletes(graph: MemoryGraph): Mutation[] {
  const snap = graph.snapshot();
  return (Object.keys(snap) as TableName[]).flatMap((t) => (snap[t] as never[]).map((row) => ({ op: 'delete', table: t, key: keyOf(t, row) }) as Mutation));
}

/** Privacy as a product feature: plain language, real controls, real deletion. */
export default function Privacy() {
  const { graph } = useMemory();
  const { c } = useTheme();
  const { settings, update } = useSettings();
  const { require: requireFeature } = usePro();
  const { backend, userId, online } = useSession();
  const [working, setWorking] = useState(false);

  const zones = useDerived((g) => g.entities((e) => e.kind !== 'item' && e.kind !== 'space'));
  const sensitive = useDerived((g) => g.items().filter((e) => e.sensitive));

  const eraseEverything = () =>
    Alert.alert('Erase everything?', 'Every object, place, sighting and photo will be permanently deleted from this phone' + (backend && userId ? ' and from your cloud account' : '') + '. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Continue',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Are you absolutely sure?', 'There is no way to recover your memory after this.', [
            { text: 'Keep my data', style: 'cancel' },
            {
              text: 'Erase permanently',
              style: 'destructive',
              onPress: async () => {
                setWorking(true);
                try {
                  if (backend && userId && online) await invoke('delete-account', {});
                } catch {
                  Alert.alert('Cloud data not erased', 'We couldn’t reach the cloud. Local data will still be erased; try again online to erase your cloud copy.');
                }
                wipeMedia();
                await wipeLocal();
                graph.commit(allDeletes(graph));
                setWorking(false);
                update({ onboarded: false, cloudSync: false });
                router.replace('/onboarding');
              },
            },
          ]),
      },
    ]);

  const deletePhotos = () =>
    Alert.alert('Delete all photos?', 'Objects and their locations stay; the photo evidence is removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete photos',
        style: 'destructive',
        onPress: () => {
          wipeMedia();
          graph.commit([
            ...graph.allMedia().map((m) => ({ op: 'delete' as const, table: 'media' as const, key: m.id })),
            ...graph.entities((e) => !!e.coverMediaId).map((e) => ({ op: 'upsert' as const, table: 'entities' as const, row: { ...e, coverMediaId: undefined } })),
          ]);
        },
      },
    ]);

  return (
    <Screen bottomInset={60}>
      <Header title="Privacy center" subtitle="Physical Memory knows a lot about your home. Here is exactly what happens with it." />

      <Card style={{ gap: space.md }}>
        {[
          [ShieldCheck, 'Photos are only taken when you press the shutter. Nothing is recorded in the background.'],
          [Lock, 'Your memory lives on this phone first. Cloud backup is optional and private to your account.'],
          [Wifi, 'With cloud analysis on, the photos you take are sent over an encrypted connection to identify objects, then discarded — our server never stores them. See the privacy policy for our AI provider’s data terms.'],
          [UserRoundX, 'If a person appears in a photo, only object close-ups are kept.'],
        ].map(([Icon, text]) => {
          const I = Icon as typeof Lock;
          return (
            <View key={text as string} style={styles.fact}>
              <I size={18} color={c.success} />
              <T variant="callout" color="inkSoft" style={{ flex: 1 }}>
                {text as string}
              </T>
            </View>
          );
        })}
      </Card>

      <Section title="Processing">
        <Card style={{ paddingVertical: space.xs }}>
          <ToggleRow icon={Cloud} title="Cloud analysis" subtitle="Identify objects with AI. Off: you label things yourself; nothing leaves the phone." value={settings.cloudAI} onValueChange={(v) => update({ cloudAI: v })} />
          <ToggleRow icon={UserRoundX} title="Minimise people" subtitle="Discard full photos when someone is visible" value={settings.minimizePeople} onValueChange={(v) => update({ minimizePeople: v })} />
          <ToggleRow icon={EyeOff} title="Never read text" subtitle="The AI won’t transcribe documents, labels or cards" value={settings.sensitiveMode} onValueChange={(v) => update({ sensitiveMode: v })} />
          <ToggleRow icon={CloudDownload} title="Encrypted backup & sync" subtitle={backend ? 'Pro · private to your account' : 'Not configured in this build'} value={settings.cloudSync} disabled={!backend} onValueChange={(v) => (!v || requireFeature('cloud_sync')) && update({ cloudSync: v })} />
          {settings.cloudSync && backend ? (
            <Row
              icon={CloudDownload}
              title="Restore from cloud"
              subtitle="Download your backup onto this phone"
              onPress={async () => {
                try {
                  const n = await pullAll(graph);
                  Alert.alert('Restored', `${n} records downloaded.`);
                } catch (e) {
                  Alert.alert('Restore failed', (e as Error).message);
                }
              }}
            />
          ) : null}
        </Card>
      </Section>

      <Section title="Passive memory (future)">
        <Card tone="muted" style={{ gap: space.sm }}>
          <View style={styles.fact}>
            <ScanEye size={18} color={c.inkSoft} />
            <T variant="callout" color="inkSoft" style={{ flex: 1 }}>
              Later, with your explicit permission for each session, a phone, wearable or smart-glasses camera could note where things are in the background. It will never run without consent, never inside private zones, and never keep images of people.
            </T>
          </View>
          <T variant="caption" color="muted">
            Not available yet. Everything today is captured deliberately.
          </T>
        </Card>
      </Section>

      <Section title="Private zones">
        <T variant="caption" color="muted" style={{ marginBottom: space.sm }}>
          No passive recognition here, and contents stay hidden from shared family members.
        </T>
        <Card style={{ paddingVertical: space.xs }}>
          {zones.length === 0 ? (
            <T variant="callout" color="muted" style={{ paddingVertical: space.md }}>
              Rooms and furniture appear here as you add them.
            </T>
          ) : (
            zones.slice(0, 30).map((z) => <ToggleRow key={z.id} title={z.name} subtitle={graph.pathLabel(graph.chainFrom(graph.structuralPlacement(z.id)?.parentId))} value={z.privateZone} onValueChange={(v) => updateEntity(graph, z.id, { privateZone: v })} />)
          )}
        </Card>
      </Section>

      <Section title="Sensitive objects">
        <T variant="caption" color="muted" style={{ marginBottom: space.sm }}>
          Passports, IDs, medication… Photos are blurred until tapped, text is never stored, and they’re excluded from shared views.
        </T>
        <Card style={{ paddingVertical: space.xs }}>
          {sensitive.length === 0 ? (
            <T variant="callout" color="muted" style={{ paddingVertical: space.md }}>
              None yet. The camera marks things like passports automatically, and you can mark anything with the lock icon.
            </T>
          ) : (
            sensitive.map((e) => <Row key={e.id} icon={Lock} title={e.name} onPress={() => router.push(`/item/${e.id}`)} />)
          )}
        </Card>
      </Section>

      <Section title="Delete">
        <Card style={{ paddingVertical: space.xs }}>
          <Row icon={Trash2} title="Delete all photos" subtitle="Keep locations, remove photo evidence" onPress={deletePhotos} danger />
          <Row icon={Trash2} title={working ? 'Erasing…' : 'Erase everything'} subtitle="Permanently delete all your data, everywhere" onPress={working ? undefined : eraseEverything} danger />
        </Card>
        <T variant="caption" color="faint" style={{ marginTop: space.sm }}>
          To delete a single sighting or object, open it and use its menu.
        </T>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fact: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
});
