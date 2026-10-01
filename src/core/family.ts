import { computeBelief } from './beliefs';
import type { MemoryGraph } from './graph';
import type { Entity, ID, Observation } from './types';

/**
 * Family sharing rules (client side; the database enforces the same boundaries with RLS).
 *
 * A SPACE is shared by setting `householdId` on it. Everything whose location resolves inside
 * that space is shared — except sensitive objects and anything inside a private zone, which
 * never leave the owner's account.
 */

export function spaceOf(graph: MemoryGraph, entity: Entity): Entity | undefined {
  if (entity.kind === 'space') return entity;
  const chain =
    entity.kind === 'item'
      ? (computeBelief(graph, entity.id).primary?.currentChain ?? graph.chainFrom(graph.structuralPlacement(entity.id)?.parentId))
      : graph.chainFrom(graph.structuralPlacement(entity.id)?.parentId);
  return chain.map((id) => graph.entity(id)).find((e) => e?.kind === 'space');
}

function chainOf(graph: MemoryGraph, entity: Entity): ID[] {
  if (entity.kind === 'space') return [];
  return entity.kind === 'item'
    ? (computeBelief(graph, entity.id).primary?.currentChain ?? [])
    : graph.chainFrom(graph.structuralPlacement(entity.id)?.parentId);
}

/** The household an entity is shared with, or null if it stays private. */
export function householdForEntity(graph: MemoryGraph, entity: Entity): ID | null {
  if (entity.sensitive || entity.privateZone) return null;
  if (entity.kind === 'space') return entity.householdId ?? null;
  const chain = chainOf(graph, entity);
  if (chain.some((id) => graph.entity(id)?.privateZone)) return null;
  const space = chain.map((id) => graph.entity(id)).find((e) => e?.kind === 'space');
  return space?.householdId ?? null;
}

export function householdForObservation(graph: MemoryGraph, o: Observation): ID | null {
  const subject = graph.entity(o.subjectId);
  return subject ? householdForEntity(graph, subject) : null;
}

/** Everything that would become visible to the family if `spaceId` were shared. */
export function sharedFootprint(graph: MemoryGraph, spaceId: ID): { entities: Entity[]; hidden: number } {
  const inside = graph.entities((e) => e.id !== spaceId && spaceOf(graph, e)?.id === spaceId);
  const shared = inside.filter((e) => !e.sensitive && !e.privateZone && !chainOf(graph, e).some((id) => graph.entity(id)?.privateZone));
  return { entities: shared, hidden: inside.length - shared.length };
}

/** Who recorded an observation, for "added by Dad". */
export function recordedBy(o: Observation | undefined, members: Map<string, string>, myUserId: string | null): string | null {
  if (!o?.createdBy || o.createdBy === myUserId) return null;
  return members.get(o.createdBy) ?? 'a family member';
}

export interface ShareReport {
  shared: number;
  sensitive: number;
  privateZone: number;
  noLocation: number;
  otherSpace: number;
  details: { name: string; reason: string }[];
}

/** Why each of this user's items is (not) shared with `householdId` — shown after a family sync. */
export function shareReport(graph: MemoryGraph, householdId: ID): ShareReport {
  const r: ShareReport = { shared: 0, sensitive: 0, privateZone: 0, noLocation: 0, otherSpace: 0, details: [] };
  for (const e of graph.items().filter((x) => !x.createdBy)) {
    if (householdForEntity(graph, e) === householdId) {
      r.shared++;
      continue;
    }
    let reason: string;
    if (e.sensitive) {
      r.sensitive++;
      reason = 'sensitive';
    } else {
      const chain = chainOf(graph, e);
      if (!chain.length) {
        r.noLocation++;
        reason = 'no location';
      } else if (chain.some((id) => graph.entity(id)?.privateZone)) {
        r.privateZone++;
        reason = 'private zone';
      } else {
        r.otherSpace++;
        const space = chain.map((id) => graph.entity(id)).find((x) => x?.kind === 'space');
        reason = space ? `in "${space.name}" (not shared)` : `chain ends at "${graph.entity(chain[chain.length - 1])?.name ?? '?'}" (no space)`;
      }
    }
    r.details.push({ name: e.name, reason });
  }
  return r;
}
