import type {
  Correction,
  Entity,
  EntityEmbedding,
  GraphData,
  ID,
  ISODate,
  Loan,
  MediaAsset,
  Observation,
  Person,
  Placement,
  Relation,
  Trip,
  TripItem,
} from './types';
import { emptyGraph } from './types';

/**
 * In-memory index over the user's physical memory.
 *
 * Personal inventories are small enough (10^3–10^5 rows) to reason over entirely in memory,
 * which keeps every query instant and fully offline. Persistence (SQLite on device, Postgres
 * in the cloud) subscribes to committed mutations.
 */

export type TableName =
  | 'entities'
  | 'observations'
  | 'relations'
  | 'people'
  | 'loans'
  | 'trips'
  | 'tripItems'
  | 'corrections'
  | 'media'
  | 'embeddings';

type RowOf = {
  entities: Entity;
  observations: Observation;
  relations: Relation;
  people: Person;
  loans: Loan;
  trips: Trip;
  tripItems: TripItem;
  corrections: Correction;
  media: MediaAsset;
  embeddings: EntityEmbedding;
};

export type Mutation =
  { [T in TableName]: { op: 'upsert'; table: T; row: RowOf[T] } | { op: 'delete'; table: T; key: string } }[TableName];

export function keyOf<T extends TableName>(table: T, row: RowOf[T]): string {
  switch (table) {
    case 'tripItems': {
      const r = row as TripItem;
      return `${r.tripId}:${r.itemId}`;
    }
    case 'embeddings': {
      const r = row as EntityEmbedding;
      return `${r.entityId}:${r.model}:${r.modality}`;
    }
    default:
      return (row as { id: string }).id;
  }
}

const MAX_CHAIN_DEPTH = 16;

export class MemoryGraph {
  private tables: { [T in TableName]: Map<string, RowOf[T]> };
  private obsBySubject = new Map<ID, Observation[]>();
  private listeners = new Set<(m: Mutation[]) => void>();
  /** Increments on every commit; lets UI hooks cheaply detect change. */
  version = 0;

  constructor(data: GraphData = emptyGraph()) {
    this.tables = {
      entities: new Map(),
      observations: new Map(),
      relations: new Map(),
      people: new Map(),
      loans: new Map(),
      trips: new Map(),
      tripItems: new Map(),
      corrections: new Map(),
      media: new Map(),
      embeddings: new Map(),
    };
    (Object.keys(this.tables) as TableName[]).forEach((t) => {
      for (const row of data[t] as RowOf[typeof t][]) this.tables[t].set(keyOf(t, row), row as never);
    });
    this.reindex();
  }

  // ───────────────────────────── mutation plumbing ─────────────────────────────

