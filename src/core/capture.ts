import { computeBelief } from './beliefs';
import type { MemoryGraph, Mutation } from './graph';
import { nowIso } from './ids';
import { buildAbsence, buildCorrection, createEntity, ensurePlace, recordSighting, updateEntity } from './operations';
import type { MatchCandidate } from './matching';
import type { BoundingBox, Entity, EntityKind, ID, ISODate, Observation, ObservationSource, PlacementRelation, VisualAttributes } from './types';

/**
 * CAPTURE COMMIT
 *
 * The vision pipeline proposes; the user disposes. A `ReviewedCapture` is what the user
 * confirmed on the review screen. Committing it:
 *   1. resolves/creates the place chain (room → furniture → drawer …),
 *   2. creates or re-identifies each item (never silently merging ambiguous ones),
 *   3. appends sightings with evidence, confidence and media,
 *   4. records corrections where the user changed the AI's answer,
 *   5. for area scans, appends ABSENCE observations for things not detected,
 *   6. returns a diff of what changed in that place.
 */

export type CaptureMode = 'remember' | 'scan' | 'box';

export interface ReviewedPlace {
  /** Existing entity, if the user picked/confirmed one. */
  id?: ID;
  name: string;
  kind: Exclude<EntityKind, 'space'>;
  /** Relation of this place to the one above it. */
  relation?: PlacementRelation;
  aiName?: string;
}

export type ItemIdentity = { type: 'existing'; entityId: ID } | { type: 'new' };

export interface ReviewedItem {
  key: string;
  include: boolean;
  identity: ItemIdentity;
  name: string;
  aiLabel: string;
  category?: string;
  description?: string;
  attributes: VisualAttributes;
  sensitive: boolean;
  ownerId?: ID;
  isContainer?: boolean;
  detectionConfidence: number;
  matchConfidence: number;
  bbox?: BoundingBox;
  /** Crop (or frame) used as evidence. */
  mediaId?: ID;
  relation: PlacementRelation;
  /** Placed inside another detected item (passport inside the blue pouch). */
  insideItemKey?: string;
  /** Candidates shown to the user when identity was ambiguous. */
  candidates?: MatchCandidate[];
}

export interface ReviewedCapture {
  captureId: ID;
  mode: CaptureMode;
  observedAt: ISODate;
  spaceId: ID;
  /** Outermost → innermost under the space. The last element is the target place. */
  path: ReviewedPlace[];
  items: ReviewedItem[];
  source: ObservationSource;
  deviceId?: string;
  /** An existing target (e.g. a Storage Box or a drawer chosen from "Scan drawer"). Overrides path. */
  targetId?: ID;
}

export interface SavedItem {
  entity: Entity;
  observation: Observation;
  isNew: boolean;
}

export interface ScanDiff {
  targetId: ID;
  added: Entity[];
  stillHere: Entity[];
  notDetected: Entity[];
  movedIn: { entity: Entity; fromChain: ID[] }[];
}

export interface CommitResult {
  targetId: ID;
  savedItems: SavedItem[];
  absences: Observation[];
  diff: ScanDiff;
}

export function resolvePath(graph: MemoryGraph, spaceId: ID, path: ReviewedPlace[]): ID {
  let parent = spaceId;
  for (const p of path) {
    if (p.id && graph.entity(p.id)) {
      parent = p.id;
      continue;
    }
    const kind = p.kind === 'item' ? 'container' : p.kind;
    const place = ensurePlace(graph, parent, p.name, kind);
    if (p.aiName && p.aiName !== p.name) {
      graph.commit([{ op: 'upsert', table: 'corrections', row: buildCorrection({ entityId: place.id, field: p.kind === 'room' ? 'room' : 'placement', aiValue: p.aiName, userValue: p.name }) }]);
    }
    parent = place.id;
  }
  return parent;
}

/** Items believed to be directly in `placeId` right now. */
export function believedDirectContents(graph: MemoryGraph, placeId: ID, at: Date): Entity[] {
  return graph.items().filter((e) => {
    const b = computeBelief(graph, e.id, at);
    return b.status !== 'lent' && b.primary?.observation.placement?.parentId === placeId;
  });
}

