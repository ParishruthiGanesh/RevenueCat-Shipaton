import * as SQLite from 'expo-sqlite';
import { keyOf, type Mutation, type TableName } from '@/core/graph';
import { emptyGraph, type GraphData } from '@/core/types';

/**
 * LOCAL-FIRST PERSISTENCE
 *
 * The on-device SQLite database is the source of truth for the UI. Rows are stored as JSON
 * per table (the relational model lives in Postgres); every committed mutation is written
 * through in a transaction AND appended to an outbox that the sync engine drains when online.
 * Nothing the user captures is lost because the network is unavailable.
 */

const TABLES: TableName[] = ['entities', 'observations', 'relations', 'people', 'loans', 'trips', 'tripItems', 'corrections', 'media', 'embeddings'];
/** Tables that never leave the device (local embeddings are recomputable). */
const LOCAL_ONLY = new Set<TableName>(['embeddings']);

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('physical-memory.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS rows (
          tbl TEXT NOT NULL,
          key TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (tbl, key)
        );
        CREATE TABLE IF NOT EXISTS outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tbl TEXT NOT NULL,
          key TEXT NOT NULL,
          op TEXT NOT NULL CHECK (op IN ('upsert','delete')),
          data TEXT,
          created_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS outbox_order ON outbox (id);
        CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS capture_queue (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          error TEXT
        );
        PRAGMA user_version = 1;
      `);
      return db;
    })();
  }
  return dbPromise;
}

export async function loadGraph(): Promise<GraphData> {
  const db = await getDb();
  const data = emptyGraph();
  const rows = await db.getAllAsync<{ tbl: TableName; data: string }>('SELECT tbl, data FROM rows');
  for (const r of rows) {
    if (!TABLES.includes(r.tbl)) continue;
    try {
      (data[r.tbl] as unknown[]).push(JSON.parse(r.data));
    } catch {
      // A corrupt row must never prevent the app from opening.
    }
  }
  return data;
}

export async function persistMutations(mutations: Mutation[], opts: { enqueueSync: boolean }): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const m of mutations) {
      if (m.op === 'upsert') {
        const key = keyOf(m.table, m.row as never);
        const data = JSON.stringify(m.row);
        await db.runAsync('INSERT OR REPLACE INTO rows (tbl, key, data, updated_at) VALUES (?, ?, ?, ?)', m.table, key, data, now);
        if (opts.enqueueSync && !LOCAL_ONLY.has(m.table)) {
          await db.runAsync('INSERT INTO outbox (tbl, key, op, data, created_at) VALUES (?, ?, ?, ?, ?)', m.table, key, 'upsert', data, now);
        }
      } else {
        await db.runAsync('DELETE FROM rows WHERE tbl = ? AND key = ?', m.table, m.key);
        if (opts.enqueueSync && !LOCAL_ONLY.has(m.table)) {
          await db.runAsync('INSERT INTO outbox (tbl, key, op, data, created_at) VALUES (?, ?, ?, NULL, ?)', m.table, m.key, 'delete', now);
        }
      }
    }
  });
}

export interface OutboxRow {
  id: number;
  tbl: TableName;
  key: string;
  op: 'upsert' | 'delete';
  data: string | null;
  attempts: number;
}

export async function peekOutbox(limit = 200): Promise<OutboxRow[]> {
  const db = await getDb();
  return db.getAllAsync<OutboxRow>('SELECT id, tbl, key, op, data, attempts FROM outbox ORDER BY id LIMIT ?', limit);
}

export async function ackOutbox(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`DELETE FROM outbox WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
}

export async function failOutbox(ids: number[], error: string): Promise<void> {
  if (!ids.length) return;
  const db = await getDb();
  await db.runAsync(`UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id IN (${ids.map(() => '?').join(',')})`, error.slice(0, 500), ...ids);
}

export async function outboxCount(): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM outbox');
  return r?.n ?? 0;
}

export async function kvGet(key: string): Promise<string | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return r?.value ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, value);
}

// ───────────── capture queue: captures taken offline wait here for analysis ─────────────

export interface QueuedCapture {
  id: string;
  payload: string;
  status: 'queued' | 'failed';
  created_at: string;
  error: string | null;
}

export async function enqueueCapture(id: string, payload: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO capture_queue (id, payload, status, created_at) VALUES (?, ?, ?, ?)', id, JSON.stringify(payload), 'queued', new Date().toISOString());
}

export async function listQueuedCaptures(): Promise<QueuedCapture[]> {
  const db = await getDb();
  return db.getAllAsync<QueuedCapture>('SELECT * FROM capture_queue ORDER BY created_at');
}

export async function removeQueuedCapture(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM capture_queue WHERE id = ?', id);
}

export async function markQueuedCaptureFailed(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE capture_queue SET status = ?, error = ? WHERE id = ?', 'failed', error.slice(0, 300), id);
}

/** Erase everything on this device (privacy control). */
export async function wipeLocal(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM rows; DELETE FROM outbox; DELETE FROM capture_queue; DELETE FROM kv;');
}
