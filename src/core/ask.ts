import { computeBelief, type LocationBelief } from './beliefs';
import type { MemoryGraph } from './graph';
import { answerForBelief, describeChain, formatAgo, formatWhen, shortPlace, type Answer } from './phrasing';
import {
  activeLoans,
  awayFromUsual,
  changesIn,
  contentsOf,
  historyOf,
  mostMoved,
  movesBetween,
  notSeenSince,
  placesNotScannedSince,
  previousLocation,
  uncertainItems,
  usualLocation,
  wasEverIn,
  type ContentEntry,
  type HistoryEntry,
  type PlaceChanges,
  type UsualLocation,
} from './queries';
import { parseQuery, type ParsedQuery } from './query';
import { isConfidentHit, resolvePlace, searchItems, type SearchHit, type SearchOptions } from './search';
import { normalize } from './text';
import type { Entity } from './types';

/**
 * "Ask Physical Memory" — turns a question into a structured, evidence-backed result.
 * The UI renders these as cards; nothing here is free-form model text.
 */

export interface ListRow {
  entity: Entity;
  subtitle: string;
  belief?: LocationBelief;
}

export type AskResult =
  | { type: 'item'; entity: Entity; belief: LocationBelief; answer: Answer; others: SearchHit[]; note?: string }
  | { type: 'candidates'; message: string; hits: SearchHit[] }
  | { type: 'contents'; place: Entity; entries: ContentEntry[]; message: string }
  | { type: 'history'; entity: Entity; entries: HistoryEntry[]; message: string }
  | { type: 'usual'; entity: Entity; usual?: UsualLocation; belief: LocationBelief; message: string }
  | { type: 'list'; title: string; message: string; rows: ListRow[] }
  | { type: 'changes'; place: Entity; changes: PlaceChanges; message: string }
  | { type: 'none'; message: string; parsed: ParsedQuery };

export interface AskOptions extends SearchOptions {
  now?: Date;
}

function personId(graph: MemoryGraph, name?: string) {
  if (!name) return undefined;
  const n = normalize(name);
  if (['me', 'i', 'mine', 'myself'].includes(n)) return graph.people().find((p) => p.relationship === 'self')?.id;
  return graph.people().find((p) => normalize(p.name) === n)?.id;
}

function findSubject(graph: MemoryGraph, parsed: ParsedQuery, opts: AskOptions): { hits: SearchHit[]; confident: boolean } {
  const pid = personId(graph, parsed.person);
  const hits = searchItems(graph, parsed.subject ?? parsed.raw, { ...opts, personId: pid ?? opts.personId });
  return { hits, confident: isConfidentHit(hits) };
}

function candidatesResult(parsed: ParsedQuery, hits: SearchHit[]): AskResult {
  if (hits.length === 0) {
    return {
      type: 'none',
      parsed,
      message: parsed.subject ? `I don't have any memory of "${parsed.subject}" yet. Remember it next time you put it away.` : "I couldn't find anything matching that.",
    };
  }
  return { type: 'candidates', hits: hits.slice(0, 5), message: hits.length === 1 ? 'I found one possible match.' : `I found ${Math.min(hits.length, 5)} possible matches.` };
}

