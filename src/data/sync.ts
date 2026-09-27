import { File } from 'expo-file-system';
import type { MemoryGraph, TableName } from '@/core/graph';
import type { MediaAsset } from '@/core/types';
import { supabase } from '@/services/supabase';
import { ackOutbox, failOutbox, peekOutbox, persistMutations, type OutboxRow } from './db';
import { fromRemote, PUSH_ORDER, remoteKey, REMOTE_TABLE, toRemote } from './remote';

/**
 * SYNC ENGINE (Pro: encrypted cloud backup & multi-device)
 *
 * Push: drain the local outbox in dependency order. Media files upload to the private
 * `media/<uid>/` bucket before rows that reference them. Idempotent upserts — safe to retry.
 * Pull: hydrate a fresh device from the cloud (restore).
 * Transport is TLS; storage is encrypted at rest by the platform; RLS scopes every row.
 */

export interface SyncResult {
  pushed: number;
  failed: number;
  error?: string;
}

let running = false;

async function uploadMedia(uid: string, m: MediaAsset): Promise<string | null> {
  const sb = supabase();
  if (!sb || !m.localUri) return null;
  const path = `${uid}/${m.id}.jpg`;
  const file = new File(m.localUri);
  if (!file.exists) return null;
  const bytes = await file.bytes();
  const { error } = await sb.storage.from('media').upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  return path;
}

export async function pushOutbox(graph: MemoryGraph): Promise<SyncResult> {
  const sb = supabase();
  if (!sb || running) return { pushed: 0, failed: 0 };
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return { pushed: 0, failed: 0, error: 'not_signed_in' };
  running = true;
  let pushed = 0;
  let failed = 0;
  try {
    const rows = await peekOutbox(300);
    // Collapse to the latest op per (table, key) and push in dependency order.
    const latest = new Map<string, OutboxRow>();
    for (const r of rows) latest.set(`${r.tbl}|${r.key}`, r);
    const byTable = new Map<TableName, OutboxRow[]>();
    for (const r of latest.values()) byTable.set(r.tbl, [...(byTable.get(r.tbl) ?? []), r]);
    const allIds = rows.map((r) => r.id);

    for (const table of PUSH_ORDER) {
      const group = byTable.get(table);
      const remote = REMOTE_TABLE[table];
      if (!group?.length || !remote) continue;
      const upserts = group.filter((r) => r.op === 'upsert' && r.data);
      const deletes = group.filter((r) => r.op === 'delete');

      if (upserts.length) {
        const payload = [];
        for (const r of upserts) {
          let row = JSON.parse(r.data!);
          if (table === 'media' && !row.remotePath) {
            const path = await uploadMedia(uid, row as MediaAsset);
            if (path) {
              row = { ...row, remotePath: path };
              graph.commit([{ op: 'upsert', table: 'media', row }]);
            }
          }
          const mapped = toRemote(table, row, uid);
          if (mapped) payload.push(mapped);
        }
        const conflict = table === 'tripItems' ? 'trip_id,item_id' : 'id';
        const { error } = await sb.from(remote).upsert(payload, { onConflict: conflict });
        if (error) {
          failed += upserts.length;
          await failOutbox(upserts.map((r) => r.id), error.message);
          return { pushed, failed, error: error.message };
        }
        pushed += upserts.length;
      }

      for (const d of deletes) {
        let q = sb.from(remote).delete();
        for (const [k, v] of Object.entries(remoteKey(table, d.key))) q = q.eq(k, v as string);
        const { error } = await q;
        if (error) {
          failed++;
          await failOutbox([d.id], error.message);
          return { pushed, failed, error: error.message };
        }
        if (table === 'media') await sb.storage.from('media').remove([`${uid}/${d.key}.jpg`]);
        pushed++;
      }
    }
    await ackOutbox(allIds);
    return { pushed, failed };
  } finally {
    running = false;
  }
}

/** Restore the full memory graph from the cloud onto this device. */
export async function pullAll(graph: MemoryGraph): Promise<number> {
  const sb = supabase();
  if (!sb) return 0;
  let n = 0;
  for (const table of PUSH_ORDER) {
    const remote = REMOTE_TABLE[table];
    if (!remote) continue;
    const { data, error } = await sb.from(remote).select('*').limit(10000);
    if (error) throw error;
    const mutations = (data ?? []).map((r) => ({ op: 'upsert' as const, table, row: fromRemote(table, r) as never }));
    graph.commit(mutations);
    await persistMutations(mutations, { enqueueSync: false });
    n += mutations.length;
  }
  return n;
}
