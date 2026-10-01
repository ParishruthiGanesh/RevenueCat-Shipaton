import React, { useState } from 'react';
import { ActivityIndicator, Alert, Share, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Crown, Eye, Lock, LogOut, RefreshCw, Share2, ShieldCheck, UserMinus, UserRound, Users } from 'lucide-react-native';
import { shareReport, sharedFootprint } from '@/core/family';
import { keyOf } from '@/core/graph';
import { pushOutbox } from '@/data/sync';
import { createFamily, joinFamily, leaveFamily, pullFamily, removeMember, rotateInvite, setMemberRole, setSpaceShared, type FamilyMember } from '@/services/family';
import { useFamily } from '@/state/family';
import { useDerived, useMemory } from '@/state/memory';
import { usePro } from '@/state/pro';
import { useSession } from '@/state/session';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Button } from '@/ui/components/Button';
import { Card, Header, Row, Screen, Section, ToggleRow } from '@/ui/components/Layout';
import { Prompt, type PromptSpec } from '@/ui/components/Prompt';
import { T } from '@/ui/components/Text';

const ROLE_LABEL = { owner: 'Owner', member: 'Member', viewer: 'Viewer' } as const;

/** Family spaces: shared physical memory with per-person privacy. */
export default function FamilyScreen() {
  const { graph } = useMemory();
  const { c } = useTheme();
  const { family, loading, refresh } = useFamily();
  const { requireSignIn, user } = useSession();
  const { require: requireFeature } = usePro();
  const [prompt, setPrompt] = useState<PromptSpec | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const mySpaces = useDerived((g) => g.spaces().filter((s) => !s.createdBy).map((s) => ({ s, foot: sharedFootprint(g, s.id) })));
  const familyItems = useDerived((g) => g.items().filter((e) => !!e.createdBy).length);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
      await refresh();
    } catch (e) {
      Alert.alert('Something went wrong', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const defaultName = user?.name?.split(' ')[0] ?? user?.email?.split('@')[0] ?? '';

  const create = () => {
    if (!requireSignIn('save', { pathname: '/family' }) || !requireFeature('family_sharing')) return;
    setPrompt({
      title: 'Name your family',
      message: 'e.g. “Ganesh Family”. You can invite people next.',
      placeholder: 'Family name',
      confirm: 'Next',
      onSubmit: (name) =>
        setTimeout(
          () =>
            setPrompt({
              title: 'What should the family call you?',
              placeholder: 'e.g. Pari, Mom, Dad',
              initial: defaultName,
              confirm: 'Create family',
              onSubmit: (me) => run('create', () => createFamily(name, me)),
            }),
          250,
        ),
    });
  };

  const join = () => {
    if (!requireSignIn('save', { pathname: '/family' })) return;
    setPrompt({
      title: 'Join a family',
      message: 'Enter the 6-character code you were sent.',
      placeholder: 'e.g. K7P2QX',
      confirm: 'Next',
      onSubmit: (code) =>
        setTimeout(
          () =>
            setPrompt({
              title: 'What should the family call you?',
              placeholder: 'e.g. Revanth, Dad',
              initial: defaultName,
              confirm: 'Join',
              onSubmit: (me) => run('join', () => joinFamily(code, me)),
            }),
          250,
        ),
    });
  };

  const shareCode = (code: string) =>
    Share.share({ message: `Join our family on Physical Memory so we can always find our things. Open the app → You → Family → Join, and enter code ${code}` });

  const memberActions = (m: FamilyMember) => {
    if (!family || family.myRole !== 'owner' || m.isMe) return;
    Alert.alert(m.name, `Currently: ${ROLE_LABEL[m.role]}`, [
      { text: 'Make Member (can add & edit)', onPress: () => run('role', () => setMemberRole(family.id, m.userId, 'member')) },
      { text: 'Make Viewer (look & ask only)', onPress: () => run('role', () => setMemberRole(family.id, m.userId, 'viewer')) },
      { text: 'Remove from family', style: 'destructive', onPress: () => run('remove', () => removeMember(family.id, m.userId)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const syncNow = () =>
    family &&
    run('sync', async () => {
      // Re-send everything in shared spaces (covers items saved before sharing was turned on).
      const direct = mySpaces
        .filter(({ s }) => s.householdId === family.id)
        .flatMap(({ s }) => setSpaceShared(graph, s.id, family.id))
        .flatMap((m) => (m.op === 'upsert' ? [{ table: m.table, key: keyOf(m.table, m.row as never), row: m.row }] : []));
      const pushed = await pushOutbox(graph, direct);
      if (pushed.error) throw new Error(`Couldn’t upload your changes: ${pushed.error}`);
      const pulled = await pullFamily(graph, family.id);
      const rep = shareReport(graph, family.id);
      const lines = [`Your items shared with the family: ${rep.shared}`];
      if (rep.details.length) {
        lines.push(`Not shared: ${rep.details.length}`);
        for (const d of rep.details.slice(0, 6)) lines.push(`• ${d.name}: ${d.reason}`);
        if (rep.details.length > 6) lines.push('…');
      }
      lines.push('', `Uploaded ${pushed.pushed} records · received ${pulled} from your family.`);
      console.log('[family] share report', JSON.stringify(rep));
      Alert.alert('Family synced', lines.join(String.fromCharCode(10)));
    });

  const leave = () =>
    family &&
    Alert.alert(
      family.myRole === 'owner' ? 'Delete this family?' : 'Leave this family?',
      family.myRole === 'owner' ? 'Everyone loses access to the shared spaces. Your own items stay on your phone.' : 'You’ll stop seeing the family’s shared items. Your own items stay yours.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: family.myRole === 'owner' ? 'Delete family' : 'Leave',
          style: 'destructive',
          onPress: () =>
            run('leave', async () => {
              for (const { s } of mySpaces) if (s.householdId) setSpaceShared(graph, s.id, null);
              graph.commit(graph.entities((e) => !!e.createdBy).map((e) => ({ op: 'delete' as const, table: 'entities' as const, key: e.id })));
              await leaveFamily(family.id);
            }),
        },
      ],
    );

  if (loading && !family) {
    return (
      <Screen>
        <Header title="Family" />
        <ActivityIndicator color={c.muted} />
      </Screen>
    );
  }

  if (!family) {
    return (
      <Screen bottomInset={60}>
        <Header title="Family" subtitle="One shared memory for the whole household — with private things kept private." />
        <Animated.View entering={FadeInDown} style={[styles.hero, { backgroundColor: c.emberSoft }]}>
          <Users size={34} color={c.emberInk} />
          <T variant="heading" style={{ color: c.emberInk }}>
            “Where did Dad put the drill?”
          </T>
          <T variant="callout" style={{ color: c.emberInk }}>
            Everyone remembers into the same home, and anyone can ask. Answers show who put it there.
          </T>
        </Animated.View>
        <Card style={{ gap: space.md, marginTop: space.lg }}>
          {[
            [Users, 'Invite family with a 6-character code — joining is free'],
            [Crown, 'Roles: Owner, Member (adds & edits), Viewer (looks & asks — great for kids or grandparents)'],
            [Lock, 'Sensitive items (passports, meds, IDs) and private zones are never shared'],
            [UserRound, 'See who recorded each sighting: “added by Mom, yesterday”'],
          ].map(([Icon, text]) => {
            const I = Icon as typeof Users;
            return (
              <View key={text as string} style={styles.point}>
                <I size={18} color={c.ember} />
                <T variant="callout" color="inkSoft" style={{ flex: 1 }}>
                  {text as string}
                </T>
              </View>
            );
          })}
        </Card>
        <View style={{ gap: space.sm, marginTop: space.xl }}>
          <Button label="Create a family" icon={Crown} variant="ember" size="lg" loading={busy === 'create'} onPress={create} />
          <Button label="Join with a code" icon={Users} variant="secondary" size="lg" loading={busy === 'join'} onPress={join} />
        </View>
        <T variant="caption" color="faint" align="center" style={{ marginTop: space.md }}>
          Creating a family is part of Pro. Joining one is free — the owner’s Pro covers everyone.
        </T>
        <Prompt spec={prompt} onClose={() => setPrompt(null)} />
      </Screen>
    );
  }

  const canShare = family.myRole !== 'viewer';

  return (
    <Screen bottomInset={60}>
      <Header title={family.name} subtitle={`${family.members.length} ${family.members.length === 1 ? 'person' : 'people'} · you’re ${ROLE_LABEL[family.myRole].toLowerCase()}`} />

      {family.inviteCode ? (
        <Animated.View entering={FadeInDown}>
          <Card style={{ gap: space.md }}>
            <T variant="overline" color="muted">
              Invite code
            </T>
            <T variant="hero" style={{ letterSpacing: 8 }} accessibilityLabel={`Invite code ${family.inviteCode.split('').join(' ')}`}>
              {family.inviteCode}
            </T>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="Share invite" icon={Share2} onPress={() => shareCode(family.inviteCode!)} style={{ flex: 1 }} />
              <Button label="New code" icon={RefreshCw} variant="secondary" loading={busy === 'rotate'} onPress={() => run('rotate', () => rotateInvite(family.id))} style={{ flex: 1 }} />
            </View>
            <T variant="caption" color="muted">
              Family members open Physical Memory → You → Family → Join with a code. Joining is free.
            </T>
          </Card>
        </Animated.View>
      ) : null}

      <Section title="People">
        <Card style={{ paddingVertical: space.xs }}>
          {family.members.map((m) => (
            <Row
              key={m.userId}
              icon={m.role === 'owner' ? Crown : m.role === 'viewer' ? Eye : UserRound}
              title={m.isMe ? `${m.name} (you)` : m.name}
              subtitle={ROLE_LABEL[m.role]}
              onPress={family.myRole === 'owner' && !m.isMe ? () => memberActions(m) : undefined}
            />
          ))}
        </Card>
      </Section>

      <Section title="Shared spaces">
        <T variant="caption" color="muted" style={{ marginBottom: space.sm }}>
          Everything in a shared space is visible to the family — except sensitive items and private zones.
        </T>
        <Card style={{ paddingVertical: space.xs }}>
          {mySpaces.length === 0 ? (
            <T variant="callout" color="muted" style={{ paddingVertical: space.md }}>
              You don’t have any spaces yet.
            </T>
          ) : (
            mySpaces.map(({ s, foot }) => (
              <ToggleRow
                key={s.id}
                title={s.name}
                subtitle={`${foot.entities.length} ${foot.entities.length === 1 ? 'thing' : 'things'} would be shared${foot.hidden ? ` · ${foot.hidden} private kept hidden` : ''}`}
                value={s.householdId === family.id}
                disabled={!canShare}
                onValueChange={(v) => {
                  const muts = setSpaceShared(graph, s.id, v ? family.id : null);
                  run('sync', async () => {
                    const r = await pushOutbox(
                      graph,
                      muts.flatMap((m) => (m.op === 'upsert' ? [{ table: m.table, key: keyOf(m.table, m.row as never), row: m.row }] : [])),
                    );
                    if (r.error) throw new Error(`Couldn’t upload your changes: ${r.error}`);
                  });
                }}
              />
            ))
          )}
        </Card>
        {familyItems ? (
          <T variant="caption" color="muted" style={{ marginTop: space.sm }}>
            {familyItems} {familyItems === 1 ? 'item' : 'items'} from your family are on this phone.
          </T>
        ) : null}
      </Section>

      <Section title="Privacy">
        <Card style={{ gap: space.md }}>
          <View style={styles.point}>
            <ShieldCheck size={18} color={c.success} />
            <T variant="callout" color="inkSoft" style={{ flex: 1 }}>
              Sensitive items and private zones never leave your account — the server enforces this, not just the app.
            </T>
          </View>
          <View style={styles.point}>
            <Eye size={18} color={c.success} />
            <T variant="callout" color="inkSoft" style={{ flex: 1 }}>
              Family members can only see photos of items they’re allowed to see.
            </T>
          </View>
        </Card>
      </Section>

      <View style={{ gap: space.sm, marginTop: space.xl }}>
        <Button label="Sync family now" icon={RefreshCw} variant="secondary" loading={busy === 'sync'} onPress={syncNow} />
        <Button label={family.myRole === 'owner' ? 'Delete family' : 'Leave family'} icon={family.myRole === 'owner' ? UserMinus : LogOut} variant="danger" loading={busy === 'leave'} onPress={leave} />
        <Button label="Ask the family memory" variant="ghost" onPress={() => router.push({ pathname: '/(tabs)/search' })} />
      </View>
      <Prompt spec={prompt} onClose={() => setPrompt(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, padding: space.xl, gap: space.sm },
  point: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
});