export function ask(graph: MemoryGraph, input: string | ParsedQuery, opts: AskOptions = {}): AskResult {
  const parsed = typeof input === 'string' ? parseQuery(input) : input;
  const now = opts.now ?? new Date();
  const at = opts.at ?? now;
  const o = { ...opts, at };

  switch (parsed.intent) {
    case 'find': {
      const { hits, confident } = findSubject(graph, parsed, o);
      if (!confident) return candidatesResult(parsed, hits);
      const top = hits[0];
      let note: string | undefined;
      if (parsed.containerType && top.belief.primary) {
        const container = top.belief.primary.currentChain.map((id) => graph.entity(id)).find((e) => e && normalize(`${e.name} ${e.category ?? ''}`).includes(parsed.containerType!));
        if (container) note = `${container.name} — ${shortPlace(graph, graph.chainFrom(graph.structuralPlacement(container.id, at.toISOString())?.parentId, at.toISOString()))}`;
      }
      // Two records with the same name (two identical chargers) → show both.
      const twins = hits.slice(1).filter((h) => normalize(h.entity.name) === normalize(top.entity.name));
      return { type: 'item', entity: top.entity, belief: top.belief, answer: answerForBelief(graph, top.belief, now), others: twins, note };
    }

    case 'contents': {
      const place = resolvePlace(graph, parsed.place ?? '');
      if (!place) return { type: 'none', parsed, message: `I don't know a place called "${parsed.place}" yet.` };
      let entries = contentsOf(graph, place.id, { recursive: true, at });
      const pid = personId(graph, parsed.person);
      if (pid) entries = entries.filter((e) => e.entity.ownerId === pid);
      return {
        type: 'contents',
        place,
        entries,
        message: entries.length ? `${entries.length} ${entries.length === 1 ? 'thing' : 'things'} last recorded in ${place.name}.` : `Nothing recorded in ${place.name} yet.`,
      };
    }

    case 'history': {
      const { hits, confident } = findSubject(graph, parsed, o);
      if (!confident) return candidatesResult(parsed, hits);
      const e = hits[0].entity;
      const entries = historyOf(graph, e.id);
      return { type: 'history', entity: e, entries, message: `${entries.length} recorded ${entries.length === 1 ? 'observation' : 'observations'}.` };
    }

    case 'usual': {
      const { hits, confident } = findSubject(graph, parsed, o);
      if (!confident) return candidatesResult(parsed, hits);
      const e = hits[0].entity;
      const usual = usualLocation(graph, e.id, at);
      const belief = computeBelief(graph, e.id, at);
      const message = usual
        ? `Usually ${describeChain(graph, usual.chain)} — about ${Math.round(usual.share * 100)}% of the recorded time.`
        : `There isn't enough history for ${e.name} yet.`;
      return { type: 'usual', entity: e, usual, belief, message };
    }

    case 'last_seen_time': {
      const { hits, confident } = findSubject(graph, parsed, o);
      if (!confident) return candidatesResult(parsed, hits);
      const top = hits[0];
      const last = top.belief.lastSighting;
      const answer = answerForBelief(graph, top.belief, now);
      return {
        type: 'item',
        entity: top.entity,
        belief: top.belief,
        others: [],
        answer: last ? { ...answer, headline: `Last seen ${formatWhen(last.observedAt, now)}, ${describeChain(graph, last.chainSnapshot, last.placement?.relation)}.` } : answer,
      };
    }

    case 'was_ever_in': {
      const { hits, confident } = findSubject(graph, parsed, o);
      if (!confident) return candidatesResult(parsed, hits);
      const e = hits[0].entity;
      const place = resolvePlace(graph, parsed.place ?? '');
      if (!place) return { type: 'none', parsed, message: `I don't know a place called "${parsed.place}".` };
      const matches = wasEverIn(graph, e.id, place.id);
      const entries = historyOf(graph, e.id).filter((h) => matches.some((m) => m.id === h.observation.id));
      return {
        type: 'history',
        entity: e,
        entries,
        message: matches.length
          ? `Yes — ${e.name} was recorded in ${place.name} ${matches.length} ${matches.length === 1 ? 'time' : 'times'}, most recently ${formatWhen(matches[matches.length - 1].observedAt, now)}.`
          : `No — there's no record of ${e.name} in ${place.name}.`,
      };
    }

    case 'previous': {
      const { hits, confident } = findSubject(graph, parsed, o);
      if (!confident) return candidatesResult(parsed, hits);
      const e = hits[0].entity;
      const prev = previousLocation(graph, e.id);
      return {
        type: 'history',
        entity: e,
        entries: historyOf(graph, e.id).slice(-3),
        message: prev ? `Before its latest spot, it was ${describeChain(graph, prev.chainSnapshot, prev.placement?.relation)} (${formatWhen(prev.observedAt, now)}).` : `${e.name} has only been recorded in one place.`,
      };
    }

    case 'inventory': {
      const hits = searchItems(graph, parsed.subject ?? '', { ...o, limit: 30 }).filter((h) => h.score >= 0.45);
      return {
        type: 'list',
        title: parsed.subject ? cap(parsed.subject) : 'Inventory',
        message: hits.length ? `You appear to have ${hits.length} matching ${hits.length === 1 ? 'item' : 'items'}.` : `No record of owning ${parsed.subject}.`,
        rows: hits.map((h) => ({ entity: h.entity, belief: h.belief, subtitle: rowSubtitle(graph, h.belief, now) })),
      };
    }

    case 'lent_list': {
      const pid = personId(graph, parsed.person);
      const loans = activeLoans(graph).filter((l) => !pid || l.personId === pid);
      return {
        type: 'list',
        title: 'Lent out',
        message: loans.length ? `${loans.length} ${loans.length === 1 ? 'thing is' : 'things are'} marked as lent.` : 'Nothing is marked as lent right now.',
        rows: loans
          .map((l) => ({ l, e: graph.entity(l.itemId) }))
          .filter((x): x is { l: typeof x.l; e: Entity } => !!x.e)
          .map(({ l, e }) => ({ entity: e, subtitle: `Lent to ${graph.person(l.personId)?.name ?? 'someone'} · ${formatAgo(l.lentAt, now)}` })),
      };
    }

    case 'stale': {
      const days = parsed.sinceDays ?? 180;
      const rows = notSeenSince(graph, days, at);
      return {
        type: 'list',
        title: 'Not seen recently',
        message: rows.length ? `${rows.length} ${rows.length === 1 ? 'item has' : 'items have'} no recorded observation in ${humanDays(days)}.` : `Everything has been observed in the last ${humanDays(days)}.`,
        rows: rows.map((r) => ({ entity: r.entity, subtitle: r.lastSeen ? `Last seen ${formatAgo(r.lastSeen, now)}` : 'Never observed' })),
      };
    }

    case 'uncertain': {
      const beliefs = uncertainItems(graph, at);
      return {
        type: 'list',
        title: 'Uncertain locations',
        message: beliefs.length ? `${beliefs.length} ${beliefs.length === 1 ? 'item needs' : 'items need'} a fresh look.` : 'Every remembered item has a reliable recent sighting.',
        rows: beliefs.map((b) => ({ entity: graph.entity(b.entityId)!, belief: b, subtitle: rowSubtitle(graph, b, now) })),
      };
    }

    case 'changes': {
      const place = resolvePlace(graph, parsed.place ?? '');
      if (!place) return { type: 'none', parsed, message: `I don't know a place called "${parsed.place}".` };
      const since = new Date(at.getTime() - (parsed.sinceDays ?? 7) * 86400e3).toISOString();
      const changes = changesIn(graph, place.id, since, at);
      const n = changes.added.length + changes.noLongerDetected.length + changes.movedIn.length + changes.movedOut.length;
      return { type: 'changes', place, changes, message: n ? `${n} recorded ${n === 1 ? 'change' : 'changes'} in ${place.name} over the last ${humanDays(parsed.sinceDays ?? 7)}.` : `No recorded changes in ${place.name}.` };
    }

    case 'moves': {
      const since = new Date(at.getTime() - (parsed.sinceDays ?? 2) * 86400e3).toISOString();
      const moves = movesBetween(graph, since, at.toISOString());
      return {
        type: 'list',
        title: 'Recently moved',
        message: moves.length ? `${moves.length} ${moves.length === 1 ? 'move' : 'moves'} recorded.` : 'No moves recorded in that period.',
        rows: moves.map((m) => ({ entity: m.entity, subtitle: `${graph.entity(m.from.placement!.parentId)?.name ?? '?'} → ${graph.entity(m.to.placement!.parentId)?.name ?? '?'} · ${formatAgo(m.to.observedAt, now)}` })),
      };
    }

    case 'storage': {
      const storageRoots = graph.entities((e) => e.spaceType === 'storage_unit' || !!e.box || /storage|attic|basement/i.test(e.name));
      const seen = new Set<string>();
      const rows: ListRow[] = [];
      for (const root of storageRoots) {
        for (const c of contentsOf(graph, root.id, { recursive: true, at })) {
          if (seen.has(c.entity.id)) continue;
          seen.add(c.entity.id);
          rows.push({ entity: c.entity, belief: c.belief, subtitle: rowSubtitle(graph, c.belief, now) });
        }
      }
      return { type: 'list', title: 'In storage', message: `${rows.length} ${rows.length === 1 ? 'item is' : 'items are'} recorded in storage.`, rows };
    }

    case 'away': {
      const rows = awayFromUsual(graph, at);
      return {
        type: 'list',
        title: 'Away from usual spots',
        message: rows.length ? `${rows.length} ${rows.length === 1 ? 'item was' : 'items were'} last seen away from their usual place.` : 'Everything was last seen in its usual place.',
        rows: rows.map((r) => ({ entity: r.entity, belief: r.belief, subtitle: `Usually ${shortPlace(graph, r.usual.chain)}` })),
      };
    }

    case 'misplaced': {
      const rows = mostMoved(graph);
      return {
        type: 'list',
        title: 'Moves around the most',
        message: rows.length ? 'Based on how often each item has been recorded in different places.' : 'Not enough history yet.',
        rows: rows.map((r) => ({ entity: r.entity, subtitle: `${r.moves} moves across ${r.places} places` })),
      };
    }

    case 'not_scanned': {
      const rows = placesNotScannedSince(graph, parsed.sinceDays ?? 30, at);
      return {
        type: 'list',
        title: 'Not scanned recently',
        message: `${rows.length} ${rows.length === 1 ? 'place hasn’t' : 'places haven’t'} been scanned in ${humanDays(parsed.sinceDays ?? 30)}.`,
        rows: rows.map((r) => ({ entity: r.place, subtitle: r.lastScan ? `Last scanned ${formatAgo(r.lastScan, now)}` : 'Never scanned' })),
      };
    }
  }
}

function rowSubtitle(graph: MemoryGraph, b: LocationBelief, now: Date): string {
  if (b.status === 'lent' && b.loan) return `Lent to ${graph.person(b.loan.personId)?.name ?? 'someone'}`;
  if (!b.primary) return 'No sightings yet';
  return `${cap(shortPlace(graph, b.primary.currentChain, b.primary.observation.placement!.relation))} · ${formatAgo(b.primary.observation.observedAt, now)}`;
}

function humanDays(d: number): string {
  if (d >= 365) return d === 365 ? 'a year' : `${Math.round(d / 365)} years`;
  if (d >= 30) return d < 60 ? 'a month' : `${Math.round(d / 30)} months`;
  if (d >= 7) return d < 14 ? 'a week' : `${Math.round(d / 7)} weeks`;
  return d === 1 ? 'a day' : `${d} days`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
