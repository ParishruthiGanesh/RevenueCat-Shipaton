import { computeBelief, type LocationBelief } from './beliefs';
import type { MemoryGraph } from './graph';
import { colorsIn, cosine, localEmbed, LOCAL_EMBEDDING_MODEL, normalize, queryCoverage, tokenOverlap } from './text';
import type { Entity, ID } from './types';

/**
 * HYBRID RETRIEVAL
 *
 *   structured filters (owner, place subtree, kind)
 * + lexical match over names, aliases, categories, AI descriptions and past labels
 * + semantic similarity (local hashed embedding; provider embeddings when available)
 * + visual-attribute agreement (colours, brand)
 * + graph expansion (a query naming a place restricts to that subtree)
 * → ranked candidates, each with its evidence-backed belief.
 *
 * When the top result is weak or not clearly ahead, the caller shows several candidates
 * instead of guessing.
 */

export interface SearchOptions {
  personId?: ID;
  withinPlaceId?: ID;
  /** Provider query embedding (e.g. Voyage multimodal) + model to compare against stored vectors. */
  queryEmbedding?: { model: string; vector: number[] };
  limit?: number;
  at?: Date;
  includeSensitive?: boolean;
}

export interface SearchHit {
  entity: Entity;
  score: number;
  belief: LocationBelief;
  matched: string[];
}

export const SEARCH_CONFIDENT = 0.55;
export const SEARCH_MARGIN = 0.12;

function historicalLabels(graph: MemoryGraph, id: ID): string {
  const labels = new Set<string>();
  for (const o of graph.observationsOf(id)) {
    if (o.detectedLabel && o.verification !== 'corrected' && o.verification !== 'rejected') labels.add(o.detectedLabel);
    if (o.verifiedLabel) labels.add(o.verifiedLabel);
  }
  return [...labels].join(' ');
}

export function searchItems(graph: MemoryGraph, query: string, opts: SearchOptions = {}): SearchHit[] {
  const at = opts.at ?? new Date();
  const q = normalize(query);
  if (!q) return [];
  const qVec = localEmbed(q);
  const qColors = colorsIn(q);

  let pool = graph.items();
  if (opts.personId) pool = pool.filter((e) => e.ownerId === opts.personId);
  if (opts.includeSensitive === false) pool = pool.filter((e) => !e.sensitive);

  const hits: SearchHit[] = [];
  for (const e of pool) {
    const matched: string[] = [];
    const names = [e.name, ...e.aliases].join(' ');
    const nameCov = queryCoverage(q, names);
    const exact = [e.name, ...e.aliases].some((n) => normalize(n) === q);
    const descCov = queryCoverage(q, `${e.category ?? ''} ${e.description ?? ''} ${e.attributes.brand ?? ''} ${e.attributes.model ?? ''} ${e.attributes.material ?? ''} ${e.attributes.shape ?? ''}`);
    const histCov = queryCoverage(q, historicalLabels(graph, e.id));
    const lexical = Math.max(exact ? 1 : 0, nameCov * 0.95, descCov * 0.75, histCov * 0.7, tokenOverlap(q, names) * 0.9);
    if (nameCov > 0) matched.push('name');
    if (descCov > 0.3) matched.push('description');

    const stored = graph.embeddingsOf(e.id).find((x) => x.model === LOCAL_EMBEDDING_MODEL && x.modality === 'text');
    let semantic = cosine(qVec, stored?.vector ?? localEmbed(`${names} ${e.category ?? ''} ${e.description ?? ''}`));
    if (opts.queryEmbedding) {
      const prov = graph.embeddingsOf(e.id).filter((x) => x.model === opts.queryEmbedding!.model);
      for (const p of prov) semantic = Math.max(semantic, cosine(opts.queryEmbedding.vector, p.vector) * 1.05);
    }
    if (semantic > 0.45) matched.push('similar meaning');

    let score = 0.6 * lexical + 0.4 * Math.max(0, semantic);

    if (qColors.length) {
      const ec = e.attributes.colors.flatMap((c) => colorsIn(c));
      if (ec.length && qColors.some((c) => ec.includes(c))) {
        score += 0.08;
        matched.push('colour');
      } else if (ec.length) score -= 0.15;
    }

    if (score < 0.18) continue;

    const belief = computeBelief(graph, e.id, at);
    if (opts.withinPlaceId && !belief.primary?.currentChain.includes(opts.withinPlaceId)) continue;
    // Tie-break toward better-evidenced records.
    score += 0.04 * belief.score;
    hits.push({ entity: e, score: Math.min(1, score), belief, matched });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, opts.limit ?? 10);
}

export function isConfidentHit(hits: SearchHit[]): boolean {
  const [a, b] = hits;
  if (!a || a.score < SEARCH_CONFIDENT) return false;
  return !b || a.score - b.score >= SEARCH_MARGIN;
}

/** Resolve a spoken/typed place ("box 17", "top drawer", "garage", "backpack") to an entity. */
export function resolvePlace(graph: MemoryGraph, text: string, containerType?: string): Entity | undefined {
  const t = normalize(text);
  if (!t) return undefined;
  const box = t.match(/\bbox\s*#?\s*(\d+)\b/);
  if (box) {
    const n = parseInt(box[1], 10);
    const found = graph.entities((e) => e.box?.number === n)[0];
    if (found) return found;
  }
  const candidates = graph.entities((e) => e.kind !== 'item' || e.isContainer);
  let best: { e: Entity; s: number } | undefined;
  for (const e of candidates) {
    const names = [e.name, ...e.aliases];
    const exact = names.some((n) => normalize(n) === t) ? 1 : 0;
    const cov = queryCoverage(t, names.join(' '));
    const rev = queryCoverage(names.join(' '), t);
    let s = Math.max(exact, 0.7 * cov + 0.3 * rev);
    if (containerType && !normalize(`${e.name} ${e.category ?? ''}`).includes(containerType)) s *= 0.8;
    if (e.kind === 'room' || e.kind === 'space') s += 0.02;
    if (!best || s > best.s) best = { e, s };
  }
  return best && best.s >= 0.5 ? best.e : undefined;
}
