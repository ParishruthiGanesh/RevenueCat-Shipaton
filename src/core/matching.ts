import { computeBelief } from './beliefs';
import type { MemoryGraph } from './graph';
import { colorsIn, cosine, localEmbed, tokenOverlap } from './text';
import type { Entity, ID, SizeClass, VisualAttributes } from './types';

/**
 * OBJECT INSTANCE RE-IDENTIFICATION
 *
 * Category labels are not identity: "charger" is insufficient. We combine
 *   - label / alias similarity (synonym aware),
 *   - visual-description similarity,
 *   - image-embedding similarity (when a provider embedding exists),
 *   - hard attribute evidence (brand and colour conflicts are strong negatives),
 *   - distinguishing marks,
 *   - a spatial prior (things tend to be where they were last seen),
 * into a calibrated score, and we NEVER silently merge ambiguous candidates.
 */

export interface DetectionDescriptor {
  label: string;
  category?: string;
  description?: string;
  attributes: VisualAttributes;
  imageEmbedding?: { model: string; vector: number[] };
  /** The container/fixture the detection was seen in, if known. */
  contextParentId?: ID;
}

export interface MatchCandidate {
  entity: Entity;
  score: number;
  reasons: string[];
}

export type MatchDecision =
  | { kind: 'same'; entity: Entity; score: number; candidates: MatchCandidate[] }
  | { kind: 'ask'; candidates: MatchCandidate[] }
  | { kind: 'new'; candidates: MatchCandidate[] };

export const MATCH_THRESHOLDS = { same: 0.8, ask: 0.5, margin: 0.12 } as const;

const SIZE_ORDER: SizeClass[] = ['tiny', 'small', 'medium', 'large', 'huge'];

function entityNames(e: Entity): string {
  return [e.name, ...e.aliases].join(' ');
}

/** Top-level category ("electronics/charger" → "electronics"). */
function topCategory(c?: string): string | undefined {
  return c?.split('/')[0].trim().toLowerCase() || undefined;
}

function normColors(cs: string[]): string[] {
  return [...new Set(cs.flatMap((c) => colorsIn(c)).concat(cs.map((c) => c.toLowerCase().replace('gray', 'grey'))))].filter(Boolean);
}

export function scoreCandidate(graph: MemoryGraph, d: DetectionDescriptor, e: Entity, at: Date = new Date()): MatchCandidate {
  const reasons: string[] = [];
  // Identity is driven by what the thing IS called, not by its broad category: a camera and
  // headphones are both "electronics" but never the same object.
  const names = entityNames(e);
  const label = Math.max(tokenOverlap(d.label, names), cosine(localEmbed(d.label), localEmbed(names)));

  const desc = d.description && e.description ? cosine(localEmbed(d.description), localEmbed(e.description)) : label * 0.8;

  let img: number | undefined;
  if (d.imageEmbedding) {
    const emb = graph.embeddingsOf(e.id).find((x) => x.modality === 'image' && x.model === d.imageEmbedding!.model);
    if (emb) img = cosine(d.imageEmbedding.vector, emb.vector);
  }

  let score = img === undefined ? 0.62 * label + 0.38 * desc : 0.35 * label + 0.2 * desc + 0.45 * img;
  if (img !== undefined && img > 0.85) reasons.push('Looks visually identical');

  const ca0 = topCategory(d.category);
  const cb0 = topCategory(e.category);
  if (ca0 && cb0 && ca0 !== cb0) score -= 0.15;

  const a = d.attributes;
  const b = e.attributes;

  const ca = normColors(a.colors);
  const cb = normColors(b.colors);
  if (ca.length && cb.length) {
    const shared = ca.filter((c) => cb.includes(c));
    if (shared.length) {
      score += 0.06;
      reasons.push(`Same colour (${shared[0]})`);
    } else {
      score -= 0.35;
      reasons.push(`Different colour (${ca[0]} vs ${cb[0]})`);
    }
  }

  if (a.brand && b.brand) {
    if (a.brand.toLowerCase() === b.brand.toLowerCase()) {
      score += 0.12;
      reasons.push(`Same brand (${b.brand})`);
    } else {
      score -= 0.5;
      reasons.push(`Different brand (${a.brand} vs ${b.brand})`);
    }
  }

  if (a.model && b.model && a.model.toLowerCase() === b.model.toLowerCase()) {
    score += 0.1;
    reasons.push('Same model');
  }

  if (a.sizeClass && b.sizeClass) {
    const gap = Math.abs(SIZE_ORDER.indexOf(a.sizeClass) - SIZE_ORDER.indexOf(b.sizeClass));
    if (gap >= 2) {
      score -= 0.2;
      reasons.push('Different size');
    }
  }

  if (a.distinguishingMarks.length && b.distinguishingMarks.length) {
    const m = Math.max(...a.distinguishingMarks.flatMap((x) => b.distinguishingMarks.map((y) => tokenOverlap(x, y))));
    if (m > 0.3) {
      score += 0.15;
      reasons.push('Matching distinguishing marks');
    }
  }

  if (d.contextParentId) {
    const belief = computeBelief(graph, e.id, at);
    const parent = belief.primary?.observation.placement?.parentId;
    if (parent === d.contextParentId) {
      score += 0.12;
      reasons.push('Last seen in this same spot');
    } else if (belief.primary) {
      const here = graph.chainFrom(d.contextParentId);
      const { room } = graph.spaceAndRoom(belief.primary.currentChain);
      if (room && here.includes(room.id)) {
        score += 0.04;
        reasons.push('Last seen in this room');
      }
    }
  }

  if (label > 0.6) reasons.unshift('Similar name');
  return { entity: e, score: Math.max(0, Math.min(1, score)), reasons };
}

export function matchDetection(graph: MemoryGraph, d: DetectionDescriptor, at: Date = new Date(), pool?: Entity[]): MatchDecision {
  const candidates = (pool ?? graph.items())
    .map((e) => scoreCandidate(graph, d, e, at))
    .filter((c) => c.score >= 0.3)
    .sort((x, y) => y.score - x.score)
    .slice(0, 5);

  const [top, second] = candidates;
  if (!top || top.score < MATCH_THRESHOLDS.ask) return { kind: 'new', candidates };
  const clearWinner = !second || top.score - second.score >= MATCH_THRESHOLDS.margin;
  if (top.score >= MATCH_THRESHOLDS.same && clearWinner) return { kind: 'same', entity: top.entity, score: top.score, candidates };
  return { kind: 'ask', candidates };
}

/** Is `newEntity` a likely duplicate of an existing one? Used to prompt "Is this the same…?" */
export function findPotentialDuplicates(graph: MemoryGraph, e: Entity): MatchCandidate[] {
  const notSame = new Set(graph.relations((r) => r.type === 'NOT_SAME_AS' && (r.fromId === e.id || r.toId === e.id)).map((r) => (r.fromId === e.id ? r.toId : r.fromId)));
  return graph
    .items()
    .filter((x) => x.id !== e.id && !notSame.has(x.id))
    .map((x) => scoreCandidate(graph, { label: e.name, category: e.category, description: e.description, attributes: e.attributes }, x))
    .filter((c) => c.score >= MATCH_THRESHOLDS.ask)
    .sort((a, b) => b.score - a.score);
}