  subscribe(fn: (m: Mutation[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  commit(mutations: Mutation[]): void {
    if (mutations.length === 0) return;
    let touchedObs = false;
    for (const m of mutations) {
      const table = this.tables[m.table] as Map<string, unknown>;
      if (m.op === 'upsert') table.set(keyOf(m.table, m.row as never), m.row);
      else table.delete(m.key);
      if (m.table === 'observations') touchedObs = true;
    }
    if (touchedObs) this.reindex();
    this.version++;
    this.listeners.forEach((l) => l(mutations));
  }

  snapshot(): GraphData {
    const out = emptyGraph();
    (Object.keys(this.tables) as TableName[]).forEach((t) => {
      (out[t] as unknown[]) = [...this.tables[t].values()];
    });
    return out;
  }

  private reindex(): void {
    this.obsBySubject.clear();
    for (const o of this.tables.observations.values()) {
      const list = this.obsBySubject.get(o.subjectId) ?? [];
      list.push(o);
      this.obsBySubject.set(o.subjectId, list);
    }
    for (const list of this.obsBySubject.values()) {
      list.sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.recordedAt.localeCompare(b.recordedAt));
    }
  }

  // ───────────────────────────── basic accessors ─────────────────────────────

  entity(id: ID | undefined): Entity | undefined {
    return id ? this.tables.entities.get(id) : undefined;
  }

  entities(filter?: (e: Entity) => boolean): Entity[] {
    const all = [...this.tables.entities.values()].filter((e) => !e.archivedAt);
    return filter ? all.filter(filter) : all;
  }

  items(): Entity[] {
    return this.entities((e) => e.kind === 'item');
  }

  spaces(): Entity[] {
    return this.entities((e) => e.kind === 'space');
  }

  observation(id: ID): Observation | undefined {
    return this.tables.observations.get(id);
  }

  allObservations(): Observation[] {
    return [...this.tables.observations.values()];
  }

  /** Non-retracted observations for a subject, oldest → newest. */
  observationsOf(subjectId: ID, includeRetracted = false): Observation[] {
    const list = this.obsBySubject.get(subjectId) ?? [];
    return includeRetracted ? list : list.filter((o) => !o.retracted);
  }

  relations(filter?: (r: Relation) => boolean): Relation[] {
    const all = [...this.tables.relations.values()];
    return filter ? all.filter(filter) : all;
  }

  people(): Person[] {
    return [...this.tables.people.values()];
  }

  person(id: ID | undefined): Person | undefined {
    return id ? this.tables.people.get(id) : undefined;
  }

  loans(): Loan[] {
    return [...this.tables.loans.values()];
  }

  activeLoan(itemId: ID, asOf?: ISODate): Loan | undefined {
    return this.loans()
      .filter((l) => l.itemId === itemId && (!asOf || l.lentAt <= asOf) && (!l.returnedAt || (asOf && l.returnedAt > asOf)))
      .sort((a, b) => b.lentAt.localeCompare(a.lentAt))[0];
  }

  trips(): Trip[] {
    return [...this.tables.trips.values()];
  }

  tripItems(tripId: ID): TripItem[] {
    return [...this.tables.tripItems.values()].filter((t) => t.tripId === tripId);
  }

  corrections(): Correction[] {
    return [...this.tables.corrections.values()];
  }

  media(id: ID | undefined): MediaAsset | undefined {
    return id ? this.tables.media.get(id) : undefined;
  }

  allMedia(): MediaAsset[] {
    return [...this.tables.media.values()];
  }

  embeddingsOf(entityId: ID): EntityEmbedding[] {
    return [...this.tables.embeddings.values()].filter((e) => e.entityId === entityId);
  }

  allEmbeddings(): EntityEmbedding[] {
    return [...this.tables.embeddings.values()];
  }

  // ───────────────────────────── structure ─────────────────────────────

  /**
   * Latest explicit placement of an entity at `asOf`, from the most recent sighting/removal.
   * Used for STRUCTURE (rooms, fixtures, containers, boxes). Item beliefs go through the
   * uncertainty engine instead, which weighs evidence rather than taking the latest row.
   */
  structuralPlacement(entityId: ID, asOf?: ISODate): Placement | null {
    const obs = this.observationsOf(entityId);
    for (let i = obs.length - 1; i >= 0; i--) {
      const o = obs[i];
      if (asOf && o.observedAt > asOf) continue;
      if (o.type === 'absence') continue;
      if (o.type === 'removal') return null;
      return o.placement;
    }
    return null;
  }

  /**
   * Ancestor chain for a placement parent, nearest first, e.g.
   *   pouch → drawer → dresser → bedroom → home
   * Cycle-safe and depth-limited.
   */
  chainFrom(parentId: ID | undefined, asOf?: ISODate): ID[] {
    const chain: ID[] = [];
    const seen = new Set<ID>();
    let cur = parentId;
    while (cur && !seen.has(cur) && chain.length < MAX_CHAIN_DEPTH) {
      seen.add(cur);
      chain.push(cur);
      const e = this.entity(cur);
      if (!e || e.kind === 'space') break;
      cur = this.structuralPlacement(cur, asOf)?.parentId;
    }
    return chain;
  }

  /** The space and room an entity resolves to via a chain. */
  spaceAndRoom(chain: ID[]): { space?: Entity; room?: Entity } {
    let space: Entity | undefined;
    let room: Entity | undefined;
    for (const id of chain) {
      const e = this.entity(id);
      if (!e) continue;
      if (!room && e.kind === 'room') room = e;
      if (e.kind === 'space') space = e;
    }
    return { space, room };
  }

  /** True if `ancestorId` appears in the structural chain above `entityId`. */
  isWithin(entityId: ID, ancestorId: ID, asOf?: ISODate): boolean {
    const p = this.structuralPlacement(entityId, asOf);
    return p ? this.chainFrom(p.parentId, asOf).includes(ancestorId) : false;
  }

  /** Structural (non-item) children of a node — rooms in a space, drawers in a dresser… */
  structuralChildren(parentId: ID, asOf?: ISODate): Entity[] {
    return this.entities((e) => e.kind !== 'item' && e.kind !== 'space' && this.structuralPlacement(e.id, asOf)?.parentId === parentId);
  }

  /** Is this entity inside a private zone (itself or any ancestor)? */
  inPrivateZone(chain: ID[]): boolean {
    return chain.some((id) => this.entity(id)?.privateZone);
  }

  /** Human-readable path, outermost first: "Home › Bedroom › Black dresser › Top drawer". */
  pathLabel(chain: ID[], separator = ' › '): string {
    return [...chain]
      .reverse()
      .map((id) => this.entity(id)?.name ?? 'Unknown')
      .join(separator);
  }
}
