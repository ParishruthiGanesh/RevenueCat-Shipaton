import { computeBelief } from './beliefs';
import type { MemoryGraph, Mutation } from './graph';
import { newId, nowIso } from './ids';
import { LOCAL_EMBEDDING_MODEL, localEmbed, normalize } from './text';
import type {
  BoundingBox,
  Correction,
  Entity,
  EntityKind,
  EvidenceKind,
  ID,
  ISODate,
  Loan,
  Observation,
  ObservationSource,
  Person,
  PersonRelationship,
  PlacementRelation,
  SpaceType,
  Trip,
  TripItemState,
  VisualAttributes,
} from './types';

/**
 * DOMAIN OPERATIONS — the only way state changes.
 *
 * Observations are append-only. Corrections never overwrite the AI's prediction; they add a
 * verified observation and a Correction record (valuable learning signal). The only hard
 * deletes are the privacy controls the user explicitly invokes.
 */

export const emptyAttributes = (): VisualAttributes => ({ colors: [], distinguishingMarks: [] });

export interface NewEntityInput {
  kind: EntityKind;
  name: string;
  category?: string;
  description?: string;
  attributes?: Partial<VisualAttributes>;
  aliases?: string[];
  isContainer?: boolean;
  spaceType?: SpaceType;
  ownerId?: ID;
  sensitive?: boolean;
  privateZone?: boolean;
  coverMediaId?: ID;
}

export function buildEntity(input: NewEntityInput): Entity {
  const t = nowIso();
  return {
    id: newId(),
    kind: input.kind,
    name: input.name.trim(),
    category: input.category,
    description: input.description,
    attributes: { ...emptyAttributes(), ...input.attributes },
    aliases: input.aliases ?? [],
    isContainer: input.isContainer ?? input.kind !== 'item',
    spaceType: input.spaceType,
    ownerId: input.ownerId,
    sensitive: input.sensitive ?? false,
    privateZone: input.privateZone ?? false,
    coverMediaId: input.coverMediaId,
    createdAt: t,
    updatedAt: t,
  };
}

function textEmbeddingMutation(e: Entity): Mutation {
  return {
    op: 'upsert',
    table: 'embeddings',
    row: {
      entityId: e.id,
      model: LOCAL_EMBEDDING_MODEL,
      modality: 'text',
      vector: localEmbed([e.name, ...e.aliases, e.category ?? '', e.description ?? '', ...e.attributes.colors, e.attributes.brand ?? ''].join(' ')),
      updatedAt: nowIso(),
    },
  };
}

export function createEntity(graph: MemoryGraph, input: NewEntityInput, placement?: { parentId: ID; relation?: PlacementRelation; source?: ObservationSource }): Entity {
  const e = buildEntity(input);
  const muts: Mutation[] = [{ op: 'upsert', table: 'entities', row: e }, textEmbeddingMutation(e)];
  graph.commit(muts);
  if (placement) {
    recordSighting(graph, {
      subjectId: e.id,
      parentId: placement.parentId,
      relation: placement.relation ?? (e.kind === 'room' || e.kind === 'fixture' ? 'LOCATED_IN' : 'INSIDE'),
      source: placement.source ?? 'setup',
      evidence: 'user_stated',
    });
  }
  return e;
}

export function updateEntity(graph: MemoryGraph, id: ID, patch: Partial<Omit<Entity, 'id' | 'createdAt'>>): Entity | undefined {
  const cur = graph.entity(id);
  if (!cur) return undefined;
  const next: Entity = { ...cur, ...patch, attributes: { ...cur.attributes, ...(patch.attributes ?? {}) }, updatedAt: nowIso() };
  graph.commit([{ op: 'upsert', table: 'entities', row: next }, textEmbeddingMutation(next)]);
  return next;
}

