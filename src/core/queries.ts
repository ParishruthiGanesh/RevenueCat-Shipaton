import { computeBelief, type LocationBelief } from './beliefs';
import type { MemoryGraph } from './graph';
import type { Entity, ID, ISODate, Loan, Observation } from './types';

/**
 * Higher-level questions over the temporal graph. Everything here distinguishes the
 * CURRENT BELIEVED LOCATION from OBSERVATION HISTORY.
 */

export interface ContentEntry {
  entity: Entity;
  belief: LocationBelief;
  /** Direct child of the queried place, or nested deeper (e.g. inside a pouch in the drawer). */
  depth: number;
}

/** Items believed (at any non-zero confidence) to be inside `placeId`, optionally recursively. */
export function contentsOf(graph: MemoryGraph, placeId: ID, opts: { recursive?: boolean; at?: Date } = {}): ContentEntry[] {
  const at = opts.at ?? new Date();
  const out: ContentEntry[] = [];
  for (const item of graph.items()) {
    const b = computeBelief(graph, item.id, at);
    if (!b.primary || b.status === 'lent' || b.status === 'removed') continue;
    const chain = b.primary.currentChain;
    const idx = chain.indexOf(placeId);
    if (idx === 0 || (opts.recursive && idx > 0)) out.push({ entity: item, belief: b, depth: idx });
  }
  return out.sort((a, b) => a.depth - b.depth || b.belief.score - a.belief.score);
}

