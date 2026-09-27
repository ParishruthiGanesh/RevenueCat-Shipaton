import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { ArrowRight, Check, ChevronDown, CornerDownRight, EyeOff, Lock, MapPin, Plus, Trash2, UserRoundX, X } from 'lucide-react-native';
import { commitCapture, resolvePath, type ReviewedPlace } from '@/core/capture';
import { createStorageBox, nextBoxNumber } from '@/core/operations';
import { formatAgo, softLower } from '@/core/phrasing';
import { computeBelief } from '@/core/beliefs';
import type { Entity } from '@/core/types';
import type { DraftItem } from '@/ai/draft';
import { captureSession, useCaptureSession } from '@/state/capture-session';
import { useMemory } from '@/state/memory';
import { usePro } from '@/state/pro';
import { track } from '@/services/analytics';
import { FREE_LIMITS } from '@/core/plan';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Button, IconButton } from '@/ui/components/Button';
import { EvidenceImage } from '@/ui/components/EvidenceImage';
import { Card, Chip } from '@/ui/components/Layout';
import { T } from '@/ui/components/Text';
import { deleteMediaFile } from '@/data/media';

const BOX_CATEGORIES = ['Kitchen', 'Clothes', 'Books', 'Electronics', 'Documents', 'Tools', 'Decorations', 'Bathroom', 'Toys', 'Misc'];
const KIND_LABEL = { room: 'Room', fixture: 'Furniture', container: 'Compartment', item: 'Container' } as const;

