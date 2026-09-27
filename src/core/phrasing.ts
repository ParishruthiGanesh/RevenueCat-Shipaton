import type { BeliefFlag, ConfidenceLevel, Evidence, LocationBelief } from './beliefs';
import type { MemoryGraph } from './graph';
import type { Entity, ID, ISODate, PlacementRelation } from './types';

/**
 * Deterministic, evidence-grounded language.
 *
 * Location answers are NEVER written by an LLM. They are composed here from the belief
 * and its evidence, so every word the user reads is traceable to an observation.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

function time12(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${m.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "today at 8:14 PM", "yesterday at 9:02 AM", "September 22 at 8:14 PM", "March 3, 2025". */
export function formatWhen(iso: ISODate, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400e3);
  if (days === 0) return `today at ${time12(d)}`;
  if (days === 1) return `yesterday at ${time12(d)}`;
  if (d.getFullYear() !== now.getFullYear()) return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()} at ${time12(d)}`;
}

/** "today", "yesterday", "on September 24", "on March 3, 2025". */
export function formatDay(iso: ISODate, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400e3);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `on ${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== now.getFullYear() ? `, ${d.getFullYear()}` : ''}`;
}

/** Short relative form for chips/cards: "2h ago", "3d ago", "Sep 22". */
export function formatAgo(iso: ISODate, now: Date = new Date()): string {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  const d = new Date(iso);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== now.getFullYear() ? `, ${d.getFullYear()}` : ''}`;
}

export function formatDateShort(iso: ISODate): string {
  const d = new Date(iso);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

const PREP: Record<PlacementRelation, string> = {
  INSIDE: 'in',
  ON_TOP_OF: 'on',
  UNDER: 'under',
  NEXT_TO: 'next to',
  ATTACHED_TO: 'attached to',
  LOCATED_IN: 'in',
};

/** Surface relations ("on", "under") only make sense for furniture and objects — a room is always "in". */
function prep(relation: PlacementRelation, e: Entity | undefined): string {
  return e && (e.kind === 'room' || e.kind === 'space') ? 'in' : PREP[relation];
}

/** "the blue document pouch", "Box 17", "home". */
export function nounPhrase(e: Entity | undefined): string {
  if (!e) return 'an unknown place';
  const n = e.name.trim();
  if (e.kind === 'space' && e.spaceType === 'home' && /^home$/i.test(n)) return 'home';
  // Labelled units ("Box 17", "Shelf B", "Rack 4") and possessives read without an article.
  if (e.box || /\d/.test(n) || /'s\b/.test(n) || /\s[A-Z]$/.test(n)) return n;
  return `the ${softLower(n)}`;
}

/** Lower-cases a leading capital only for ordinary phrases ("Black dresser"), never "AirPods" or "MacBook". */
export function softLower(n: string): string {
  return /^[A-Z][a-z]/.test(n) && !/[A-Z]/.test(n.slice(1)) ? n.charAt(0).toLowerCase() + n.slice(1) : n;
}

/**
 * Natural sentence fragment for a chain, e.g.
 *   "in the blue document pouch, in the top drawer of the black dresser, in the bedroom"
 */
export function describeChain(graph: MemoryGraph, chain: ID[], relation: PlacementRelation = 'INSIDE', includeSpace = false): string {
  if (chain.length === 0) return 'in an unknown place';
  const parts: string[] = [];
  const entities = chain.map((id) => graph.entity(id));
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e) continue;
    if (e.kind === 'space') {
      if (includeSpace) parts.push(e.spaceType === 'home' && /^home$/i.test(e.name) ? 'at home' : `at ${e.name}`);
      continue;
    }
    const prev = entities[i - 1];
    if (i === 0) parts.push(`${prep(relation, e)} ${nounPhrase(e)}`);
    // "top drawer OF the black dresser"
    else if (prev && e.kind === 'fixture' && prev.kind === 'container' && !prev.box) parts[parts.length - 1] += ` of ${nounPhrase(e)}`;
    else parts.push(`in ${nounPhrase(e)}`);
  }
  return parts.join(', ');
}

