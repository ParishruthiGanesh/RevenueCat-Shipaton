import type { TableName } from '@/core/graph';
import type { Correction, Entity, Loan, MediaAsset, Observation, Person, Relation, Trip, TripItem } from '@/core/types';

/**
 * Pure mapping between the on-device model (camelCase JSON) and Postgres rows (snake_case).
 * Kept dependency-free so it is unit-tested; the sync engine uses it in both directions.
 */

export const REMOTE_TABLE: Partial<Record<TableName, string>> = {
  entities: 'entities',
  observations: 'observations',
  relations: 'relations',
  people: 'people',
  loans: 'loans',
  trips: 'trips',
  tripItems: 'trip_items',
  corrections: 'corrections',
  media: 'media_assets',
};

/** Dependency order for pushing (parents before children). */
export const PUSH_ORDER: TableName[] = ['people', 'media', 'entities', 'observations', 'relations', 'loans', 'trips', 'tripItems', 'corrections'];

type Row = Record<string, unknown>;

/** Resolves which household (if any) a row belongs to, for family sharing. */
export type HouseholdResolver = (table: TableName, row: unknown) => string | null;

export function toRemote(table: TableName, r: unknown, userId: string, household: HouseholdResolver = () => null): Row | null {
  switch (table) {
    case 'entities': {
      const e = r as Entity;
      return {
        id: e.id,
        user_id: userId,
        kind: e.kind,
        name: e.name,
        category: e.category ?? null,
        description: e.description ?? null,
        attributes: e.attributes,
        aliases: e.aliases,
        is_container: e.isContainer,
        space_type: e.spaceType ?? null,
        owner_person_id: e.ownerId ?? null,
        sensitive: e.sensitive,
        private_zone: e.privateZone,
        mobility: e.mobility ?? null,
        box_number: e.box?.number ?? null,
        box_code: e.box?.code ?? null,
        box_category: e.box?.category ?? null,
        box_sealed_at: e.box?.sealedAt ?? null,
        cover_media_id: e.coverMediaId ?? null,
        household_id: household(table, e),
        created_at: e.createdAt,
        updated_at: e.updatedAt,
        archived_at: e.archivedAt ?? null,
      };
    }
    case 'observations': {
      const o = r as Observation;
      return {
        id: o.id,
        user_id: userId,
        subject_id: o.subjectId,
        type: o.type,
        observed_at: o.observedAt,
        recorded_at: o.recordedAt,
        source: o.source,
        evidence: o.evidence,
        parent_id: o.placement?.parentId ?? null,
        relation: o.placement?.relation ?? null,
        chain_snapshot: o.chainSnapshot,
        capture_id: null,
        media_id: o.mediaId ?? null,
        bbox: o.bbox ?? null,
        detection_confidence: o.detectionConfidence,
        match_confidence: o.matchConfidence,
        detected_label: o.detectedLabel ?? null,
        verified_label: o.verifiedLabel ?? null,
        verification: o.verification,
        retracted: o.retracted,
        device_id: o.deviceId ?? null,
        note: o.note ?? null,
        household_id: household(table, o),
      };
    }
    case 'relations': {
      const x = r as Relation;
      return { id: x.id, user_id: userId, from_id: x.fromId, type: x.type, to_id: x.toId, valid_from: x.validFrom, valid_to: x.validTo ?? null, source: x.source, confidence: x.confidence };
    }
    case 'people': {
      const p = r as Person;
      return { id: p.id, user_id: userId, name: p.name, relationship: p.relationship, created_at: p.createdAt };
    }
    case 'loans': {
      const l = r as Loan;
      return { id: l.id, user_id: userId, item_id: l.itemId, person_id: l.personId, lent_at: l.lentAt, expected_return_at: l.expectedReturnAt ?? null, returned_at: l.returnedAt ?? null, note: l.note ?? null };
    }
    case 'trips': {
      const t = r as Trip;
      return { id: t.id, user_id: userId, name: t.name, departs_at: t.departsAt ?? null, returns_at: t.returnsAt ?? null, bag_ids: t.bagIds, created_at: t.createdAt, closed_at: t.closedAt ?? null };
    }
    case 'tripItems': {
      const t = r as TripItem;
      return { trip_id: t.tripId, item_id: t.itemId, user_id: userId, state: t.state, updated_at: t.updatedAt };
    }
    case 'corrections': {
      const c = r as Correction;
      return { id: c.id, user_id: userId, entity_id: c.entityId ?? null, observation_id: c.observationId ?? null, field: c.field, ai_value: c.aiValue, user_value: c.userValue, created_at: c.createdAt };
    }
    case 'media': {
      const m = r as MediaAsset;
      return {
        id: m.id,
        user_id: userId,
        storage_path: m.remotePath ?? null,
        width: m.width,
        height: m.height,
        kind: m.kind,
        parent_media_id: m.parentMediaId ?? null,
        contains_people: m.containsPeople,
        created_at: m.createdAt,
      };
    }
    default:
      return null;
  }
}