export default function Review() {
  const { draft, media, notice, via } = useCaptureSession();
  const { graph } = useMemory();
  const { c } = useTheme();
  const { usage, isPro, require: requireFeature } = usePro();
  const insets = useSafeAreaInsets();
  const [newItem, setNewItem] = useState('');
  const [boxCategory, setBoxCategory] = useState<string | undefined>();
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);

  if (!draft) {
    router.replace('/');
    return null;
  }

  const included = draft.items.filter((i) => i.include);
  const primary = draft.items.find((i) => i.primary && i.include) ?? included[0];
  const target = draft.targetId ? graph.entity(draft.targetId) : undefined;
  const isNewBox = draft.mode === 'box' && !target?.box;

  // "Passport → Blue pouch → Top drawer → Black dresser → Bedroom"
  const chainSentence = (() => {
    if (!primary) return [];
    const nest: string[] = [primary.name];
    let cur: DraftItem | undefined = primary;
    const seen = new Set<string>();
    while (cur?.insideItemKey && !seen.has(cur.insideItemKey)) {
      seen.add(cur.insideItemKey);
      cur = draft.items.find((i) => i.key === cur!.insideItemKey);
      if (cur) nest.push(cur.name);
    }
    const places = [...draft.path].reverse().map((p) => p.name);
    if (isNewBox) places.unshift(`Box ${nextBoxNumber(graph)}`);
    return [...nest, ...places];
  })();

  const cancel = () => {
    Alert.alert('Discard this capture?', 'Nothing will be saved.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          media.forEach(deleteMediaFile);
          captureSession.clear();
          router.replace('/');
        },
      },
    ]);
  };

  const save = () => {
    const newCount = included.filter((i) => i.identity.type === 'new').length;
    if (!isPro && usage.items + newCount > FREE_LIMITS.items && !requireFeature('remember_item')) return;
    if (!included.length) {
      Alert.alert('Nothing selected', 'Tick at least one object to remember, or add one below.');
      return;
    }
    setSaving(true);
    try {
      const firstEver = graph.items().length === 0;
      let targetId = draft.targetId;
      if (isNewBox) {
        const parentId = draft.path.length ? resolvePath(graph, draft.spaceId, draft.path) : draft.spaceId;
        targetId = createStorageBox(graph, { parentId, category: boxCategory }).id;
        track('box_created', { items: included.length });
      }
      const usedMedia = new Set(included.map((i) => i.mediaId).filter(Boolean) as string[]);
      const keep = media.filter((m) => usedMedia.has(m.id) || (m.kind === 'frame' && media.some((x) => x.parentMediaId === m.id && usedMedia.has(x.id))));
      media.filter((m) => !keep.includes(m)).forEach(deleteMediaFile);
      graph.commit(keep.map((m) => ({ op: 'upsert', table: 'media', row: m })));

      const result = commitCapture(graph, { ...draft, targetId, items: draft.items });
      captureSession.finish(result);
      const corrected = included.filter((i) => i.name.trim().toLowerCase() !== i.aiLabel.trim().toLowerCase()).length;
      if (corrected) track('object_corrected', { n: corrected });
      track('capture_saved', { mode: draft.mode, via: via ?? 'manual', items: included.length, new_items: newCount });
      if (draft.mode === 'scan') track('scan_completed', { items: included.length, not_detected: result.diff.notDetected.length });
      if (draft.mode === 'box' && !isNewBox) track('box_scanned', { items: included.length });
      if (firstEver) track('first_object_saved');
      router.replace('/capture/result');
    } catch (e) {
      Alert.alert('Couldn’t save', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const updatePath = (idx: number, patch: Partial<ReviewedPlace>) =>
    captureSession.updateDraft((d) => ({ ...d, targetId: d.mode === 'box' ? d.targetId : undefined, path: d.path.map((p, i) => (i === idx ? { ...p, ...patch, id: patch.name !== undefined && patch.name !== p.name ? undefined : (patch.id ?? p.id) } : p)) }));

  const addItem = () => {
    const name = newItem.trim();
    if (!name) return;
    captureSession.updateDraft((d) => ({
      ...d,
      items: [
        ...d.items,
        { key: `added-${Date.now()}`, include: true, identity: { type: 'new' }, name, aiLabel: name, attributes: { colors: [], distinguishingMarks: [] }, sensitive: false, detectionConfidence: 1, matchConfidence: 1, relation: 'INSIDE', matchKind: 'new', primary: false, frameIndex: 0, candidates: [] },
      ],
    }));
    setNewItem('');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.xl, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        <View style={styles.headRow}>
          <IconButton icon={X} label="Discard" onPress={cancel} />
          <T variant="overline" color="muted">
            {draft.mode === 'box' ? 'Storage box' : draft.mode === 'scan' ? 'Area scan' : 'Remember'}
          </T>
          <View style={{ width: 40 }} />
        </View>

        <T variant="title" style={{ marginTop: space.lg }}>
          {via === 'ai' ? 'Here’s what I see' : 'What are you putting away?'}
        </T>
        {draft.summary ? (
          <T variant="callout" color="muted" style={{ marginTop: space.xs }}>
            {draft.summary}
          </T>
        ) : null}

        {notice ? (
          <Card tone="ember" style={{ marginTop: space.lg }}>
            <T variant="callout" style={{ color: c.emberInk }}>
              {notice}
            </T>
          </Card>
        ) : null}
        {draft.peoplePresent ? (
          <View style={[styles.note, { backgroundColor: c.surfaceMuted }]}>
            <UserRoundX size={16} color={c.muted} />
            <T variant="caption" color="muted" style={{ flex: 1 }}>
              A person was visible. Only close-ups of objects were kept — the full photo was discarded.
            </T>
          </View>
        ) : null}

        {chainSentence.length > 1 ? (
          <Animated.View entering={FadeInDown} style={[styles.chain, { backgroundColor: c.surface, borderColor: c.line }]}>
            {chainSentence.map((n, i) => (
              <React.Fragment key={`${n}-${i}`}>
                {i > 0 ? <ArrowRight size={16} color={c.faint} /> : null}
                <T variant={i === 0 ? 'heading' : 'subheading'} color={i === 0 ? 'ink' : 'inkSoft'}>
                  {n}
                </T>
              </React.Fragment>
            ))}
          </Animated.View>
        ) : null}

        {/* WHERE */}
        <T variant="overline" color="muted" style={styles.section}>
          Where
        </T>
        {draft.mode === 'box' && isNewBox ? (
          <Card style={{ gap: space.md, marginBottom: space.md }}>
            <T variant="subheading">{`Box ${nextBoxNumber(graph)}`} — what kind of things?</T>
            <View style={styles.wrap}>
              {BOX_CATEGORIES.map((cat) => (
                <Chip key={cat} label={cat} selected={boxCategory === cat} onPress={() => setBoxCategory(boxCategory === cat ? undefined : cat)} />
              ))}
            </View>
          </Card>
        ) : null}
        {target && !isNewBox ? (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <MapPin size={18} color={c.inkSoft} />
            <T variant="bodyStrong" style={{ flex: 1 }}>
              {graph.pathLabel(graph.chainFrom(target.id))}
            </T>
          </Card>
        ) : (
          <Card style={{ gap: 0, paddingVertical: space.xs }}>
            {draft.path.length === 0 ? (
              <T variant="callout" color="muted" style={{ paddingVertical: space.md }}>
                {isNewBox ? 'Where will the box live? (optional)' : 'Where is this? Pick a known place or add one.'}
              </T>
            ) : (
              draft.path.map((p, idx) => (
                <PathRow key={`${idx}-${p.kind}`} place={p} depth={idx} onRename={(name) => updatePath(idx, { name })} onRemove={() => captureSession.updateDraft((d) => ({ ...d, path: d.path.filter((_, i) => i !== idx) }))} />
              ))
            )}
            <View style={styles.pathActions}>
              <Button label="Choose a place" icon={MapPin} size="sm" variant="secondary" onPress={() => setPicker(true)} />
              <Button
                label="Add level"
                icon={Plus}
                size="sm"
                variant="ghost"
                onPress={() => captureSession.updateDraft((d) => ({ ...d, path: [...d.path, { name: d.path.length === 0 ? 'Room' : 'Drawer', kind: d.path.length === 0 ? 'room' : 'container' }] }))}
              />
            </View>
            {draft.pathSource === 'voice' ? (
              <T variant="caption" color="faint" style={{ paddingBottom: space.sm }}>
                From what you said
              </T>
            ) : null}
          </Card>
        )}

        {/* WHAT */}
        <T variant="overline" color="muted" style={styles.section}>
          {draft.mode === 'remember' ? 'What' : `Detected (${included.length} of ${draft.items.length} selected)`}
        </T>
        <View style={{ gap: space.sm }}>
          {draft.items.map((it, idx) => (
            <Animated.View key={it.key} entering={FadeInDown.delay(Math.min(idx, 6) * 50)} layout={LinearTransition}>
              <ItemRow item={it} media={it.mediaId ? mediaById.get(it.mediaId) ?? graph.media(it.mediaId) : undefined} parentName={it.insideItemKey ? draft.items.find((x) => x.key === it.insideItemKey)?.name : undefined} />
            </Animated.View>
          ))}
        </View>

        <View style={[styles.addRow, { borderColor: c.line, backgroundColor: c.surface }]}>
          <Plus size={18} color={c.muted} />
          <TextInput value={newItem} onChangeText={setNewItem} onSubmitEditing={addItem} placeholder="Add something the camera missed" placeholderTextColor={c.faint} style={[styles.addInput, { color: c.ink }]} returnKeyType="done" accessibilityLabel="Add a missing object" />
          {newItem ? <Button label="Add" size="sm" onPress={addItem} /> : null}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md, backgroundColor: c.bg, borderTopColor: c.line }]}>
        <Button label={isNewBox ? `Create Box ${nextBoxNumber(graph)}` : `Remember ${included.length || ''} ${included.length === 1 ? 'thing' : 'things'}`.replace('  ', ' ')} variant="ember" size="lg" full loading={saving} onPress={save} icon={Check} />
      </View>

      <PlacePicker
        visible={picker}
        onClose={() => setPicker(false)}
        onPick={(e) => {
          setPicker(false);
          const chain = graph.chainFrom(e.id).reverse().map((id) => graph.entity(id)!).filter((x) => x.kind !== 'space');
          captureSession.updateDraft((d) => ({
            ...d,
            spaceId: graph.chainFrom(e.id).map((id) => graph.entity(id)).find((x) => x?.kind === 'space')?.id ?? d.spaceId,
            targetId: d.mode === 'box' ? undefined : e.id,
            path: chain.map((x) => ({ id: x.id, name: x.name, kind: (x.kind === 'item' ? 'container' : x.kind) as ReviewedPlace['kind'] })),
            pathSource: 'existing',
          }));
        }}
      />
    </KeyboardAvoidingView>
  );
}

