import type { MemoryGraph, Mutation, TableName } from '@/core/graph';
import { householdForEntity } from '@/core/family';
import { fromRemote } from '@/data/remote';
import { supabase } from './supabase';

/**
 * Family spaces: one household per user (V1), invite codes, roles, and pulling the family's
 * shared memory onto this device. All visibility is enforced server-side by RLS — this module
 * can only ever receive rows the database allows this user to see.
 */

export type FamilyRole = 'owner' | 'member' | 'viewer';

export interface FamilyMember {
  userId: string;
  name: string;
  role: FamilyRole;
  isMe: boolean;
}

export interface Family {
  id: string;
  name: string;
  myRole: FamilyRole;
  members: FamilyMember[];
  inviteCode?: string;
}

function db() {
  const sb = supabase();
  if (!sb) throw new Error('Family needs the cloud backend configured.');
  return sb;
}

async function myId(): Promise<string> {
  const { data } = await db().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Sign in first.');
  return id;
}

export async function loadFamily(): Promise<Family | null> {
  const sb = db();
  const me = await myId();
  const { data: mine, error } = await sb.from('household_members').select('household_id, role').eq('user_id', me).limit(1).maybeSingle();
  if (error) throw error;
  if (!mine) return null;
  const hid = mine.household_id as string;
  const [{ data: h }, { data: members }, { data: invite }] = await Promise.all([
    sb.from('households').select('id, name').eq('id', hid).maybeSingle(),
    sb.from('household_members').select('user_id, role, display_name, joined_at').eq('household_id', hid).order('joined_at'),
    mine.role === 'owner'
      ? sb.from('household_invites').select('code').eq('household_id', hid).eq('revoked', false).order('created_at', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    id: hid,
    name: (h?.name as string) ?? 'Family',
    myRole: mine.role as FamilyRole,
    inviteCode: (invite as { code?: string } | null)?.code,
    members: (members ?? []).map((m, i) => ({
      userId: m.user_id as string,
      name: (m.display_name as string) || (m.user_id === me ? 'You' : `Member ${i + 1}`),
      role: m.role as FamilyRole,
      isMe: m.user_id === me,
    })),
  };
}

export async function createFamily(name: string, displayName?: string): Promise<void> {
  const { error } = await db().rpc('create_household', { p_name: name, p_display_name: displayName ?? null });
  if (error) throw new Error(error.message);
}

export async function joinFamily(code: string, displayName?: string): Promise<void> {
  const { error } = await db().rpc('join_household', { p_code: code.trim().toUpperCase(), p_display_name: displayName ?? null });
  if (error) throw new Error(/invalid|expired/i.test(error.message) ? 'That code is wrong or has expired. Ask for a new one.' : error.message);
}

export async function rotateInvite(householdId: string): Promise<string> {
  const { data, error } = await db().rpc('rotate_household_invite', { p_household: householdId });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function leaveFamily(householdId: string): Promise<void> {
  const { error } = await db().rpc('leave_household', { p_household: householdId });
  if (error) throw new Error(error.message);
}

export async function setMemberRole(householdId: string, userId: string, role: FamilyRole): Promise<void> {
  const { error } = await db().from('household_members').update({ role }).eq('household_id', householdId).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export async function removeMember(householdId: string, userId: string): Promise<void> {
  const { error } = await db().from('household_members').delete().eq('household_id', householdId).eq('user_id', userId);
  if (error) throw new Error(error.message);
}

/**
 * Share (or stop sharing) a space. Re-commits everything inside it so the sync engine pushes
 * the household id; sensitive objects and private zones are excluded by householdForEntity.
 */
export function setSpaceShared(graph: MemoryGraph, spaceId: string, householdId: string | null): Mutation[] {
  const space = graph.entity(spaceId);
  if (!space || space.kind !== 'space') return [];
  graph.commit([{ op: 'upsert', table: 'entities', row: { ...space, householdId: householdId ?? undefined, updatedAt: new Date().toISOString() } }]);
  const touched: Mutation[] = [];
  for (const e of graph.entities((x) => x.id !== spaceId && !x.createdBy)) {
    const inThisSpace = householdForEntity(graph, e) === householdId || (householdId === null && e.kind !== 'space');
    if (!inThisSpace) continue;
    touched.push({ op: 'upsert', table: 'entities', row: { ...e } });
    for (const o of graph.observationsOf(e.id, true)) touched.push({ op: 'upsert', table: 'observations', row: { ...o } });
  }
  graph.commit(touched);
  // Returned so the caller can upload them immediately (the persisted outbox is written asynchronously).
  return [{ op: 'upsert', table: 'entities', row: graph.entity(spaceId)! } as Mutation, ...touched];
}

/** Download the family's shared memory (rows created by other members) into the local graph. */
export async function pullFamily(graph: MemoryGraph, householdId: string): Promise<number> {
  const sb = db();
  const me = await myId();
  const tables: [TableName, string, boolean][] = [
    ['entities', 'entities', true],
    ['observations', 'observations', true],
    ['media', 'media_assets', false],
  ];
  let n = 0;
  for (const [table, remote, byHousehold] of tables) {
    let q = sb.from(remote).select('*').neq('user_id', me).limit(5000);
    if (byHousehold) q = q.eq('household_id', householdId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const muts = (data ?? []).map((r) => ({ op: 'upsert' as const, table, row: fromRemote(table, r, me) as never }));
    graph.commit(muts);
    n += muts.length;
  }
  return n;
}
