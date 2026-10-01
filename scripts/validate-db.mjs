/**
 * Validates the Supabase migrations against real Postgres (PGlite, WASM) with pgvector and
 * pg_trgm, then exercises the security model as different users:
 *   - RLS isolates users completely
 *   - household members see shared items but never sensitive ones or private zones
 *   - observations are append-only evidence
 *   - hybrid search RPC runs
 *
 * Usage: node scripts/validate-db.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { vector } from '@electric-sql/pglite-pgvector';

const db = await PGlite.create({ extensions: { vector, pg_trgm } });
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
};

// ── Minimal Supabase platform stubs (auth, storage, roles) ──
await db.exec(`
  create schema if not exists extensions;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
  create role authenticated nologin;
  create role anon nologin;
`);

const dir = 'supabase/migrations';
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
    ok(true, `migration applied: ${f}`);
  } catch (e) {
    ok(false, `migration failed: ${f}\n     ${e.message}`);
    process.exit(1);
  }
}

await db.exec(`
  grant usage on schema public, extensions, auth, storage to authenticated;
  grant all on all tables in schema public to authenticated;
  grant select on storage.objects to authenticated;
  grant all on all sequences in schema public to authenticated;
  grant execute on all functions in schema public, auth to authenticated;
`);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
await db.exec(`insert into auth.users values ('${A}'), ('${B}');`);

async function as(user, sql, params = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role;`);
  }
}
const uuid = () => crypto.randomUUID();

// ── User A builds a small memory ──
const home = uuid(), drawer = uuid(), passport = uuid(), charger = uuid(), obs = uuid();
await as(A, `insert into entities (id, kind, name, space_type) values ($1, 'space', 'Home', 'home')`, [home]);
await as(A, `insert into entities (id, kind, name, is_container) values ($1, 'container', 'Top drawer', true)`, [drawer]);
await as(A, `insert into entities (id, kind, name, sensitive, category) values ($1, 'item', 'Passport', true, 'documents')`, [passport]);
await as(A, `insert into entities (id, kind, name, description) values ($1, 'item', 'Charger', 'black anker usb-c charger')`, [charger]);
await as(
  A,
  `insert into observations (id, subject_id, type, observed_at, source, evidence, parent_id, relation, chain_snapshot, detection_confidence, match_confidence)
   values ($1, $2, 'sighting', now(), 'camera_capture', 'observed', $3, 'INSIDE', array[$3::uuid, $4::uuid], 0.95, 1)`,
  [obs, passport, drawer, home],
);

console.log('\nRow level security');
ok((await as(A, `select id from entities`)).rows.length === 4, 'owner sees their 4 entities');
ok((await as(B, `select id from entities`)).rows.length === 0, 'another user sees nothing');
ok((await as(B, `select id from observations`)).rows.length === 0, 'another user sees no observations');
let blocked = false;
try {
  await as(B, `insert into entities (id, user_id, kind, name) values ($1, $2, 'item', 'Planted')`, [uuid(), A]);
} catch {
  blocked = true;
}
ok(blocked, 'cannot write rows into someone else’s account');
await as(B, `update entities set name = 'hacked' where id = $1`, [passport]);
ok((await as(A, `select name from entities where id = $1`, [passport])).rows[0].name === 'Passport', 'cannot modify someone else’s rows');

console.log('\nAppend-only evidence');
let immutable = false;
try {
  await as(A, `update observations set observed_at = now() - interval '1 year' where id = $1`, [obs]);
} catch {
  immutable = true;
}
ok(immutable, 'observation timestamps/placements cannot be rewritten');
await as(A, `update observations set verification = 'confirmed' where id = $1`, [obs]);
ok((await as(A, `select verification from observations where id = $1`, [obs])).rows[0].verification === 'confirmed', 'verification status can be updated');

console.log('\nFamily sharing boundaries');
const hh = uuid();
await as(A, `insert into households (id, name, created_by) values ($1, 'Family', $2)`, [hh, A]);
await as(A, `insert into household_members (household_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')`, [hh, A, B]);
await as(A, `update entities set household_id = $1`, [hh]);
await as(A, `update observations set household_id = $1`, [hh]);
const seen = (await as(B, `select name from entities order by name`)).rows.map((r) => r.name);
ok(seen.includes('Charger') && seen.includes('Home'), 'household member sees shared, non-sensitive items');
ok(!seen.includes('Passport'), 'household member does NOT see sensitive items');
ok((await as(B, `select id from observations`)).rows.length === 0, 'household member does NOT see sightings of sensitive items');
await as(A, `update entities set private_zone = true where id = $1`, [drawer]);
ok(!(await as(B, `select name from entities`)).rows.some((r) => r.name === 'Top drawer'), 'private zones are hidden from household members');

console.log('\nFamily invites & photo visibility');
const C = '33333333-3333-4333-8333-333333333333';
await db.exec(`insert into auth.users values ('${C}');`);
const created = (await as(A, `select * from create_household('Ganesh Family', 'Pari')`)).rows[0];
ok(/^[A-Z2-9]{6}$/.test(created.invite_code), 'create_household returns a 6-char invite code');
let badCode = false;
try {
  await as(C, `select * from join_household('ZZZZZZ')`);
} catch {
  badCode = true;
}
ok(badCode, 'a wrong invite code is rejected');
const joined = (await as(C, `select * from join_household($1, 'Revanth')`, [created.invite_code.toLowerCase()])).rows[0];
ok(joined?.household_name === 'Ganesh Family' && joined.role === 'member', 'join_household with the code makes you a member (case-insensitive)');
const media1 = uuid(), media2 = uuid();
await as(A, `insert into media_assets (id, storage_path, width, height, kind) values ($1, $2, 10, 10, 'crop'), ($3, $4, 10, 10, 'crop')`, [media1, `${A}/${media1}.jpg`, media2, `${A}/${media2}.jpg`]);
const sharedItem = uuid();
await as(A, `insert into entities (id, kind, name, household_id) values ($1, 'item', 'Drill', $2)`, [sharedItem, created.household_id]);
await as(
  A,
  `insert into observations (id, subject_id, type, observed_at, source, evidence, parent_id, relation, detection_confidence, match_confidence, media_id, household_id)
   values ($1, $2, 'sighting', now(), 'camera_capture', 'observed', $3, 'INSIDE', 0.9, 1, $4, $5)`,
  [uuid(), sharedItem, home, media1, created.household_id],
);
// The sensitive passport's sighting points at media2 (shared household, but sensitive → hidden).
await as(A, `update entities set household_id = $1 where id = $2`, [created.household_id, passport]);
await as(
  A,
  `insert into observations (id, subject_id, type, observed_at, source, evidence, parent_id, relation, detection_confidence, match_confidence, media_id, household_id)
   values ($1, $2, 'sighting', now(), 'camera_capture', 'observed', $3, 'INSIDE', 0.9, 1, $4, $5)`,
  [uuid(), passport, drawer, media2, created.household_id],
);
const seenMedia = (await as(C, `select id from media_assets`)).rows.map((r) => r.id);
ok(seenMedia.includes(media1), 'family member can see the photo of a shared item');
ok(!seenMedia.includes(media2), 'family member cannot see the photo of a sensitive item');
await db.exec(`insert into storage.objects (bucket_id, name) values ('media', '${A}/${media1}.jpg'), ('media', '${A}/${media2}.jpg')`);
const files = (await as(C, `select name from storage.objects`)).rows.map((r) => r.name);
ok(files.length === 1 && files[0].includes(media1), 'storage: only the shared item’s photo file is readable');
await as(C, `update household_members set role = 'owner' where user_id = $1`, [C]);
ok((await as(C, `select role from household_members where user_id = $1`, [C])).rows[0]?.role === 'member', 'a member cannot promote themselves');
await as(C, `select leave_household($1)`, [created.household_id]);
ok((await as(C, `select id from entities where id = $1`, [sharedItem])).rows.length === 0, 'after leaving, shared items are no longer visible');

console.log('\nSearch & views');
const vec = `[${Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;
await as(A, `insert into entity_embeddings (entity_id, model, modality, embedding) values ($1, 'voyage-multimodal-3', 'image', $2)`, [charger, vec]);
const hits = (await as(A, `select name, score from search_entities('charger', $1::extensions.vector, 5)`, [vec])).rows;
ok(hits[0]?.name === 'Charger', 'hybrid search ranks the right object first');
ok((await as(B, `select * from search_entities('charger', null, 5)`)).rows.every((r) => r.name !== 'Passport'), 'search respects RLS');
ok((await as(A, `select count(*)::int as n from objects`)).rows[0].n === 3, 'objects view (security invoker) works');
ok((await as(A, `select count(*)::int as n from latest_sightings`)).rows[0].n >= 2, 'latest_sightings view works (one per object)');

console.log('\nConstraints');
let rejected = false;
try {
  await as(A, `insert into analytics_events (name, props) values ('Where is my passport', '{}')`);
} catch {
  rejected = true;
}
ok(rejected, 'analytics rejects free-text event names');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll database checks passed');
process.exit(failures ? 1 : 0);
