import type { MemoryGraph } from './graph';
import type { Entity, ID, ISODate, Loan, Mobility, Observation, ObservationSource } from './types';

/**
 * UNCERTAINTY ENGINE
 *
 * Turns an append-only observation log into an honest belief about where something is.
 *
 * Principles:
 *  1. We never claim where something IS. We report where it was LAST SEEN, with how sure we are.
 *  2. Evidence strength depends on source, detector confidence, instance-match confidence and
 *     user verification. Strength decays with age at a rate set by the object's mobility
 *     (keys move hourly, passports move monthly, boxes rarely).
 *  3. A newer sighting elsewhere contradicts older ones in proportion to its OWN strength —
 *     a weak, ambiguous new sighting does not erase a strong confirmed older one.
 *  4. Not being detected in a scan lowers confidence. It is never proof of absence.
 *  5. A loan or an explicit "that's no longer there" overrides physical inference.
 */

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown';

export type BeliefFlag =
  | 'not_detected_in_latest_scan'
  | 'newer_weak_sighting'
  | 'conflicting_observations'
  | 'stale'
  | 'user_stated_only'
  | 'container_moved_since'
  | 'marked_removed'
  | 'seen_after_loan'
  | 'ambiguous_identity'
  | 'container_not_detected';

export interface Evidence {
  observation: Observation;
  /** Chain as it resolves now (follows boxes/containers that moved since). */
  currentChain: ID[];
  /** Chain as recorded at observation time. */
  recordedChain: ID[];
  /** Strength before time decay, 0..1. */
  strength: number;
  /** Strength after decay, support aggregation and contradiction, 0..1. */
  score: number;
  supportCount: number;
}

export type BeliefStatus = 'located' | 'lent' | 'removed' | 'unknown';

export interface LocationBelief {
  entityId: ID;
  status: BeliefStatus;
  level: ConfidenceLevel;
  score: number;
  primary?: Evidence;
  alternatives: Evidence[];
  lastSighting?: Observation;
  flags: BeliefFlag[];
  loan?: Loan;
  /** Most recent absence observation affecting the primary location, if any. */
  absence?: Observation;
  /** A container object it was inside (pouch, bag) that was not detected in a later scan. */
  containerAbsence?: { container: ID; absence: Observation };
  computedAt: ISODate;
}

const SOURCE_BASE: Record<ObservationSource, number> = {
  camera_capture: 0.95,
  box_scan: 0.92,
  qr_scan: 0.9,
  setup: 0.9,
  area_scan: 0.86,
  manual: 0.85,
  voice_statement: 0.8,
  tracker: 0.75,
  passive: 0.6,
};

const EVIDENCE_FACTOR = { observed: 1, user_stated: 0.9, inferred: 0.6 } as const;

/** Half-life of a sighting's reliability, in hours. */
export const HALF_LIFE_HOURS: Record<Mobility, number> = {
  high: 18,
  medium: 24 * 7,
  low: 24 * 60,
  static: 24 * 365,
};

export const LEVEL_THRESHOLDS = { high: 0.7, medium: 0.4, low: 0.12 } as const;

const HIGH_MOBILITY = /\b(key|keys|phone|wallet|glasses|sunglasses|airpods|earbuds|earphones|headphones|watch|remote|badge|card|lip ?balm|pen|vape|lighter)\b/i;
const LOW_MOBILITY = /\b(passport|document|documents|certificate|deed|tool|tools|drill|screwdriver|hammer|blender|grinder|mug|mugs|plate|clothes|clothing|jacket|coat|decoration|decorations|lights|book|books|album|jewelry|spare)\b/i;

export function inferMobility(e: Entity): Mobility {
  if (e.mobility) return e.mobility;
  if (e.kind !== 'item') return 'static';
  if (e.box) return 'static';
  const text = `${e.name} ${e.category ?? ''} ${e.aliases.join(' ')}`;
  if (HIGH_MOBILITY.test(text)) return 'high';
  if (LOW_MOBILITY.test(text)) return 'low';
  return 'medium';
}