/** Outermost-first breadcrumb items for UI: [Home, Bedroom, Black dresser, Top drawer, Blue pouch]. */
export function breadcrumb(graph: MemoryGraph, chain: ID[]): Entity[] {
  return [...chain].reverse().map((id) => graph.entity(id)).filter((e): e is Entity => !!e);
}

export const LEVEL_LABEL: Record<ConfidenceLevel, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  unknown: 'No reliable recent evidence',
};

export const LEVEL_EXPLAINER: Record<ConfidenceLevel, string> = {
  high: 'Directly observed recently.',
  medium: 'Observed a while ago with no conflicting sightings.',
  low: 'Old or ambiguous observation. This location may be outdated.',
  unknown: 'No reliable recent observation exists.',
};

const SOURCE_PHRASE: Record<string, string> = {
  camera_capture: 'You photographed it',
  area_scan: 'Detected in a scan',
  box_scan: 'Recorded when the box was packed',
  qr_scan: 'Box label scanned',
  voice_statement: 'You said so',
  manual: 'You set this',
  setup: 'Set during setup',
  passive: 'Seen in the background',
  tracker: 'Reported by a tracker',
};

export function sourcePhrase(ev: Evidence | undefined): string {
  if (!ev) return '';
  const o = ev.observation;
  const base = SOURCE_PHRASE[o.source] ?? 'Recorded';
  const count = ev.supportCount > 1 ? ` · seen ${ev.supportCount}× there` : '';
  return `${base}${o.evidence === 'observed' ? '' : o.evidence === 'user_stated' ? ' (not photographed)' : ' (inferred)'}${count}`;
}

export interface Answer {
  /** One-sentence headline. Always "last seen" language. */
  headline: string;
  /** Short version for Simple Mode / voice. */
  simple: string;
  /** Extra honest caveats, one per line. */
  caveats: string[];
}

export function answerForBelief(graph: MemoryGraph, belief: LocationBelief, now: Date = new Date()): Answer {
  const e = graph.entity(belief.entityId);
  const name = e ? possessive(e) : 'that';
  const p = belief.primary;
  const caveats: string[] = [];

  if (belief.status === 'lent' && belief.loan) {
    const who = graph.person(belief.loan.personId)?.name ?? 'someone';
    const before = p ? ` Its last physical sighting before that was ${describeChain(graph, p.currentChain, p.observation.placement!.relation)} (${formatWhen(p.observation.observedAt, now)}).` : '';
    if (belief.flags.includes('seen_after_loan')) caveats.push('It was also seen at home after the loan date. Was it returned?');
    return {
      headline: `${cap(name)} was marked as lent to ${who} ${formatDay(belief.loan.lentAt, now)}.${before}`,
      simple: `Lent to ${who}.`,
      caveats,
    };
  }

  if (belief.status === 'removed') {
    const last = belief.lastSighting;
    return {
      headline: last
        ? `You marked ${name} as no longer ${describeChain(graph, last.chainSnapshot, last.placement?.relation)}. There's no newer sighting.`
        : `There's no reliable sighting of ${name}.`,
      simple: 'Location unknown.',
      caveats,
    };
  }

  if (!p) {
    return { headline: `I don't have any sightings of ${name} yet.`, simple: 'Not remembered yet.', caveats };
  }

  const where = describeChain(graph, p.currentChain, p.observation.placement!.relation);
  const when = formatWhen(p.observation.observedAt, now);
  const { room } = graph.spaceAndRoom(p.currentChain);
  const shortWhere = shortPlace(graph, p.currentChain, p.observation.placement!.relation);

  let headline: string;
  let simple: string;
  switch (belief.level) {
    case 'high':
      headline = `Last seen ${where} — ${when}.`;
      simple = `Last seen ${shortWhere}, ${relativeDay(p.observation.observedAt, now)}.`;
      break;
    case 'medium':
      headline = `Likely ${where}. Last seen ${when}.`;
      simple = `Probably ${shortWhere}. Seen ${relativeDay(p.observation.observedAt, now)}.`;
      break;
    case 'low':
      headline = `Last seen ${where} on ${when.replace(/^today|^yesterday/, (m) => m)}. This location may be outdated.`;
      simple = `Maybe ${shortWhere}. Seen ${relativeDay(p.observation.observedAt, now)} — may be outdated.`;
      break;
    default:
      headline = `No reliable recent sighting. The last record was ${where}, ${when}.`;
      simple = `Not sure. Last record: ${room ? nounPhrase(room) : shortWhere}.`;
  }

  for (const f of belief.flags) {
    const c = caveatFor(graph, f, belief, now);
    if (c) caveats.push(c);
  }
  return { headline, simple, caveats };
}