/** Find a structural child by (normalised) name under a parent, or create it. Lets the environment be discovered gradually. */
export function ensurePlace(graph: MemoryGraph, parentId: ID, name: string, kind: Exclude<EntityKind, 'space' | 'item'>, extra: Partial<NewEntityInput> = {}): Entity {
  const n = normalize(name);
  const existing = graph.structuralChildren(parentId).find((c) => normalize(c.name) === n || c.aliases.some((a) => normalize(a) === n));
  if (existing) return existing;
  return createEntity(graph, { kind, name, isContainer: true, ...extra }, { parentId, relation: kind === 'container' ? 'INSIDE' : 'LOCATED_IN' });
}

export interface SightingInput {
  subjectId: ID;
  parentId: ID;
  relation?: PlacementRelation;
  source: ObservationSource;
  evidence?: EvidenceKind;
  observedAt?: ISODate;
  detectionConfidence?: number;
  matchConfidence?: number;
  mediaId?: ID;
  bbox?: BoundingBox;
  captureId?: ID;
  detectedLabel?: string;
  verifiedLabel?: string;
  verification?: Observation['verification'];
  deviceId?: string;
  note?: string;
}

export function buildSighting(graph: MemoryGraph, s: SightingInput): Observation {
  const observedAt = s.observedAt ?? nowIso();
  return {
    id: newId(),
    subjectId: s.subjectId,
    type: 'sighting',
    observedAt,
    recordedAt: nowIso(),
    source: s.source,
    evidence: s.evidence ?? 'observed',
    placement: { parentId: s.parentId, relation: s.relation ?? 'INSIDE' },
    chainSnapshot: graph.chainFrom(s.parentId, observedAt),
    captureId: s.captureId,
    mediaId: s.mediaId,
    bbox: s.bbox,
    detectionConfidence: s.detectionConfidence ?? 1,
    matchConfidence: s.matchConfidence ?? 1,
    detectedLabel: s.detectedLabel,
    verifiedLabel: s.verifiedLabel,
    verification: s.verification ?? 'unverified',
    retracted: false,
    deviceId: s.deviceId,
    note: s.note,
  };
}

export function recordSighting(graph: MemoryGraph, s: SightingInput): Observation {
  const o = buildSighting(graph, s);
  graph.commit([{ op: 'upsert', table: 'observations', row: o }]);
  return o;
}

/** "That's no longer there." Records an explicit removal against the last believed place. */
export function markNoLongerThere(graph: MemoryGraph, entityId: ID, at: ISODate = nowIso()): Observation {
  const belief = computeBelief(graph, entityId, new Date(at));
  const parent = belief.primary?.observation.placement ?? null;
  const o: Observation = {
    id: newId(),
    subjectId: entityId,
    type: 'removal',
    observedAt: at,
    recordedAt: nowIso(),
    source: 'manual',
    evidence: 'user_stated',
    placement: parent,
    chainSnapshot: parent ? graph.chainFrom(parent.parentId, at) : [],
    detectionConfidence: 1,
    matchConfidence: 1,
    verification: 'confirmed',
    retracted: false,
  };
  graph.commit([{ op: 'upsert', table: 'observations', row: o }]);
  return o;
}

/** A scan of `containerId` did not detect `entityId`. Lowers confidence; never deletes. */
export function buildAbsence(graph: MemoryGraph, entityId: ID, containerId: ID, captureId: ID | undefined, at: ISODate): Observation {
  return {
    id: newId(),
    subjectId: entityId,
    type: 'absence',
    observedAt: at,
    recordedAt: nowIso(),
    source: 'area_scan',
    evidence: 'observed',
    placement: { parentId: containerId, relation: 'INSIDE' },
    chainSnapshot: graph.chainFrom(containerId, at),
    captureId,
    detectionConfidence: 1,
    matchConfidence: 1,
    verification: 'unverified',
    retracted: false,
  };
}

// ───────────────────────────── corrections & identity ─────────────────────────────

export function buildCorrection(c: Omit<Correction, 'id' | 'createdAt'>): Correction {
  return { ...c, id: newId(), createdAt: nowIso() };
}

