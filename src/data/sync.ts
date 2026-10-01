import { File } from 'expo-file-system';
import type { MemoryGraph, TableName } from '@/core/graph';
import type { Entity, MediaAsset, Observation } from '@/core/types';
import { householdForEntity, householdForObservation } from '@/core/family';
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

/** Drain the whole outbox, batch after batch, stopping at the first error (reported, not swallowed). */
let inflight: Promise<SyncResult> | null = null;

/** Rows to upload directly (not via the persisted outbox), e.g. everything in a newly shared space. */
export interface DirectRow {
  table: TableName;
  key: string;
  row: unknown;
}

export async function pushOutbox(graph: MemoryGraph, direct: DirectRow[] = []): Promise<SyncResult> {
  // If a sync is already running, wait for it, then run again so the caller's changes are included.
  if (inflight) {
    await inflight.catch(() => undefined);
    if (inflight) await inflight.catch(() => undefined);
  }
  inflight = pushOutboxNow(graph, direct);
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

async function pushOutboxNow(graph: MemoryGraph, direct: DirectRow[]): Promise<SyncResult> {
  const sb = supabase();
  if (!sb || running) return { pushed: 0, failed: 0 };
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) return { pushed: 0, failed: 0, error: 'not_signed_in' };
  running = true;
  const total: SyncResult = { pushed: 0, failed: 0 };
  try {
    for (let i = 0; i < 100; i++) {
      const r = await pushBatch(graph, sb, uid, i === 0 ? direct : []);
      total.pushed += r.pushed;
      total.failed += r.failed;
      if (r.error) {
        console.warn('[sync] push failed:', r.error);
        return { ...total, error: r.error };
      }
      if (r.done) break;
    }
    return total;
  } finally {
    running = false;
  }
}

