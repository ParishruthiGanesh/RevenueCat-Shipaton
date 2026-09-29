import React, { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Copy, HandHelping, Lock, MoreHorizontal, Pencil, Tag, Trash2, Undo2, UserRound } from 'lucide-react-native';
import { computeBelief } from '@/core/beliefs';
import { findPotentialDuplicates } from '@/core/matching';
import { addAlias, correctLabel, deleteEntity, deleteObservation, ensurePerson, lendItem, markNotSame, mergeEntities, rejectObservation, returnLoan, setOwner, updateEntity } from '@/core/operations';
import { answerForBelief, describeChain } from '@/core/phrasing';
import { historyOf, usualLocation, type HistoryEntry } from '@/core/queries';
import { FREE_HISTORY_DEPTH } from '@/core/plan';
import { deleteMediaFile } from '@/data/media';
import { useDerived, useMemory } from '@/state/memory';
import { useSession } from '@/state/session';
import { usePro } from '@/state/pro';
import { track } from '@/services/analytics';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { AnswerCard } from '@/ui/components/AnswerCard';
import { Button, IconButton } from '@/ui/components/Button';
import { Card, Header, Row, Screen, Section } from '@/ui/components/Layout';
import { Prompt, type PromptSpec } from '@/ui/components/Prompt';
import { T } from '@/ui/components/Text';
import { Timeline } from '@/ui/components/Timeline';