/** "Actually → External SSD". Renames, keeps the old label as an alias, records the correction. */
export function correctLabel(graph: MemoryGraph, entityId: ID, newName: string, observationId?: ID): Entity | undefined {
  const e = graph.entity(entityId);
  if (!e || !newName.trim() || newName.trim() === e.name) return e;
  const muts: Mutation[] = [
    { op: 'upsert', table: 'corrections', row: buildCorrection({ entityId, observationId, field: 'label', aiValue: e.name, userValue: newName.trim() }) },
  ];
  if (observationId) {
    const o = graph.observation(observationId);
    if (o) muts.push({ op: 'upsert', table: 'observations', row: { ...o, verifiedLabel: newName.trim(), verification: 'corrected' } });
  }
  graph.commit(muts);
  // The mislabel is NOT kept as an alias: a wrong label would pollute search.
  return updateEntity(graph, entityId, { name: newName.trim() });
}

/** "Call this my travel adapter." Adds a nickname without losing the canonical name. */
export function addAlias(graph: MemoryGraph, entityId: ID, alias: string): Entity | undefined {
  const e = graph.entity(entityId);
  if (!e) return undefined;
  const a = alias.trim();
  if (!a || e.aliases.some((x) => normalize(x) === normalize(a))) return e;
  return updateEntity(graph, entityId, { aliases: [...e.aliases, a] });
}

export function confirmObservation(graph: MemoryGraph, observationId: ID): void {
  const o = graph.observation(observationId);
  if (o) graph.commit([{ op: 'upsert', table: 'observations', row: { ...o, verification: 'confirmed' } }]);
}

/** The user says a sighting was wrong. It is retracted (kept for audit, ignored by reasoning). */
export function rejectObservation(graph: MemoryGraph, observationId: ID): void {
  const o = graph.observation(observationId);
  if (!o) return;
  graph.commit([
    { op: 'upsert', table: 'observations', row: { ...o, verification: 'rejected', retracted: true } },
    { op: 'upsert', table: 'corrections', row: buildCorrection({ entityId: o.subjectId, observationId, field: 'identity', aiValue: o.detectedLabel ?? '', userValue: 'rejected' }) },
  ]);
}

/** User confirmed two records are the same physical object. */
export function mergeEntities(graph: MemoryGraph, keepId: ID, dropId: ID): Entity | undefined {
  const keep = graph.entity(keepId);
  const drop = graph.entity(dropId);
  if (!keep || !drop || keepId === dropId) return keep;
  const muts: Mutation[] = graph.observationsOf(dropId, true).map((o) => ({ op: 'upsert', table: 'observations', row: { ...o, subjectId: keepId } }) as Mutation);
  for (const l of graph.loans().filter((l) => l.itemId === dropId)) muts.push({ op: 'upsert', table: 'loans', row: { ...l, itemId: keepId } });
  muts.push({ op: 'upsert', table: 'corrections', row: buildCorrection({ entityId: keepId, field: 'identity', aiValue: `separate:${dropId}`, userValue: `merged:${keepId}` }) });
  muts.push({ op: 'upsert', table: 'entities', row: { ...drop, archivedAt: nowIso() } });
  graph.commit(muts);
  const aliases = [...new Set([...keep.aliases, drop.name, ...drop.aliases])].filter((a) => normalize(a) !== normalize(keep.name));
  return updateEntity(graph, keepId, { aliases, coverMediaId: keep.coverMediaId ?? drop.coverMediaId });
}

/** User said "No, these are different objects." Remembered so we never ask again. */
export function markNotSame(graph: MemoryGraph, aId: ID, bId: ID): void {
  graph.commit([
    { op: 'upsert', table: 'relations', row: { id: newId(), fromId: aId, toId: bId, type: 'NOT_SAME_AS', validFrom: nowIso(), source: 'manual', confidence: 1 } },
  ]);
}

// ───────────────────────────── ownership & loans ─────────────────────────────

export function ensurePerson(graph: MemoryGraph, name: string, relationship: PersonRelationship = 'other'): Person {
  const n = normalize(name);
  const existing = graph.people().find((p) => normalize(p.name) === n);
  if (existing) return existing;
  const p: Person = { id: newId(), name: name.trim(), relationship, createdAt: nowIso() };
  graph.commit([{ op: 'upsert', table: 'people', row: p }]);
  return p;
}