async function pushBatch(graph: MemoryGraph, sb: NonNullable<ReturnType<typeof supabase>>, uid: string, direct: DirectRow[] = []): Promise<SyncResult & { done?: boolean }> {
  let pushed = 0;
  let failed = 0;
  {
    const rows = await peekOutbox(300);
    if (rows.length === 0 && direct.length === 0) return { pushed, failed, done: true };
    // Collapse to the latest op per (table, key) and push in dependency order.
    const latest = new Map<string, OutboxRow>();
    for (const r of rows) latest.set(`${r.tbl}|${r.key}`, r);
    for (const d of direct) latest.set(`${d.table}|${d.key}`, { id: -1, tbl: d.table, key: d.key, op: 'upsert', data: JSON.stringify(d.row), attempts: 0 });
    // Referential closure: a sighting needs its subject, its place and its photo in the cloud first.
    // Pull the current local copies of those rows into this batch (they may be queued in a later
    // batch, or were created before sync was on). Sightings whose subject no longer exists are dropped.
    const addRow = (tbl: TableName, key: string, row: unknown) => {
      if (!latest.has(`${tbl}|${key}`)) latest.set(`${tbl}|${key}`, { id: -1, tbl, key, op: 'upsert', data: JSON.stringify(row), attempts: 0 });
    };
    // Iterate to a fixed point: sightings pull in entities; structural entities (rooms, furniture,
    // compartments, boxes) pull in their own placement sightings, so the whole chain up to the
    // space arrives together and family members can see where things are.
    for (let pass = 0, before = -1; pass < 8 && before !== latest.size; pass++) {
      before = latest.size;
      for (const r of [...latest.values()]) {
        if (r.tbl !== 'observations' || r.op !== 'upsert' || !r.data) continue;
        const o = JSON.parse(r.data) as Observation;
        const subject = graph.entity(o.subjectId);
        if (!subject) {
          latest.delete(`observations|${r.key}`);
          continue;
        }
        for (const id of [o.subjectId, o.placement?.parentId, ...o.chainSnapshot]) {
          const e = id ? graph.entity(id) : undefined;
          if (e && !e.createdBy) addRow('entities', e.id, e);
        }
        const m = o.mediaId ? graph.media(o.mediaId) : undefined;
        if (m) addRow('media', m.id, m);
        else if (o.mediaId) latest.set(`observations|${r.key}`, { ...r, data: JSON.stringify({ ...o, mediaId: undefined }) });
      }
      for (const r of [...latest.values()]) {
        if (r.tbl !== 'entities' || r.op !== 'upsert' || !r.data) continue;
        const e = graph.entity(r.key);
        if (!e || e.createdBy || e.kind === 'space' || e.kind === 'item') continue;
        for (const o of graph.observationsOf(e.id)) if (o.type !== 'absence') addRow('observations', o.id, o);
      }
    }
    for (const r of [...latest.values()]) {
      if (r.tbl !== 'entities' || r.op !== 'upsert' || !r.data) continue;
      const e = JSON.parse(r.data) as Entity;
      const cover = e.coverMediaId ? graph.media(e.coverMediaId) : undefined;
      if (cover) addRow('media', cover.id, cover);
      else if (e.coverMediaId) latest.set(`entities|${r.key}`, { ...r, data: JSON.stringify({ ...e, coverMediaId: undefined }) });
      const owner = e.ownerId ? graph.person(e.ownerId) : undefined;
      if (owner) addRow('people', owner.id, owner);
    }
    for (const r of [...latest.values()]) {
      if (r.tbl !== 'media' || r.op !== 'upsert' || !r.data) continue;
      const m = JSON.parse(r.data) as MediaAsset;
      const parent = m.parentMediaId ? graph.media(m.parentMediaId) : undefined;
      if (parent) addRow('media', parent.id, parent);
      else if (m.parentMediaId) latest.set(`media|${r.key}`, { ...r, data: JSON.stringify({ ...m, parentMediaId: undefined }) });
    }
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
        const household = (t: TableName, row: unknown) =>
          t === 'entities' ? householdForEntity(graph, graph.entity((row as Entity).id) ?? (row as Entity)) : t === 'observations' ? householdForObservation(graph, row as Observation) : null;
        for (const r of upserts) {
          let row = JSON.parse(r.data!);
          // Rows that came from family members belong to them; never push them as ours.
          if ((row as { createdBy?: string }).createdBy && (row as { createdBy?: string }).createdBy !== uid) continue;
          if (table === 'media' && (row as MediaAsset).remotePath && !(row as MediaAsset).remotePath!.startsWith(`${uid}/`)) continue;
          if (table === 'media' && !row.remotePath) {
            const path = await uploadMedia(uid, row as MediaAsset);
            if (path) {
              row = { ...row, remotePath: path };
              graph.commit([{ op: 'upsert', table: 'media', row }]);
            }
          }
          const mapped = toRemote(table, row, uid, household);
          if (mapped) payload.push(mapped);
        }
        const conflict = table === 'tripItems' ? 'trip_id,item_id' : 'id';
        const { error } = payload.length ? await sb.from(remote).upsert(payload, { onConflict: conflict }) : { error: null };
        if (error && table === 'observations') {
          // One bad sighting must not block everyone else's: retry row by row, skip and report failures.
          for (const row of payload) {
            const { error: rowErr } = await sb.from(remote).upsert([row], { onConflict: conflict });
            if (rowErr) {
              failed++;
              const subject = graph.entity(String(row.subject_id));
              console.warn(
                `[sync] skipped sighting ${row.id}: ${rowErr.message} — subject ${row.subject_id} (${subject ? `${subject.kind} "${subject.name}"${subject.createdBy ? ' from family' : ''}` : 'not on this device'}), parent ${row.parent_id}`,
              );
            } else pushed++;
          }
        } else if (error) {
          failed += upserts.length;
          console.warn(`[sync] ${remote} upload failed:`, error.message);
          await failOutbox(upserts.map((r) => r.id), error.message);
          return { pushed, failed, error: error.message };
        } else {
          pushed += payload.length;
        }
      }

      for (const d of deletes.filter((x) => !graph.entity(x.key)?.createdBy)) {
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
    return { pushed, failed, done: rows.length < 300 };
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
    const { data: s } = await sb.auth.getSession();
    const mutations = (data ?? []).map((r) => ({ op: 'upsert' as const, table, row: fromRemote(table, r, s.session?.user.id) as never }));
    graph.commit(mutations);
    await persistMutations(mutations, { enqueueSync: false });
    n += mutations.length;
  }
  return n;
}