/** Count of believed items per place, for the Memory Map. */
export function itemCounts(graph: MemoryGraph, at: Date = new Date()): Map<ID, number> {
  const counts = new Map<ID, number>();
  for (const item of graph.items()) {
    const b = computeBelief(graph, item.id, at);
    if (!b.primary || b.status !== 'located') continue;
    for (const id of b.primary.currentChain) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export interface HistoryEntry {
  observation: Observation;
  chain: ID[];
  /** True when this sighting is at a different place than the previous one. */
  moved: boolean;
}

/** Full observation timeline for an object, oldest first (uses the chain as recorded at the time). */
export function historyOf(graph: MemoryGraph, itemId: ID): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  let prevParent: ID | undefined;
  for (const o of graph.observationsOf(itemId)) {
    const parent = o.placement?.parentId;
    out.push({ observation: o, chain: o.chainSnapshot, moved: o.type === 'sighting' && !!prevParent && parent !== prevParent });
    if (o.type === 'sighting') prevParent = parent;
  }
  return out;
}

export interface UsualLocation {
  placeId: ID;
  chain: ID[];
  /** Share of observed dwell time spent there, 0..1. */
  share: number;
  sightings: number;
}

/**
 * "Where do I usually keep my passport?" — weighted by dwell time between sightings,
 * so one quick trip to a backpack doesn't outweigh months in a drawer.
 */
export function usualLocation(graph: MemoryGraph, itemId: ID, at: Date = new Date()): UsualLocation | undefined {
  const s = graph.observationsOf(itemId).filter((o) => o.type === 'sighting' && o.placement && o.verification !== 'rejected');
  if (s.length === 0) return undefined;
  const dwell = new Map<ID, { ms: number; n: number; chain: ID[] }>();
  for (let i = 0; i < s.length; i++) {
    const start = new Date(s[i].observedAt).getTime();
    const end = i + 1 < s.length ? new Date(s[i + 1].observedAt).getTime() : at.getTime();
    // Cap a single dwell at 90 days so ancient sightings don't dominate.
    const ms = Math.min(Math.max(end - start, 60e3), 90 * 86400e3);
    const k = s[i].placement!.parentId;
    const cur = dwell.get(k) ?? { ms: 0, n: 0, chain: s[i].chainSnapshot };
    dwell.set(k, { ms: cur.ms + ms, n: cur.n + 1, chain: s[i].chainSnapshot });
  }
  const total = [...dwell.values()].reduce((a, b) => a + b.ms, 0);
  const [placeId, best] = [...dwell.entries()].sort((a, b) => b[1].ms - a[1].ms)[0];
  return { placeId, chain: best.chain, share: best.ms / total, sightings: best.n };
}

/** "Was my passport ever in my backpack?" */
export function wasEverIn(graph: MemoryGraph, itemId: ID, placeId: ID): Observation[] {
  return graph.observationsOf(itemId).filter((o) => o.type === 'sighting' && o.chainSnapshot.includes(placeId));
}

/** "Where was it before this?" */
export function previousLocation(graph: MemoryGraph, itemId: ID): Observation | undefined {
  const s = graph.observationsOf(itemId).filter((o) => o.type === 'sighting' && o.placement);
  const last = s[s.length - 1];
  if (!last) return undefined;
  for (let i = s.length - 2; i >= 0; i--) if (s[i].placement!.parentId !== last.placement!.parentId) return s[i];
  return undefined;
}

export function activeLoans(graph: MemoryGraph): Loan[] {
  return graph.loans().filter((l) => !l.returnedAt).sort((a, b) => a.lentAt.localeCompare(b.lentAt));
}

export function lastSeenAt(graph: MemoryGraph, itemId: ID): ISODate | undefined {
  const s = graph.observationsOf(itemId).filter((o) => o.type === 'sighting');
  return s[s.length - 1]?.observedAt;
}

/** "Which objects haven't been observed in more than a year?" */
export function notSeenSince(graph: MemoryGraph, days: number, at: Date = new Date()): { entity: Entity; lastSeen?: ISODate }[] {
  const cutoff = new Date(at.getTime() - days * 86400e3).toISOString();
  return graph
    .items()
    .map((e) => ({ entity: e, lastSeen: lastSeenAt(graph, e.id) }))
    .filter((x) => !x.lastSeen || x.lastSeen < cutoff)
    .sort((a, b) => (a.lastSeen ?? '').localeCompare(b.lastSeen ?? ''));
}

/** "What objects have uncertain locations?" */
export function uncertainItems(graph: MemoryGraph, at: Date = new Date()): LocationBelief[] {
  return graph
    .items()
    .map((e) => computeBelief(graph, e.id, at))
    .filter((b) => b.status !== 'lent' && (b.level === 'low' || b.level === 'unknown' || b.flags.includes('not_detected_in_latest_scan') || b.flags.includes('conflicting_observations')))
    .sort((a, b) => a.score - b.score);
}

export function recentlyRemembered(graph: MemoryGraph, limit = 12): Entity[] {
  return [...graph.items()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export interface MoveEvent {
  entity: Entity;
  from: Observation;
  to: Observation;
}

/** "What did I move yesterday?" — consecutive sightings at different places. */
export function movesBetween(graph: MemoryGraph, from: ISODate, to: ISODate): MoveEvent[] {
  const out: MoveEvent[] = [];
  for (const e of graph.entities((x) => x.kind === 'item' || !!x.box)) {
    const s = graph.observationsOf(e.id).filter((o) => o.type === 'sighting' && o.placement);
    for (let i = 1; i < s.length; i++) {
      if (s[i].observedAt < from || s[i].observedAt > to) continue;
      if (s[i].placement!.parentId !== s[i - 1].placement!.parentId) out.push({ entity: e, from: s[i - 1], to: s[i] });
    }
  }
  return out.sort((a, b) => b.to.observedAt.localeCompare(a.to.observedAt));
}

/** "What things are currently away from their usual locations?" */
export function awayFromUsual(graph: MemoryGraph, at: Date = new Date()): { entity: Entity; belief: LocationBelief; usual: UsualLocation }[] {
  const out: { entity: Entity; belief: LocationBelief; usual: UsualLocation }[] = [];
  for (const e of graph.items()) {
    const b = computeBelief(graph, e.id, at);
    const u = usualLocation(graph, e.id, at);
    if (!b.primary || !u || u.share < 0.5) continue;
    if (graph.observationsOf(e.id).filter((o) => o.type === 'sighting').length < 3) continue;
    if (b.primary.observation.placement!.parentId !== u.placeId) out.push({ entity: e, belief: b, usual: u });
  }
  return out;
}

/** "What are my most commonly misplaced objects?" — most distinct places + most moves. */
export function mostMoved(graph: MemoryGraph, limit = 5): { entity: Entity; moves: number; places: number }[] {
  return graph
    .items()
    .map((e) => {
      const s = graph.observationsOf(e.id).filter((o) => o.type === 'sighting' && o.placement);
      let moves = 0;
      for (let i = 1; i < s.length; i++) if (s[i].placement!.parentId !== s[i - 1].placement!.parentId) moves++;
      return { entity: e, moves, places: new Set(s.map((o) => o.placement!.parentId)).size };
    })
    .filter((x) => x.moves > 0)
    .sort((a, b) => b.moves - a.moves || b.places - a.places)
    .slice(0, limit);
}

/** Structural places that have not been scanned in `days`. */
export function placesNotScannedSince(graph: MemoryGraph, days: number, at: Date = new Date()): { place: Entity; lastScan?: ISODate }[] {
  const cutoff = new Date(at.getTime() - days * 86400e3).toISOString();
  const lastScan = new Map<ID, ISODate>();
  for (const o of graph.allObservations()) {
    if ((o.source === 'area_scan' || o.source === 'box_scan') && o.placement) {
      const cur = lastScan.get(o.placement.parentId);
      if (!cur || o.observedAt > cur) lastScan.set(o.placement.parentId, o.observedAt);
    }
  }
  return graph
    .entities((e) => e.kind === 'container' || e.kind === 'fixture')
    .map((p) => ({ place: p, lastScan: lastScan.get(p.id) }))
    .filter((x) => !x.lastScan || x.lastScan < cutoff);
}

export interface PlaceChanges {
  added: Entity[];
  noLongerDetected: Entity[];
  movedIn: MoveEvent[];
  movedOut: MoveEvent[];
}

/** "What changed in my bedroom this week?" (recursive over the place's subtree). */
export function changesIn(graph: MemoryGraph, placeId: ID, since: ISODate, at: Date = new Date()): PlaceChanges {
  const atIso = at.toISOString();
  const moves = movesBetween(graph, since, atIso);
  const within = (chain: ID[]) => chain.includes(placeId);
  const added: Entity[] = [];
  for (const e of graph.items()) {
    const s = graph.observationsOf(e.id).filter((o) => o.type === 'sighting');
    if (s[0] && s[0].observedAt >= since && within(s[0].chainSnapshot)) added.push(e);
  }
  const noLonger = new Set<ID>();
  for (const o of graph.allObservations()) {
    if (o.type === 'absence' && o.observedAt >= since && within(o.chainSnapshot)) noLonger.add(o.subjectId);
  }
  return {
    added,
    noLongerDetected: [...noLonger].map((id) => graph.entity(id)).filter((e): e is Entity => !!e),
    movedIn: moves.filter((m) => within(m.to.chainSnapshot) && !within(m.from.chainSnapshot)),
    movedOut: moves.filter((m) => within(m.from.chainSnapshot) && !within(m.to.chainSnapshot)),
  };
}

/** Items that belong to someone, resolved through the BELONGS_TO relation/ownerId. */
export function ownedBy(graph: MemoryGraph, personId: ID): Entity[] {
  return graph.items().filter((e) => e.ownerId === personId);
}