export function selfPerson(graph: MemoryGraph): Person {
  return graph.people().find((p) => p.relationship === 'self') ?? ensurePerson(graph, 'Me', 'self');
}

export function lendItem(graph: MemoryGraph, itemId: ID, personName: string, opts: { at?: ISODate; expectedReturnAt?: ISODate; note?: string } = {}): Loan {
  const person = ensurePerson(graph, personName, 'friend');
  const at = opts.at ?? nowIso();
  const loan: Loan = { id: newId(), itemId, personId: person.id, lentAt: at, expectedReturnAt: opts.expectedReturnAt, note: opts.note };
  graph.commit([
    { op: 'upsert', table: 'loans', row: loan },
    { op: 'upsert', table: 'relations', row: { id: newId(), fromId: itemId, toId: person.id, type: 'LENT_TO', validFrom: at, source: 'voice_statement', confidence: 1 } },
  ]);
  return loan;
}

export function returnLoan(graph: MemoryGraph, loanId: ID, putBack?: { parentId: ID; relation?: PlacementRelation }): void {
  const loan = graph.loans().find((l) => l.id === loanId);
  if (!loan) return;
  const at = nowIso();
  const muts: Mutation[] = [{ op: 'upsert', table: 'loans', row: { ...loan, returnedAt: at } }];
  for (const r of graph.relations((r) => r.type === 'LENT_TO' && r.fromId === loan.itemId && !r.validTo)) {
    muts.push({ op: 'upsert', table: 'relations', row: { ...r, validTo: at } });
  }
  graph.commit(muts);
  if (putBack) recordSighting(graph, { subjectId: loan.itemId, parentId: putBack.parentId, relation: putBack.relation, source: 'manual', evidence: 'user_stated' });
}

export function setOwner(graph: MemoryGraph, entityId: ID, personId: ID | undefined): void {
  const e = graph.entity(entityId);
  if (!e) return;
  const at = nowIso();
  const muts: Mutation[] = [];
  for (const r of graph.relations((r) => r.type === 'BELONGS_TO' && r.fromId === entityId && !r.validTo)) muts.push({ op: 'upsert', table: 'relations', row: { ...r, validTo: at } });
  if (personId) muts.push({ op: 'upsert', table: 'relations', row: { id: newId(), fromId: entityId, toId: personId, type: 'BELONGS_TO', validFrom: at, source: 'manual', confidence: 1 } });
  muts.push({ op: 'upsert', table: 'entities', row: { ...e, ownerId: personId, updatedAt: at } });
  graph.commit(muts);
}

// ───────────────────────────── storage boxes ─────────────────────────────

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function boxCode(): string {
  // Derive from a fresh UUID via FNV-1a + xorshift so any ID generator yields a valid code.
  const id = newId();
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  let out = '';
  for (let i = 0; i < 8; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    out += CODE_ALPHABET[h % CODE_ALPHABET.length];
  }
  return out;
}

export function nextBoxNumber(graph: MemoryGraph): number {
  return graph.entities((e) => !!e.box).reduce((m, e) => Math.max(m, e.box!.number), 0) + 1;
}

export function createStorageBox(graph: MemoryGraph, opts: { parentId: ID; category?: string; number?: number; name?: string }): Entity {
  const number = opts.number ?? nextBoxNumber(graph);
  const e = buildEntity({ kind: 'container', name: opts.name ?? `Box ${number}`, category: opts.category, isContainer: true, aliases: [`box ${number}`, `box #${number}`] });
  e.box = { number, code: boxCode(), category: opts.category };
  e.mobility = 'static';
  graph.commit([{ op: 'upsert', table: 'entities', row: e }, textEmbeddingMutation(e)]);
  recordSighting(graph, { subjectId: e.id, parentId: opts.parentId, relation: 'LOCATED_IN', source: 'box_scan', evidence: 'user_stated' });
  return e;
}