/** Learned mobility: objects that moved a lot recently decay faster. */
export function effectiveMobility(graph: MemoryGraph, e: Entity, at: Date): Mobility {
  const base = inferMobility(e);
  if (base === 'static' || base === 'high') return base;
  const since = new Date(at.getTime() - 30 * 24 * 3600e3).toISOString();
  const sightings = graph.observationsOf(e.id).filter((o) => o.type === 'sighting' && o.observedAt >= since && o.placement);
  let moves = 0;
  for (let i = 1; i < sightings.length; i++) {
    if (sightings[i].placement!.parentId !== sightings[i - 1].placement!.parentId) moves++;
  }
  if (moves >= 4) return 'high';
  if (moves >= 2 && base === 'low') return 'medium';
  return base;
}

export function observationStrength(o: Observation): number {
  if (o.verification === 'rejected' || o.retracted) return 0;
  let s = SOURCE_BASE[o.source] * EVIDENCE_FACTOR[o.evidence] * clamp01(o.detectionConfidence) * clamp01(o.matchConfidence);
  // A human confirming or correcting an observation makes it near-certain *at that moment*.
  if (o.verification === 'confirmed') s = Math.max(s, 0.93 * SOURCE_BASE[o.source]);
  if (o.verification === 'corrected') s = Math.max(s, 0.95 * SOURCE_BASE[o.source]);
  return clamp01(s);
}

export function decay(hours: number, mobility: Mobility): number {
  if (hours <= 0) return 1;
  return Math.pow(0.5, hours / HALF_LIFE_HOURS[mobility]);
}

export function levelFor(score: number): ConfidenceLevel {
  if (score >= LEVEL_THRESHOLDS.high) return 'high';
  if (score >= LEVEL_THRESHOLDS.medium) return 'medium';
  if (score >= LEVEL_THRESHOLDS.low) return 'low';
  return 'unknown';
}

const hoursBetween = (a: ISODate, b: Date) => (b.getTime() - new Date(a).getTime()) / 3600e3;