function caveatFor(graph: MemoryGraph, f: BeliefFlag, belief: LocationBelief, now: Date): string | null {
  switch (f) {
    case 'not_detected_in_latest_scan': {
      const a = belief.absence;
      const place = a?.placement ? nounPhrase(graph.entity(a.placement.parentId)) : 'that spot';
      return a
        ? `Not detected when you scanned ${place} ${formatWhen(a.observedAt, now)}. Its last confirmed sighting there remains ${formatWhen(belief.primary!.observation.observedAt, now)}.`
        : null;
    }
    case 'newer_weak_sighting': {
      const alt = belief.alternatives.find((a) => a.observation.observedAt > belief.primary!.observation.observedAt);
      return alt ? `There's a newer but uncertain sighting ${describeChain(graph, alt.currentChain, alt.observation.placement!.relation)} (${formatAgo(alt.observation.observedAt, now)}).` : null;
    }
    case 'container_not_detected': {
      const ca = belief.containerAbsence;
      if (!ca) return null;
      const container = graph.entity(ca.container);
      const where = graph.entity(ca.absence.placement?.parentId);
      return `${cap(nounPhrase(container))} it was in wasn’t detected when you scanned ${nounPhrase(where)} ${formatWhen(ca.absence.observedAt, now)}. Its last confirmed sighting remains ${formatWhen(belief.primary!.observation.observedAt, now)}.`;
    }
        case 'conflicting_observations':
      return 'Some sightings disagree — see the other possible places below.';
    case 'container_moved_since':
      return 'The container it was in has moved since, so this follows the container to its latest known spot.';
    case 'user_stated_only':
      return 'Based on what you said — not yet seen by the camera.';
    case 'ambiguous_identity':
      return 'The camera match to this exact item was uncertain.';
    case 'stale':
      return "It's been a while since this was seen.";
    default:
      return null;
  }
}

/** Compact "in the top drawer, bedroom". */
export function shortPlace(graph: MemoryGraph, chain: ID[], relation: PlacementRelation = 'INSIDE'): string {
  const first = graph.entity(chain[0]);
  const { room } = graph.spaceAndRoom(chain);
  if (!first) return 'somewhere';
  if (!room || room.id === first.id) return `${prep(relation, first)} ${nounPhrase(first)}`;
  return `${prep(relation, first)} ${nounPhrase(first)}, ${softLower(room.name)}`;
}

function relativeDay(iso: ISODate, now: Date): string {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400e3);
  const h = d.getHours();
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  if (days === 0) return `this ${part}`;
  if (days === 1) return `yesterday ${part}`;
  if (days < 7) return `${days} days ago`;
  return `on ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function possessive(e: Entity): string {
  if (/^(my|your|the)\b/i.test(e.name) || /'s\b/.test(e.name) || e.box) return e.name;
  return `your ${softLower(e.name)}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
