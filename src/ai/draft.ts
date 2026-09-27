import type { SceneAnalysisT, SceneObjectT, ScenePlaceT } from '../../supabase/functions/_shared/scene-schema';
import type { CaptureMode, ReviewedItem, ReviewedPlace } from '@/core/capture';
import type { MemoryGraph } from '@/core/graph';
import { matchDetection, type MatchCandidate } from '@/core/matching';
import { parseVoiceCommand } from '@/core/query';
import { resolvePlace } from '@/core/search';
import { normalize, tokenOverlap } from '@/core/text';
import type { Entity, ID, ObservationSource, VisualAttributes } from '@/core/types';

/**
 * Turns the vision model's proposal + what the user said into an editable DRAFT for the
 * review screen. Pure (no I/O) so it is fully unit-tested.
 *
 * Priority of truth: what the user SAID > the user's existing places > what the model SAW.
 */

export type MatchKind = 'same' | 'ask' | 'new';

export interface DraftItem extends ReviewedItem {
  matchKind: MatchKind;
  primary: boolean;
  frameIndex: number;
  candidates: MatchCandidate[];
}

export interface DraftCapture {
  captureId: ID;
  mode: CaptureMode;
  observedAt: string;
  spaceId: ID;
  source: ObservationSource;
  targetId?: ID;
  path: ReviewedPlace[];
  items: DraftItem[];
  summary: string;
  notes?: string;
  peoplePresent: boolean;
  quality: SceneAnalysisT['scene']['quality'];
  utterance?: string;
  /** Where the path came from, shown to the user as provenance. */
  pathSource: 'voice' | 'existing' | 'vision' | 'target' | 'none';
}

export interface DraftContext {
  captureId: ID;
  mode: CaptureMode;
  observedAt: string;
  spaceId: ID;
  utterance?: string;
  targetId?: ID;
  at?: Date;
}

const toAttributes = (o: SceneObjectT): VisualAttributes => ({
  colors: o.attributes.colors,
  brand: o.attributes.brand ?? undefined,
  model: o.attributes.model ?? undefined,
  material: o.attributes.material ?? undefined,
  shape: o.attributes.shape ?? undefined,
  sizeClass: o.attributes.sizeClass,
  distinguishingMarks: o.attributes.distinguishingMarks,
});

