import type { Mutation, TableName } from '@/core/graph';
import { emptyGraph, type GraphData } from '@/core/types';

/**
 * Web preview storage (in memory). The product targets iOS/Android, where db.ts uses SQLite.
 * Browsers allow one tab per SQLite file and the preview resets on reload anyway, so the web
 * build keeps everything in memory with the same API — the sync outbox still works, so a
 * signed-in browser session can push to and pull from the cloud (e.g. to test Family).
 */

export interface OutboxRow {
  id: number;
  tbl: TableName;
  key: string;
  op: 'upsert' | 'delete';
  data: string | null;
  attempts: number;
}

export interface QueuedCapture {
  id: string;
  payload: string;
  status: 'queued' | 'failed';
  created_at: string;
  error: string | null;
}

const LOCAL_ONLY = new Set<TableName>(['embeddings']);
let outbox: OutboxRow[] = [];
let nextId = 1;
const kv = new Map<string, string>();
const queue = new Map<string, QueuedCapture>();

export async function getDb(): Promise<null> {
  return null;
}

export async function loadGraph(): Promise<GraphData> {
  return emptyGraph();
}

export async function persistMutations(mutations: Mutation[], opts: { enqueueSync: boolean }): Promise<void> {
  if (!opts.enqueueSync) return;
  for (const m of mutations) {
    if (LOCAL_ONLY.has(m.table)) continue;
    const { keyOf } = await import('@/core/graph');
    outbox.push(
      m.op === 'upsert'
        ? { id: nextId++, tbl: m.table, key: keyOf(m.table, m.row as never), op: 'upsert', data: JSON.stringify(m.row), attempts: 0 }
        : { id: nextId++, tbl: m.table, key: m.key, op: 'delete', data: null, attempts: 0 },
    );
  }
}

export async function peekOutbox(limit = 200): Promise<OutboxRow[]> {
  return outbox.slice(0, limit);
}

export async function ackOutbox(ids: number[]): Promise<void> {
  const s = new Set(ids);
  outbox = outbox.filter((r) => !s.has(r.id));
}

export async function failOutbox(ids: number[]): Promise<void> {
  const s = new Set(ids);
  outbox = outbox.map((r) => (s.has(r.id) ? { ...r, attempts: r.attempts + 1 } : r));
}

export async function outboxCount(): Promise<number> {
  return outbox.length;
}

export async function kvGet(key: string): Promise<string | null> {
  return kv.get(key) ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  kv.set(key, value);
}

export async function enqueueCapture(id: string, payload: unknown): Promise<void> {
  queue.set(id, { id, payload: JSON.stringify(payload), status: 'queued', created_at: new Date().toISOString(), error: null });
}

export async function listQueuedCaptures(): Promise<QueuedCapture[]> {
  return [...queue.values()];
}

export async function removeQueuedCapture(id: string): Promise<void> {
  queue.delete(id);
}

export async function markQueuedCaptureFailed(id: string, error: string): Promise<void> {
  const q = queue.get(id);
  if (q) queue.set(id, { ...q, status: 'failed', error });
}

export async function wipeLocal(): Promise<void> {
  outbox = [];
  kv.clear();
  queue.clear();
}