export function findBoxByCode(graph: MemoryGraph, code: string): Entity | undefined {
  const c = code.replace(/^pm:\/\/box\//i, '').toUpperCase();
  return graph.entities((e) => e.box?.code === c)[0];
}

/** Box 17: apartment bedroom → storage unit, rack 4. Contents follow automatically via the chain. */
export function moveEntity(graph: MemoryGraph, entityId: ID, parentId: ID, source: ObservationSource = 'manual', relation?: PlacementRelation): Observation {
  const e = graph.entity(entityId);
  return recordSighting(graph, {
    subjectId: entityId,
    parentId,
    relation: relation ?? (e?.kind === 'item' ? 'INSIDE' : 'LOCATED_IN'),
    source,
    evidence: source === 'qr_scan' ? 'observed' : 'user_stated',
  });
}

// ───────────────────────────── trips ─────────────────────────────

export function createTrip(graph: MemoryGraph, name: string, itemIds: ID[], bagIds: ID[], departsAt?: ISODate): Trip {
  const trip: Trip = { id: newId(), name, bagIds, departsAt, createdAt: nowIso() };
  const muts: Mutation[] = [{ op: 'upsert', table: 'trips', row: trip }];
  for (const itemId of itemIds) muts.push({ op: 'upsert', table: 'tripItems', row: { tripId: trip.id, itemId, state: 'not_packed', updatedAt: nowIso() } });
  graph.commit(muts);
  return trip;
}

export function setTripItemState(graph: MemoryGraph, tripId: ID, itemId: ID, state: TripItemState): void {
  graph.commit([{ op: 'upsert', table: 'tripItems', row: { tripId, itemId, state, updatedAt: nowIso() } }]);
}

// ───────────────────────────── privacy: hard deletes ─────────────────────────────

/** Permanently deletes one observation (user privacy control). Returns media ids that may now be orphaned. */
export function deleteObservation(graph: MemoryGraph, observationId: ID): ID[] {
  const o = graph.observation(observationId);
  if (!o) return [];
  graph.commit([{ op: 'delete', table: 'observations', key: observationId }]);
  return o.mediaId ? orphanedMedia(graph, [o.mediaId]) : [];
}

/** Permanently deletes an entity and everything recorded about it. Children are left unplaced, not deleted. */
export function deleteEntity(graph: MemoryGraph, entityId: ID): ID[] {
  const e = graph.entity(entityId);
  if (!e) return [];
  const obs = graph.observationsOf(entityId, true);
  const mediaIds = [...obs.map((o) => o.mediaId), e.coverMediaId].filter((x): x is ID => !!x);
  const muts: Mutation[] = [
    { op: 'delete', table: 'entities', key: entityId },
    ...obs.map((o) => ({ op: 'delete', table: 'observations', key: o.id }) as Mutation),
    ...graph.embeddingsOf(entityId).map((x) => ({ op: 'delete', table: 'embeddings', key: `${x.entityId}:${x.model}:${x.modality}` }) as Mutation),
    ...graph.loans().filter((l) => l.itemId === entityId).map((l) => ({ op: 'delete', table: 'loans', key: l.id }) as Mutation),
    ...graph.relations((r) => r.fromId === entityId || r.toId === entityId).map((r) => ({ op: 'delete', table: 'relations', key: r.id }) as Mutation),
    ...graph.corrections().filter((c) => c.entityId === entityId).map((c) => ({ op: 'delete', table: 'corrections', key: c.id }) as Mutation),
  ];
  graph.commit(muts);
  return orphanedMedia(graph, mediaIds);
}

function orphanedMedia(graph: MemoryGraph, candidates: ID[]): ID[] {
  const used = new Set<ID>();
  for (const o of graph.allObservations()) if (o.mediaId) used.add(o.mediaId);
  for (const e of graph.entities()) if (e.coverMediaId) used.add(e.coverMediaId);
  const out = candidates.filter((m) => !used.has(m));
  if (out.length) graph.commit(out.map((key) => ({ op: 'delete', table: 'media', key }) as Mutation));
  return out;
}