const u = <T>(v: unknown): T | undefined => (v === null || v === undefined ? undefined : (v as T));

/** `myUserId` marks rows created by someone else (family members) with `createdBy`. */
export function fromRemote(table: TableName, r: Row, myUserId?: string): unknown {
  const by = myUserId && r.user_id && r.user_id !== myUserId ? (r.user_id as string) : undefined;
  switch (table) {
    case 'entities':
      return {
        id: r.id,
        kind: r.kind,
        name: r.name,
        category: u(r.category),
        description: u(r.description),
        attributes: r.attributes,
        aliases: r.aliases ?? [],
        isContainer: r.is_container,
        spaceType: u(r.space_type),
        ownerId: u(r.owner_person_id),
        sensitive: r.sensitive,
        privateZone: r.private_zone,
        mobility: u(r.mobility),
        box: r.box_code ? { number: r.box_number, code: r.box_code, category: u(r.box_category), sealedAt: u(r.box_sealed_at) } : undefined,
        coverMediaId: u(r.cover_media_id),
        householdId: r.kind === 'space' ? u(r.household_id) : undefined,
        createdBy: by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        archivedAt: u(r.archived_at),
      } satisfies Record<keyof Entity, unknown>;
    case 'observations':
      return {
        id: r.id,
        subjectId: r.subject_id,
        type: r.type,
        observedAt: r.observed_at,
        recordedAt: r.recorded_at,
        source: r.source,
        evidence: r.evidence,
        placement: r.parent_id ? { parentId: r.parent_id, relation: r.relation } : null,
        chainSnapshot: r.chain_snapshot ?? [],
        captureId: u(r.capture_id),
        mediaId: u(r.media_id),
        bbox: u(r.bbox),
        detectionConfidence: r.detection_confidence,
        matchConfidence: r.match_confidence,
        detectedLabel: u(r.detected_label),
        verifiedLabel: u(r.verified_label),
        verification: r.verification,
        retracted: r.retracted,
        deviceId: u(r.device_id),
        note: u(r.note),
        createdBy: by,
      } satisfies Record<keyof Observation, unknown>;
    case 'relations':
      return { id: r.id, fromId: r.from_id, type: r.type, toId: r.to_id, validFrom: r.valid_from, validTo: u(r.valid_to), source: r.source, confidence: r.confidence };
    case 'people':
      return { id: r.id, name: r.name, relationship: r.relationship, createdAt: r.created_at };
    case 'loans':
      return { id: r.id, itemId: r.item_id, personId: r.person_id, lentAt: r.lent_at, expectedReturnAt: u(r.expected_return_at), returnedAt: u(r.returned_at), note: u(r.note) };
    case 'trips':
      return { id: r.id, name: r.name, departsAt: u(r.departs_at), returnsAt: u(r.returns_at), bagIds: r.bag_ids ?? [], createdAt: r.created_at, closedAt: u(r.closed_at) };
    case 'tripItems':
      return { tripId: r.trip_id, itemId: r.item_id, state: r.state, updatedAt: r.updated_at };
    case 'corrections':
      return { id: r.id, entityId: u(r.entity_id), observationId: u(r.observation_id), field: r.field, aiValue: r.ai_value, userValue: r.user_value, createdAt: r.created_at };
    case 'media':
      return { id: r.id, localUri: '', remotePath: u(r.storage_path), width: r.width, height: r.height, kind: r.kind, parentMediaId: u(r.parent_media_id), containsPeople: r.contains_people, createdAt: r.created_at };
    default:
      return null;
  }
}

export function remoteKey(table: TableName, key: string): Row {
  if (table === 'tripItems') {
    const [trip_id, item_id] = key.split(':');
    return { trip_id, item_id };
  }
  return { id: key };
}
