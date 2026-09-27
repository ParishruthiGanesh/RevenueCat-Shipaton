import { computeBelief } from './beliefs';
import type { MemoryGraph } from './graph';
import { formatAgo } from './phrasing';
import { activeLoans } from './queries';
import type { ID, Trip, TripItemState } from './types';

/**
 * Event-driven, genuinely useful nudges. These feed both the in-app "Needs attention"
 * section and push notifications (local, or OneSignal when configured).
 * Rule of thumb: only notify when the user would thank us for it.
 */

export type InsightKind = 'loan_overdue' | 'box_unplaced' | 'trip_unconfirmed' | 'scan_missing' | 'duplicate_candidate';

export interface Insight {
  id: string;
  kind: InsightKind;
  title: string;
  body: string;
  entityId?: ID;
  /** Push-worthy vs. in-app only. */
  push: boolean;
  createdAt: string;
}

export function computeInsights(graph: MemoryGraph, at: Date = new Date()): Insight[] {
  const out: Insight[] = [];
  const atIso = at.toISOString();

  for (const loan of activeLoans(graph)) {
    const days = (at.getTime() - new Date(loan.lentAt).getTime()) / 86400e3;
    const overdue = loan.expectedReturnAt ? loan.expectedReturnAt < atIso : days >= 21;
    if (!overdue) continue;
    const item = graph.entity(loan.itemId);
    const who = graph.person(loan.personId)?.name ?? 'someone';
    if (!item) continue;
    out.push({
      id: `loan:${loan.id}`,
      kind: 'loan_overdue',
      title: `Still with ${who}: ${item.name}`,
      body: `You lent it ${formatAgo(loan.lentAt, at)}.`,
      entityId: item.id,
      push: true,
      createdAt: atIso,
    });
  }

  for (const box of graph.entities((e) => !!e.box)) {
    const chain = graph.chainFrom(graph.structuralPlacement(box.id)?.parentId);
    const { room } = graph.spaceAndRoom(chain);
    if (!room) {
      out.push({ id: `box:${box.id}`, kind: 'box_unplaced', title: `${box.name} has no room yet`, body: 'Scan its label where it ends up so its contents stay findable.', entityId: box.id, push: false, createdAt: atIso });
    }
  }

  for (const item of graph.items()) {
    const b = computeBelief(graph, item.id, at);
    if (b.flags.includes('not_detected_in_latest_scan') && b.absence && at.getTime() - new Date(b.absence.observedAt).getTime() < 3 * 86400e3) {
      const place = graph.entity(b.absence.placement?.parentId)?.name ?? 'a scan';
      out.push({ id: `absent:${item.id}:${b.absence.id}`, kind: 'scan_missing', title: `${item.name} wasn't detected in ${place}`, body: 'Its last confirmed sighting is still on record.', entityId: item.id, push: false, createdAt: atIso });
    }
  }

  for (const trip of graph.trips().filter((t) => !t.closedAt)) {
    for (const s of tripStatus(graph, trip, at)) {
      if (s.state === 'needs_confirmation' && trip.departsAt && new Date(trip.departsAt).getTime() - at.getTime() < 36 * 3600e3) {
        const item = graph.entity(s.itemId);
        if (item) out.push({ id: `trip:${trip.id}:${item.id}`, kind: 'trip_unconfirmed', title: `${item.name} isn't confirmed in your bag`, body: `You marked it packed for ${trip.name}, but it hasn't been seen in the bag.`, entityId: item.id, push: true, createdAt: atIso });
      }
    }
  }
  return out;
}

export interface TripItemStatus {
  itemId: ID;
  state: TripItemState;
  /** True when the camera actually saw it inside one of the trip bags. */
  observedInBag: boolean;
}

/**
 * Packing state combines what the user ticked with what was OBSERVED:
 * ticking "packed" without a sighting inside the bag yields needs_confirmation.
 */
export function tripStatus(graph: MemoryGraph, trip: Trip, at: Date = new Date()): TripItemStatus[] {
  return graph.tripItems(trip.id).map((ti) => {
    const b = computeBelief(graph, ti.itemId, at);
    const observedInBag = !!b.primary && trip.bagIds.some((bag) => b.primary!.currentChain.includes(bag)) && b.primary.observation.observedAt >= trip.createdAt;
    let state = ti.state;
    if (observedInBag && (state === 'not_packed' || state === 'needs_confirmation')) state = 'packed';
    if (state === 'packed' && !observedInBag && ti.updatedAt > (b.primary?.observation.observedAt ?? '')) state = 'needs_confirmation';
    return { itemId: ti.itemId, state, observedInBag };
  });
}