export function commitCapture(graph: MemoryGraph, rc: ReviewedCapture): CommitResult {
  const at = new Date(rc.observedAt);
  const targetId = rc.targetId && graph.entity(rc.targetId) ? rc.targetId : resolvePath(graph, rc.spaceId, rc.path);

  // Snapshot beliefs BEFORE writing, to compute an honest diff.
  const before = believedDirectContents(graph, targetId, at);
  const priorChains = new Map<ID, ID[]>();
  for (const it of rc.items) {
    if (it.identity.type === 'existing') {
      const b = computeBelief(graph, it.identity.entityId, at);
      if (b.primary) priorChains.set(it.identity.entityId, b.primary.currentChain);
    }
  }

  const included = rc.items.filter((i) => i.include);
  // Containers-within-the-capture first (the pouch before the passport inside it).
  const order = [...included].sort((a, b) => Number(!!a.insideItemKey) - Number(!!b.insideItemKey));
  const keyToEntity = new Map<string, ID>();
  const saved: SavedItem[] = [];

  for (const it of order) {
    let entity: Entity | undefined;
    let isNew = false;
    const parentId = (it.insideItemKey && keyToEntity.get(it.insideItemKey)) || targetId;

    if (it.identity.type === 'existing') {
      entity = graph.entity(it.identity.entityId);
      if (entity) {
        const patch: Partial<Entity> = {};
        if (it.name && it.name !== entity.name) patch.name = it.name;
        if (!entity.coverMediaId && it.mediaId) patch.coverMediaId = it.mediaId;
        if (it.sensitive && !entity.sensitive) patch.sensitive = true;
        if (it.isContainer && !entity.isContainer) patch.isContainer = true;
        if (Object.keys(patch).length) entity = updateEntity(graph, entity.id, patch) ?? entity;
      }
    }
    if (!entity) {
      isNew = true;
      entity = createEntity(graph, {
        kind: 'item',
        name: it.name,
        category: it.category,
        description: it.description,
        attributes: it.attributes,
        sensitive: it.sensitive,
        ownerId: it.ownerId,
        isContainer: it.isContainer ?? false,
        coverMediaId: it.mediaId,
      });
    }
    keyToEntity.set(it.key, entity.id);

    const corrected = normalizeLabel(it.name) !== normalizeLabel(it.aiLabel);
    const obs = recordSighting(graph, {
      subjectId: entity.id,
      parentId,
      relation: it.relation,
      source: rc.source,
      evidence: 'observed',
      observedAt: rc.observedAt,
      detectionConfidence: it.detectionConfidence,
      // The user explicitly confirmed identity on the review screen → full match confidence.
      matchConfidence: it.identity.type === 'existing' ? Math.max(it.matchConfidence, 0.95) : 1,
      mediaId: it.mediaId,
      bbox: it.bbox,
      captureId: rc.captureId,
      detectedLabel: it.aiLabel,
      verifiedLabel: it.name,
      verification: corrected ? 'corrected' : 'confirmed',
      deviceId: rc.deviceId,
    });
    if (corrected && it.aiLabel) {
      graph.commit([{ op: 'upsert', table: 'corrections', row: buildCorrection({ entityId: entity.id, observationId: obs.id, field: 'label', aiValue: it.aiLabel, userValue: it.name }) }]);
    }
    saved.push({ entity, observation: obs, isNew });
  }

  // Area/box scans are exhaustive views of the target: anything believed there but not seen gets an absence.
  const absences: Observation[] = [];
  const seenIds = new Set(saved.map((s) => s.entity.id));
  if (rc.mode === 'scan' || rc.mode === 'box') {
    const muts: Mutation[] = [];
    for (const e of before) {
      if (seenIds.has(e.id)) continue;
      const a = buildAbsence(graph, e.id, targetId, rc.captureId, rc.observedAt);
      absences.push(a);
      muts.push({ op: 'upsert', table: 'observations', row: a });
    }
    graph.commit(muts);
  }

  const beforeIds = new Set(before.map((e) => e.id));
  const diff: ScanDiff = {
    targetId,
    added: saved.filter((s) => !beforeIds.has(s.entity.id) && !priorChains.has(s.entity.id)).map((s) => s.entity),
    stillHere: saved.filter((s) => beforeIds.has(s.entity.id)).map((s) => s.entity),
    notDetected: absences.map((a) => graph.entity(a.subjectId)).filter((e): e is Entity => !!e),
    movedIn: saved
      .filter((s) => !beforeIds.has(s.entity.id) && priorChains.has(s.entity.id) && priorChains.get(s.entity.id)![0] !== (s.observation.placement?.parentId ?? targetId))
      .map((s) => ({ entity: s.entity, fromChain: priorChains.get(s.entity.id)! })),
  };

  return { targetId, savedItems: saved, absences, diff };
}

function normalizeLabel(s: string): string {
  return s.trim().toLowerCase();
}

export const captureTimestamp = (): ISODate => nowIso();