/** Walk parentRef links to produce the outermost → innermost chain of scene places. */
export function placeChain(places: ScenePlaceT[], innermostRef: string | null): ScenePlaceT[] {
  const byRef = new Map(places.map((p) => [p.ref, p]));
  const chain: ScenePlaceT[] = [];
  const seen = new Set<string>();
  let cur = innermostRef ? byRef.get(innermostRef) : undefined;
  while (cur && !seen.has(cur.ref)) {
    seen.add(cur.ref);
    chain.unshift(cur);
    cur = cur.parentRef ? byRef.get(cur.parentRef) : undefined;
  }
  return chain;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Map scene places onto the user's existing structure where names agree. */
function reconcilePath(graph: MemoryGraph, spaceId: ID, chain: ScenePlaceT[]): ReviewedPlace[] {
  const out: ReviewedPlace[] = [];
  let parent: ID | undefined = spaceId;
  for (const p of chain) {
    const siblings: Entity[] = parent ? graph.structuralChildren(parent) : [];
    const n = normalize(p.label);
    const match = siblings
      .map((s) => ({ s, score: normalize(s.name) === n ? 1 : tokenOverlap(s.name, p.label) }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)[0];
    if (match) {
      out.push({ id: match.s.id, name: match.s.name, kind: match.s.kind as ReviewedPlace['kind'], aiName: p.label });
      parent = match.s.id;
    } else {
      out.push({ name: capitalize(p.label), kind: p.kind, aiName: p.label });
      parent = undefined; // below a new place everything is new
    }
  }
  return out;
}

function pathFromExisting(graph: MemoryGraph, place: Entity): ReviewedPlace[] {
  const chain = graph.chainFrom(place.id).reverse(); // outermost first
  return chain
    .map((id) => graph.entity(id)!)
    .filter((e) => e && e.kind !== 'space')
    .map((e) => ({ id: e.id, name: e.name, kind: (e.kind === 'item' ? 'container' : e.kind) as ReviewedPlace['kind'] }));
}

export function buildDraft(graph: MemoryGraph, analysis: SceneAnalysisT, ctx: DraftContext): DraftCapture {
  const at = ctx.at ?? new Date(ctx.observedAt);
  const voice = ctx.utterance ? parseVoiceCommand(ctx.utterance) : undefined;
  const voiceItem = voice && (voice.action === 'remember' || voice.action === 'lend') ? voice.item : voice?.action === 'label' ? voice.name : undefined;
  const voicePlace = voice?.action === 'remember' ? voice.place : voice?.action === 'move_box' ? voice.place : undefined;

  const placeRefs = new Set(analysis.places.map((p) => p.ref));
  const objects = analysis.objects;
  const primary = objects.find((o) => o.primary) ?? (ctx.mode === 'remember' ? [...objects].sort((a, b) => b.confidence - a.confidence)[0] : undefined);

  // ── Resolve WHERE ──
  let path: ReviewedPlace[] = [];
  let pathSource: DraftCapture['pathSource'] = 'none';
  const target = ctx.targetId ? graph.entity(ctx.targetId) : undefined;
  if (target) {
    path = pathFromExisting(graph, target);
    pathSource = 'target';
  } else if (voicePlace && resolvePlace(graph, voicePlace)) {
    path = pathFromExisting(graph, resolvePlace(graph, voicePlace)!);
    pathSource = 'voice';
  } else {
    // Innermost PLACE that holds the primary object (skipping object containers like pouches).
    let ref: string | null = primary?.placement.parentRef ?? null;
    const byObj = new Map(objects.map((o) => [o.ref, o]));
    const guard = new Set<string>();
    while (ref && !placeRefs.has(ref) && byObj.has(ref) && !guard.has(ref)) {
      guard.add(ref);
      ref = byObj.get(ref)!.placement.parentRef;
    }
    if (!ref || !placeRefs.has(ref)) {
      // No explicit containment: take the deepest place in the scene.
      const depth = (p: ScenePlaceT) => placeChain(analysis.places, p.ref).length;
      ref = [...analysis.places].sort((a, b) => depth(b) - depth(a))[0]?.ref ?? null;
    }
    const chain = placeChain(analysis.places, ref);
    if (chain.length && chain[0].kind !== 'room' && analysis.scene.roomType) {
      chain.unshift({ ref: '_room', kind: 'room', label: capitalize(analysis.scene.roomType), description: '', parentRef: null, confidence: 0.5 });
    }
    path = reconcilePath(graph, ctx.spaceId, chain);
    pathSource = path.some((p) => p.id) ? 'existing' : path.length ? 'vision' : 'none';
    if (voicePlace && path.length) {
      // The user named the spot but we don't know it yet: their words name the innermost place.
      path[path.length - 1] = { ...path[path.length - 1], id: undefined, name: capitalize(voicePlace), aiName: path[path.length - 1].aiName };
      pathSource = 'voice';
    } else if (voicePlace) {
      path = [{ name: capitalize(voicePlace), kind: 'container' }];
      pathSource = 'voice';
    }
  }

  const innermostExisting = target?.id ?? [...path].reverse().find((p) => p.id)?.id;

  // ── Resolve WHAT ──
  const items: DraftItem[] = objects.map((o) => {
    const isPrimary = o === primary;
    const userName = isPrimary && voiceItem ? capitalize(voiceItem) : undefined;
    const attributes = toAttributes(o);
    const decision = matchDetection(graph, { label: userName ?? o.label, category: o.category, description: o.visualDescription, attributes, contextParentId: innermostExisting }, at);
    const insideItemKey = o.placement.parentRef && !placeRefs.has(o.placement.parentRef) && objects.some((x) => x.ref === o.placement.parentRef) ? o.placement.parentRef : undefined;
    const base: DraftItem = {
      key: o.ref,
      include: ctx.mode !== 'remember' || isPrimary || o.confidence >= 0.5,
      identity: { type: 'new' },
      name: userName ?? capitalize(o.label),
      aiLabel: o.label,
      category: o.category,
      description: o.visualDescription,
      attributes,
      sensitive: o.sensitive,
      isContainer: o.isContainer,
      detectionConfidence: o.confidence,
      matchConfidence: 1,
      bbox: o.bbox ?? undefined,
      relation: o.placement.relation,
      insideItemKey,
      matchKind: decision.kind,
      primary: isPrimary,
      frameIndex: o.frameIndex,
      candidates: decision.candidates,
    };
    if (decision.kind === 'same') {
      return { ...base, identity: { type: 'existing', entityId: decision.entity.id }, name: userName ?? decision.entity.name, matchConfidence: decision.score };
    }
    return base;
  });

  // Remember mode: the primary object first; everything else defaults to "also saw".
  items.sort((a, b) => Number(b.primary) - Number(a.primary) || b.detectionConfidence - a.detectionConfidence);

  return {
    captureId: ctx.captureId,
    mode: ctx.mode,
    observedAt: ctx.observedAt,
    spaceId: ctx.spaceId,
    source: ctx.mode === 'box' ? 'box_scan' : ctx.mode === 'scan' ? 'area_scan' : 'camera_capture',
    targetId: ctx.targetId,
    path,
    items,
    summary: analysis.scene.summary,
    notes: analysis.notes ?? undefined,
    peoplePresent: analysis.scene.peoplePresent,
    quality: analysis.scene.quality,
    utterance: ctx.utterance,
    pathSource,
  };
}

/** Draft for when cloud AI is off or unavailable: the user's words become the structure. */
export function manualDraft(graph: MemoryGraph, ctx: DraftContext): DraftCapture {
  const voice = ctx.utterance ? parseVoiceCommand(ctx.utterance) : undefined;
  const itemName = voice?.action === 'remember' ? voice.item : voice?.action === 'label' ? voice.name : undefined;
  const placeText = voice?.action === 'remember' ? voice.place : undefined;
  const target = ctx.targetId ? graph.entity(ctx.targetId) : placeText ? resolvePlace(graph, placeText) : undefined;
  const path = target ? pathFromExisting(graph, target) : placeText ? [{ name: capitalize(placeText), kind: 'container' as const }] : [];
  const items: DraftItem[] = itemName
    ? [
        {
          key: 'manual-1',
          include: true,
          identity: { type: 'new' },
          name: capitalize(itemName),
          aiLabel: capitalize(itemName),
          attributes: { colors: [], distinguishingMarks: [] },
          sensitive: false,
          detectionConfidence: 1,
          matchConfidence: 1,
          relation: 'INSIDE',
          matchKind: 'new',
          primary: true,
          frameIndex: 0,
          candidates: [],
        },
      ]
    : [];
  if (items[0]) {
    const d = matchDetection(graph, { label: items[0].name, attributes: items[0].attributes, contextParentId: target?.id });
    items[0].matchKind = d.kind;
    items[0].candidates = d.candidates;
    if (d.kind === 'same') items[0].identity = { type: 'existing', entityId: d.entity.id };
  }
  return {
    captureId: ctx.captureId,
    mode: ctx.mode,
    observedAt: ctx.observedAt,
    spaceId: ctx.spaceId,
    source: ctx.mode === 'box' ? 'box_scan' : ctx.mode === 'scan' ? 'area_scan' : 'camera_capture',
    targetId: target?.id ?? ctx.targetId,
    path,
    items,
    summary: '',
    peoplePresent: false,
    quality: 'good',
    utterance: ctx.utterance,
    pathSource: target ? 'target' : placeText ? 'voice' : 'none',
  };
}