export default function ItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { graph } = useMemory();
  const { c } = useTheme();
  const { isPro } = usePro();
  const [prompt, setPrompt] = useState<PromptSpec | null>(null);
  const { requireSignIn } = useSession();

  const data = useDerived(
    (g) => {
      const entity = g.entity(id);
      if (!entity) return null;
      const belief = computeBelief(g, entity.id);
      return {
        entity,
        belief,
        answer: answerForBelief(g, belief),
        history: historyOf(g, entity.id),
        usual: usualLocation(g, entity.id),
        dupes: findPotentialDuplicates(g, entity).slice(0, 2),
        loans: g.loans().filter((l) => l.itemId === entity.id),
        owner: g.person(entity.ownerId),
      };
    },
    [id],
  );

  if (!data) {
    return (
      <Screen>
        <Header title="Not found" subtitle="This object may have been deleted." />
      </Screen>
    );
  }
  const { entity, belief, answer, history, usual, dupes, loans, owner } = data;
  const activeLoan = loans.find((l) => !l.returnedAt);
  const visibleHistory = isPro ? history : history.slice(-FREE_HISTORY_DEPTH);

  const purge = (mediaIds: string[]) => mediaIds.forEach((m) => { const asset = graph.allMedia().find((x) => x.id === m); if (asset) deleteMediaFile(asset); });

  const rename = () =>
    setPrompt({
      title: 'Rename',
      message: 'Fixes the name everywhere. The camera’s original guess is kept as learning data.',
      initial: entity.name,
      onSubmit: (v) => {
        correctLabel(graph, entity.id, v);
        track('object_corrected', { where: 'detail' });
      },
    });
  const nickname = () => setPrompt({ title: 'Add a nickname', message: 'e.g. “travel charger”. You can search by it.', placeholder: 'Nickname', onSubmit: (v) => addAlias(graph, entity.id, v) });
  const lend = () =>
    requireSignIn('save') &&
    setPrompt({
      title: `Lend ${entity.name}`,
      message: 'Who has it? You’ll get a gentle reminder after three weeks.',
      placeholder: 'Name',
      suggestions: graph.people().filter((p) => p.relationship !== 'self').map((p) => p.name).slice(0, 5),
      confirm: 'Mark as lent',
      onSubmit: (v) => lendItem(graph, entity.id, v),
    });
  const owned = () =>
    setPrompt({
      title: 'Whose is this?',
      placeholder: 'Me, or a name',
      initial: owner?.name,
      suggestions: ['Me', ...graph.people().filter((p) => p.relationship !== 'self').map((p) => p.name).slice(0, 4)],
      onSubmit: (v) => setOwner(graph, entity.id, ensurePerson(graph, /^me$/i.test(v) ? 'Me' : v, /^me$/i.test(v) ? 'self' : 'family').id),
    });
  const remove = () =>
    Alert.alert(`Delete ${entity.name}?`, 'This permanently deletes the object, every sighting and its photos from this device (and your cloud backup, if on). This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete permanently',
        style: 'destructive',
        onPress: () => {
          purge(deleteEntity(graph, entity.id));
          router.back();
        },
      },
    ]);

  const more = () => {
    const options = ['Rename', 'Add nickname', entity.sensitive ? 'Unmark sensitive' : 'Mark as sensitive', 'Set owner', 'Delete object', 'Cancel'];
    const handle = (i: number) => [rename, nickname, () => updateEntity(graph, entity.id, { sensitive: !entity.sensitive }), owned, remove][i]?.();
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ options, destructiveButtonIndex: 4, cancelButtonIndex: 5 }, handle);
    else Alert.alert(entity.name, undefined, options.slice(0, 5).map((o, i) => ({ text: o, style: i === 4 ? 'destructive' : 'default', onPress: () => handle(i) })).concat([{ text: 'Cancel', style: 'cancel', onPress: () => undefined }]) as never);
  };

  const onEntry = (h: HistoryEntry) =>
    Alert.alert('This observation', describeChain(graph, h.chain, h.observation.placement?.relation), [
      { text: 'This sighting was wrong', onPress: () => rejectObservation(graph, h.observation.id) },
      { text: 'Delete permanently', style: 'destructive', onPress: () => purge(deleteObservation(graph, h.observation.id)) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <Screen bottomInset={60}>
      <Header back right={<IconButton icon={MoreHorizontal} label="More actions" onPress={more} />} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', marginBottom: space.lg }}>
        {entity.sensitive ? (
          <View style={[styles.tag, { backgroundColor: c.emberSoft }]}>
            <Lock size={12} color={c.emberInk} />
            <T variant="caption" style={{ color: c.emberInk }}>
              Sensitive
            </T>
          </View>
        ) : null}
        {owner ? (
          <View style={[styles.tag, { backgroundColor: c.surfaceMuted }]}>
            <UserRound size={12} color={c.inkSoft} />
            <T variant="caption" color="inkSoft">
              {owner.relationship === 'self' ? 'Mine' : `${owner.name}’s`}
            </T>
          </View>
        ) : null}
        {entity.aliases.map((a) => (
          <View key={a} style={[styles.tag, { backgroundColor: c.surfaceMuted }]}>
            <Tag size={12} color={c.inkSoft} />
            <T variant="caption" color="inkSoft">
              {a}
            </T>
          </View>
        ))}
      </View>

      <AnswerCard graph={graph} entity={entity} belief={belief} answer={answer} />

      {dupes.length ? (
        <Card tone="muted" style={{ marginTop: space.lg, gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Copy size={16} color={c.inkSoft} />
            <T variant="subheading">Possibly the same object</T>
          </View>
          <T variant="callout" color="muted">
            Is this the same as your “{dupes[0].entity.name}”? {dupes[0].reasons.slice(0, 2).join(' · ')}
          </T>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Yes, merge" size="sm" onPress={() => mergeEntities(graph, entity.id, dupes[0].entity.id)} />
            <Button label="No" size="sm" variant="secondary" onPress={() => markNotSame(graph, entity.id, dupes[0].entity.id)} />
            <Button label="Not sure" size="sm" variant="ghost" onPress={() => markNotSame(graph, entity.id, dupes[0].entity.id)} />
          </View>
        </Card>
      ) : null}

      {usual && usual.share >= 0.4 && history.length >= 3 ? (
        <Card style={{ marginTop: space.lg }}>
          <T variant="overline" color="muted">
            Usually kept
          </T>
          <T variant="bodyStrong" style={{ marginTop: space.xs }}>
            {describeChain(graph, usual.chain).replace(/^in /, 'In ')}
          </T>
          <T variant="caption" color="muted">
            About {Math.round(usual.share * 100)}% of the recorded time
          </T>
        </Card>
      ) : null}

      <Section title="Object journey">
        <Timeline graph={graph} entries={visibleHistory} loans={loans} onPressEntry={onEntry} sensitive={entity.sensitive} />
        {!isPro && history.length > FREE_HISTORY_DEPTH ? (
          <Card tone="muted" onPress={() => router.push({ pathname: '/paywall', params: { reason: 'Full object history is part of Pro.' } })}>
            <T variant="bodyStrong">{history.length - FREE_HISTORY_DEPTH} earlier observations</T>
            <T variant="caption" color="muted">
              See the full journey with Pro
            </T>
          </Card>
        ) : null}
        <T variant="caption" color="faint" style={{ marginTop: space.sm }}>
          Tap an observation to mark it wrong or delete it.
        </T>
      </Section>

      <Section title="Details">
        <Card style={{ paddingVertical: space.xs }}>
          {entity.description ? <Row title="Looks like" subtitle={entity.description} /> : null}
          {entity.attributes.colors.length ? <Row title="Colour" subtitle={entity.attributes.colors.join(', ')} /> : null}
          {entity.attributes.brand ? <Row title="Brand" subtitle={entity.attributes.brand} /> : null}
          {entity.attributes.distinguishingMarks.length ? <Row title="Distinguishing marks" subtitle={entity.attributes.distinguishingMarks.join(', ')} /> : null}
          <Row icon={Pencil} title="Rename" onPress={rename} />
          <Row icon={UserRound} title="Owner" subtitle={owner ? owner.name : 'Not set'} onPress={owned} />
          {activeLoan ? (
            <Row icon={Undo2} title={`Returned by ${graph.person(activeLoan.personId)?.name ?? 'them'}`} subtitle="Mark as back with you" onPress={() => returnLoan(graph, activeLoan.id)} />
          ) : (
            <Row icon={HandHelping} title="Lend to someone" onPress={lend} />
          )}
          <Row icon={Trash2} title="Delete object" danger onPress={remove} />
        </Card>
      </Section>
      <Prompt spec={prompt} onClose={() => setPrompt(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
});