function PathRow({ place, depth, onRename, onRemove }: { place: ReviewedPlace; depth: number; onRename: (n: string) => void; onRemove: () => void }) {
  const { c } = useTheme();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(place.name);
  return (
    <View style={[styles.pathRow, { borderBottomColor: c.line, paddingLeft: depth * 14 }]}>
      {depth > 0 ? <CornerDownRight size={14} color={c.faint} /> : null}
      <View style={{ flex: 1 }}>
        <T variant="caption" color="faint">
          {KIND_LABEL[place.kind]}
          {place.id ? ' · known place' : ' · new'}
        </T>
        {editing ? (
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            onBlur={() => {
              setEditing(false);
              if (text.trim() && text !== place.name) onRename(text.trim());
            }}
            onSubmitEditing={() => setEditing(false)}
            style={[styles.inlineInput, { color: c.ink, borderColor: c.ember }]}
            accessibilityLabel={`Rename ${place.name}`}
          />
        ) : (
          <Pressable onPress={() => setEditing(true)} accessibilityRole="button" accessibilityLabel={`${place.name}, tap to rename`}>
            <T variant="bodyStrong">{place.name}</T>
          </Pressable>
        )}
        {place.aiName && place.aiName.toLowerCase() !== place.name.toLowerCase() ? (
          <T variant="caption" color="faint">
            Camera suggested “{place.aiName}”
          </T>
        ) : null}
      </View>
      {place.id ? <Check size={16} color={c.success} /> : null}
      <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${place.name}`}>
        <Trash2 size={16} color={c.faint} />
      </Pressable>
    </View>
  );
}

function ItemRow({ item, media, parentName }: { item: DraftItem; media?: import('@/core/types').MediaAsset; parentName?: string }) {
  const { graph } = useMemory();
  const { c, confidence } = useTheme();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.name);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const matched = item.identity.type === 'existing' ? graph.entity(item.identity.entityId) : undefined;
  const top = item.candidates[0]?.entity;
  const corrected = item.name.trim().toLowerCase() !== item.aiLabel.trim().toLowerCase();
  const update = (patch: Partial<DraftItem>) => captureSession.updateItem(item.key, patch);
  const detLevel = item.detectionConfidence >= 0.8 ? 'high' : item.detectionConfidence >= 0.55 ? 'medium' : 'low';

  const commitName = () => {
    setEditing(false);
    if (text.trim() && text.trim() !== item.name) update({ name: text.trim() });
  };

  return (
    <Card style={{ padding: space.md, opacity: item.include ? 1 : 0.55, gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
        <Pressable onPress={() => update({ include: !item.include })} accessibilityRole="checkbox" accessibilityState={{ checked: item.include }} accessibilityLabel={`Include ${item.name}`} style={[styles.check, { borderColor: item.include ? c.ink : c.lineStrong, backgroundColor: item.include ? c.ink : 'transparent' }]}>
          {item.include ? <Check size={14} color={c.inverse} /> : null}
        </Pressable>
        <EvidenceImage media={media} name={item.name} category={item.category} size={56} rounded={radius.md} sensitive={item.sensitive} revealed />
        <View style={{ flex: 1, gap: 2 }}>
          {editing ? (
            <TextInput value={text} onChangeText={setText} autoFocus onBlur={commitName} onSubmitEditing={commitName} style={[styles.inlineInput, { color: c.ink, borderColor: c.ember }]} accessibilityLabel="Correct the name" />
          ) : (
            <Pressable onPress={() => setEditing(true)} accessibilityRole="button" accessibilityLabel={`${item.name}. Tap to correct`}>
              <T variant="subheading">{item.name}</T>
            </Pressable>
          )}
          <View style={styles.metaRow}>
            {item.primary ? (
              <T variant="caption" color="ember">
                You’re putting this away
              </T>
            ) : null}
            {parentName ? (
              <T variant="caption" color="muted">
                inside {parentName}
              </T>
            ) : null}
            {!item.primary && !parentName && item.detectionConfidence < 1 ? (
              <View style={[styles.dot, { backgroundColor: confidence[detLevel].dot }]} />
            ) : null}
            {!item.primary && !parentName && item.detectionConfidence < 1 ? (
              <T variant="caption" color="muted">
                {detLevel === 'high' ? 'Clearly seen' : detLevel === 'medium' ? 'Probably' : 'Not sure'}
              </T>
            ) : null}
          </View>
          {corrected ? (
            <T variant="caption" color="faint">
              Camera saw “{item.aiLabel}”
            </T>
          ) : null}
        </View>
        <Pressable onPress={() => update({ sensitive: !item.sensitive })} hitSlop={8} accessibilityRole="switch" accessibilityState={{ checked: item.sensitive }} accessibilityLabel="Sensitive object">
          {item.sensitive ? <Lock size={18} color={c.ember} /> : <EyeOff size={18} color={c.faint} />}
        </Pressable>
      </View>

      {item.include && !corrected && !editing ? (
        <Pressable onPress={() => setShowSuggestions((s) => !s)} style={styles.actually} accessibilityRole="button">
          <T variant="caption" color="muted">
            Actually…
          </T>
          <ChevronDown size={12} color={c.muted} />
        </Pressable>
      ) : null}
      {showSuggestions ? (
        <View style={styles.wrap}>
          {[...new Set([...item.candidates.map((x) => x.entity.name), ...quickAlternatives(item.aiLabel)])].slice(0, 5).map((s) => (
            <Chip key={s} label={s} onPress={() => { update({ name: s }); setText(s); setShowSuggestions(false); }} />
          ))}
          <Chip label="Type it…" onPress={() => { setShowSuggestions(false); setEditing(true); }} />
        </View>
      ) : null}

      {/* identity: never silently merge */}
      {item.include && item.matchKind === 'ask' && top && item.identity.type === 'new' ? (
        <View style={[styles.identity, { backgroundColor: c.surfaceMuted }]}>
          <T variant="callout">Is this the same {softLower(top.name)} you saved before?</T>
          <T variant="caption" color="muted">
            {describeLast(graph, top)}
          </T>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
            <Button label="Yes" size="sm" onPress={() => update({ identity: { type: 'existing', entityId: top.id }, name: top.name, matchKind: 'same', matchConfidence: 1 })} />
            <Button label="No, it’s different" size="sm" variant="secondary" onPress={() => update({ matchKind: 'new' })} />
            <Button label="Not sure" size="sm" variant="ghost" onPress={() => update({ matchKind: 'new' })} />
          </View>
        </View>
      ) : null}
      {item.include && matched ? (
        <View style={styles.metaRow}>
          <Check size={14} color={c.success} />
          <T variant="caption" color="muted" style={{ flex: 1 }}>
            Your {softLower(matched.name)} · {describeLast(graph, matched)}
          </T>
          <Pressable onPress={() => update({ identity: { type: 'new' }, matchKind: 'new', name: item.aiLabel.charAt(0).toUpperCase() + item.aiLabel.slice(1) })} hitSlop={8} accessibilityRole="button">
            <T variant="caption" color="ember">
              Not the same
            </T>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}

function describeLast(graph: ReturnType<typeof useMemory>['graph'], e: Entity): string {
  const b = computeBelief(graph, e.id);
  if (!b.primary) return 'no sightings yet';
  return `last seen in ${graph.entity(b.primary.currentChain[0])?.name ?? 'somewhere'} ${formatAgo(b.primary.observation.observedAt)}`;
}

/** Common mix-ups worth one tap. */
function quickAlternatives(label: string): string[] {
  const l = label.toLowerCase();
  if (/power bank|battery/.test(l)) return ['External SSD', 'Phone charger', 'Hard drive'];
  if (/charger|adapter/.test(l)) return ['Laptop charger', 'Phone charger', 'Travel adapter', 'Power bank'];
  if (/cable|cord/.test(l)) return ['USB-C cable', 'Lightning cable', 'HDMI cable'];
  if (/notebook|book/.test(l)) return ['Passport', 'Notebook', 'Journal'];
  if (/earbuds|airpods|case/.test(l)) return ['AirPods case', 'Earbuds', 'Glasses case'];
  return [];
}

function PlacePicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (e: Entity) => void }) {
  const { graph } = useMemory();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const places = graph
    .entities((e) => e.kind !== 'space' && (e.kind !== 'item' || e.isContainer))
    .filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => graph.chainFrom(a.id).length - graph.chainFrom(b.id).length || a.name.localeCompare(b.name));
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg, padding: space.xl, paddingBottom: insets.bottom }}>
        <View style={styles.headRow}>
          <T variant="heading">Choose a place</T>
          <IconButton icon={X} label="Close" onPress={onClose} />
        </View>
        <TextInput value={q} onChangeText={setQ} placeholder="Search rooms, drawers, boxes…" placeholderTextColor={c.faint} style={[styles.search, { backgroundColor: c.surface, borderColor: c.line, color: c.ink }]} />
        <ScrollView style={{ marginTop: space.md }}>
          {places.map((p) => (
            <Pressable key={p.id} onPress={() => onPick(p)} style={[styles.pickRow, { borderBottomColor: c.line }]} accessibilityRole="button">
              <T variant="bodyStrong">{p.name}</T>
              <T variant="caption" color="muted">
                {graph.pathLabel(graph.chainFrom(graph.structuralPlacement(p.id)?.parentId))}
              </T>
            </Pressable>
          ))}
          {!places.length ? (
            <T variant="callout" color="muted" style={{ marginTop: space.lg }}>
              No places yet — add levels on the review screen and they’ll be created as you save.
            </T>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  note: { flexDirection: 'row', gap: space.sm, alignItems: 'center', padding: space.md, borderRadius: radius.md, marginTop: space.md },
  chain: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, padding: space.lg, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, marginTop: space.xl },
  section: { marginTop: space.xxl, marginBottom: space.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  pathRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  pathActions: { flexDirection: 'row', gap: space.sm, paddingVertical: space.md },
  inlineInput: { fontSize: 16, fontFamily: 'Inter_600SemiBold', borderBottomWidth: 2, paddingVertical: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  actually: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginLeft: 24 + 56 + space.md * 2 },
  identity: { borderRadius: radius.md, padding: space.md, gap: 2 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed', borderRadius: radius.lg, paddingHorizontal: space.md, height: 54, marginTop: space.md },
  addInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', height: '100%' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.xl, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  search: { height: 48, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, marginTop: space.lg, fontSize: 16 },
  pickRow: { paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
});