export function computeBelief(graph: MemoryGraph, entityId: ID, at: Date = new Date()): LocationBelief {
  const atIso = at.toISOString();
  const entity = graph.entity(entityId);
  const base: LocationBelief = { entityId, status: 'unknown', level: 'unknown', score: 0, alternatives: [], flags: [], computedAt: atIso };
  if (!entity) return base;

  const all = graph.observationsOf(entityId).filter((o) => o.observedAt <= atIso);
  const sightingsAll = all.filter((o) => o.type === 'sighting' && o.placement && observationStrength(o) > 0);
  base.lastSighting = sightingsAll[sightingsAll.length - 1];

  const lastRemoval = [...all].reverse().find((o) => o.type === 'removal');
  const loan = graph.activeLoan(entityId, atIso);

  // Evidence considered for a physical location: sightings after the last explicit removal.
  let sightings = lastRemoval ? sightingsAll.filter((o) => o.observedAt > lastRemoval.observedAt) : sightingsAll;
  if (loan) {
    const after = sightings.filter((o) => o.observedAt > loan.lentAt);
    if (after.length) base.flags.push('seen_after_loan');
    // While lent, the meaningful physical fact is the last sighting BEFORE it was lent.
    sightings = sightings.filter((o) => o.observedAt <= loan.lentAt);
  }

  const mobility = effectiveMobility(graph, entity, at);

  // Group by placement parent. Repeated sightings in the same place reinforce each other.
  const groups = new Map<ID, Observation[]>();
  for (const o of sightings) {
    const k = o.placement!.parentId;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }

  const evidence: Evidence[] = [];
  for (const [, obs] of groups) {
    const latest = obs[obs.length - 1];
    let miss = 1;
    for (const o of obs) miss *= 1 - observationStrength(o) * decay(hoursBetween(o.observedAt, at), mobility);
    evidence.push({
      observation: latest,
      currentChain: graph.chainFrom(latest.placement!.parentId, atIso),
      recordedChain: latest.chainSnapshot,
      strength: observationStrength(latest),
      score: 1 - miss,
      supportCount: obs.length,
    });
  }

  // Newer sightings elsewhere contradict older groups, in proportion to their own strength.
  for (const ev of evidence) {
    for (const other of evidence) {
      if (other === ev) continue;
      if (other.observation.observedAt > ev.observation.observedAt) {
        ev.score *= 1 - other.strength * decay(hoursBetween(other.observation.observedAt, at), mobility) * 0.98;
      }
    }
  }

  // Absence of detection in the believed container lowers — but never zeroes — confidence.
  for (const ev of evidence) {
    const absence = all
      .filter((o) => o.type === 'absence' && o.placement?.parentId === ev.observation.placement!.parentId && o.observedAt > ev.observation.observedAt)
      .pop();
    if (absence) {
      ev.score *= 0.3;
      if (!base.absence || absence.observedAt > base.absence.observedAt) base.absence = absence;
    }
  }

  // If a CONTAINER object it was inside (a pouch, a bag) was itself not detected in a later
  // scan of where that container sat, this location is in doubt too — propagate the absence.
  let containerAbsence: { container: ID; absence: Observation } | undefined;
  for (const ev of evidence) {
    for (let i = 0; i < ev.currentChain.length - 1; i++) {
      const cid = ev.currentChain[i];
      const ce = graph.entity(cid);
      if (!ce || ce.kind !== 'item') break; // only movable containers; fixed structure doesn't vanish
      const parent = ev.currentChain[i + 1];
      const abs = graph
        .observationsOf(cid)
        .filter((o) => o.type === 'absence' && o.placement?.parentId === parent && o.observedAt > ev.observation.observedAt && o.observedAt <= atIso)
        .pop();
      const seenSince = graph.observationsOf(cid).some((o) => o.type === 'sighting' && abs && o.observedAt > abs.observedAt);
      if (abs && !seenSince) {
        ev.score *= 0.45;
        if (!containerAbsence || abs.observedAt > containerAbsence.absence.observedAt) containerAbsence = { container: cid, absence: abs };
        break;
      }
    }
  }

  evidence.sort((a, b) => b.score - a.score || b.observation.observedAt.localeCompare(a.observation.observedAt));
  const primary = evidence[0];

  if (loan) {
    return { ...base, status: 'lent', loan, primary, alternatives: evidence.slice(1, 3), level: primary ? levelFor(primary.score) : 'unknown', score: primary?.score ?? 0 };
  }

  if (!primary) {
    if (lastRemoval) return { ...base, status: 'removed', flags: [...base.flags, 'marked_removed'] };
    return base;
  }

  const flags = [...base.flags];
  if (base.absence && base.absence.placement?.parentId === primary.observation.placement!.parentId) flags.push('not_detected_in_latest_scan');
  if (containerAbsence && primary.currentChain.includes(containerAbsence.container)) flags.push('container_not_detected');
  const newest = [...evidence].sort((a, b) => b.observation.observedAt.localeCompare(a.observation.observedAt))[0];
  if (newest !== primary) flags.push('newer_weak_sighting');
  const runnerUp = evidence[1];
  if (runnerUp && runnerUp.score > primary.score * 0.6) flags.push('conflicting_observations');
  if (hoursBetween(primary.observation.observedAt, at) > HALF_LIFE_HOURS[mobility] * 2) flags.push('stale');
  if (sightings.every((o) => o.evidence !== 'observed')) flags.push('user_stated_only');
  if (primary.observation.matchConfidence < 0.75) flags.push('ambiguous_identity');
  if (containerMoved(primary.recordedChain, primary.currentChain)) flags.push('container_moved_since');

  const score = primary.score;
  return {
    ...base,
    status: levelFor(score) === 'unknown' ? 'unknown' : 'located',
    level: levelFor(score),
    score,
    primary,
    // Alternatives are genuinely competing places: newer (weaker) sightings, or ones scoring close
    // to the primary. Older places superseded by a newer sighting belong to history, not here.
    alternatives: evidence
      .slice(1)
      .filter((e) => e.score >= LEVEL_THRESHOLDS.low * 0.5 && (e.observation.observedAt > primary.observation.observedAt || e.score >= primary.score * 0.6))
      .slice(0, 3),
    flags,
    containerAbsence,
  };
}

/**
 * True only if some ancestor's parent actually CHANGED between observation time and now.
 * A recorded chain that is merely shorter (structure learned later, e.g. the box's shelf was
 * added afterwards) is not a move.
 */
export function containerMoved(recorded: ID[], current: ID[]): boolean {
  for (let i = 0; i + 1 < recorded.length; i++) {
    const j = current.indexOf(recorded[i]);
    if (j === -1) return true;
    if (current[j + 1] !== recorded[i + 1]) return true;
  }
  return recorded.length > 0 && current[0] !== recorded[0];
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
