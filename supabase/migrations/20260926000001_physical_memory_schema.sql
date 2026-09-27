-- ════════════════════════════════════════════════════════════════════════════
-- Physical Memory — core schema
--
-- A temporal physical knowledge graph:
--   entities      nodes (space | room | fixture | container | item)
--   observations  append-only evidence of where an entity was (sighting | absence | removal)
--   relations     non-spatial facts with validity intervals (PART_OF, BELONGS_TO, LENT_TO…)
--
-- Location is never a column: it is derived from observations with confidence.
-- Every row is private to its owner (RLS). Household sharing is explicit and never exposes
-- sensitive objects or private zones to other members.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ─────────────────────────────── households (family mode) ───────────────────────────────

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create type public.household_role as enum ('owner', 'member', 'viewer');

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.household_role not null default 'member',
  display_name text,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create or replace function public.is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from household_members where household_id = hid and user_id = auth.uid());
$$;

create or replace function public.can_write_household(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from household_members where household_id = hid and user_id = auth.uid() and role in ('owner', 'member'));
$$;

-- ─────────────────────────────── people ───────────────────────────────

create type public.person_relationship as enum ('self', 'partner', 'roommate', 'child', 'parent', 'family', 'friend', 'work', 'other');

create table public.people (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  relationship public.person_relationship not null default 'other',
  created_at timestamptz not null default now()
);

-- ─────────────────────────────── entities ───────────────────────────────

-- Immutable wrapper so the search document can be a stored generated column.
create or replace function public.pm_search_document(n text, c text, d text, a text[])
returns tsvector language sql immutable parallel safe as $$
  select to_tsvector('simple'::regconfig, coalesce(n, '') || ' ' || coalesce(c, '') || ' ' || coalesce(d, '') || ' ' || coalesce(array_to_string(a, ' '), ''))
$$;

create type public.entity_kind as enum ('space', 'room', 'fixture', 'container', 'item');
create type public.space_type as enum ('home', 'office', 'dorm', 'family_home', 'storage_unit', 'garage', 'lab', 'workshop', 'vehicle', 'travel', 'other');
create type public.mobility as enum ('high', 'medium', 'low', 'static');

create table public.entities (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  kind public.entity_kind not null,
  name text not null check (char_length(name) between 1 and 120),
  category text,
  description text check (description is null or char_length(description) <= 1000),
  attributes jsonb not null default '{"colors":[],"distinguishingMarks":[]}'::jsonb,
  aliases text[] not null default '{}',
  is_container boolean not null default false,
  space_type public.space_type,
  owner_person_id uuid references public.people(id) on delete set null,
  sensitive boolean not null default false,
  private_zone boolean not null default false,
  mobility public.mobility,
  box_number int,
  box_code text unique,
  box_category text,
  box_sealed_at timestamptz,
  cover_media_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  search_text tsvector generated always as (public.pm_search_document(name, category, description, aliases)) stored,
  constraint space_has_type check (kind <> 'space' or space_type is not null),
  constraint box_fields check ((box_number is null) = (box_code is null))
);

create index entities_user_kind on public.entities (user_id, kind) where archived_at is null;
create index entities_household on public.entities (household_id) where household_id is not null;
create index entities_search on public.entities using gin (search_text);
create index entities_name_trgm on public.entities using gin (name extensions.gin_trgm_ops);
create unique index entities_box_number on public.entities (user_id, box_number) where box_number is not null;

-- ─────────────────────────────── media ───────────────────────────────

create table public.media_assets (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Object path in the private `media` bucket: <user_id>/<id>.jpg
  storage_path text,
  width int not null,
  height int not null,
  kind text not null check (kind in ('frame', 'crop')),
  parent_media_id uuid references public.media_assets(id) on delete set null,
  contains_people boolean not null default false,
  created_at timestamptz not null default now(),
  constraint storage_path_is_owned check (storage_path is null or storage_path like (user_id::text || '/%'))
);

alter table public.entities add constraint entities_cover_media_fk foreign key (cover_media_id) references public.media_assets(id) on delete set null;

-- ─────────────────────────────── captures (pipeline runs) ───────────────────────────────

create table public.captures (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mode text not null check (mode in ('remember', 'scan', 'box')),
  status text not null check (status in ('queued', 'analyzing', 'needs_review', 'saved', 'failed', 'discarded')),
  -- Structured model output kept for audit/learning. Never contains OCR text of sensitive items.
  analysis jsonb,
  model text,
  device_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ─────────────────────────────── observations (append-only) ───────────────────────────────

create type public.observation_type as enum ('sighting', 'absence', 'removal');
create type public.observation_source as enum ('camera_capture', 'area_scan', 'box_scan', 'qr_scan', 'voice_statement', 'manual', 'setup', 'passive', 'tracker');
create type public.evidence_kind as enum ('observed', 'user_stated', 'inferred');
create type public.verification_status as enum ('unverified', 'confirmed', 'corrected', 'rejected');
create type public.placement_relation as enum ('INSIDE', 'ON_TOP_OF', 'UNDER', 'NEXT_TO', 'ATTACHED_TO', 'LOCATED_IN');

create table public.observations (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  subject_id uuid not null references public.entities(id) on delete cascade,
  type public.observation_type not null,
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  source public.observation_source not null,
  evidence public.evidence_kind not null,
  parent_id uuid references public.entities(id) on delete set null,
  relation public.placement_relation,
  -- Ancestor chain at observation time (nearest first) so history survives restructuring.
  chain_snapshot uuid[] not null default '{}',
  capture_id uuid references public.captures(id) on delete set null,
  media_id uuid references public.media_assets(id) on delete set null,
  bbox jsonb,
  detection_confidence real not null check (detection_confidence between 0 and 1),
  match_confidence real not null check (match_confidence between 0 and 1),
  detected_label text,
  verified_label text,
  verification public.verification_status not null default 'unverified',
  retracted boolean not null default false,
  device_id text,
  note text,
  constraint placement_pair check ((parent_id is null) = (relation is null)),
  constraint sighting_has_place check (type <> 'sighting' or parent_id is not null)
);

create index observations_subject_time on public.observations (subject_id, observed_at desc);
create index observations_parent_time on public.observations (parent_id, observed_at desc) where parent_id is not null;
create index observations_user_time on public.observations (user_id, observed_at desc);

-- Observations are append-only: the only permitted updates are verification/retraction and
-- identity merges (subject_id). Everything else is immutable evidence.
create or replace function public.observations_guard()
returns trigger language plpgsql as $$
begin
  if new.observed_at <> old.observed_at or new.source <> old.source or new.type <> old.type
     or new.parent_id is distinct from old.parent_id or new.evidence <> old.evidence
     or new.detection_confidence <> old.detection_confidence or new.media_id is distinct from old.media_id then
    raise exception 'observations are append-only evidence; only verification, labels and identity may change';
  end if;
  return new;
end $$;

create trigger observations_append_only before update on public.observations
  for each row execute function public.observations_guard();

-- ─────────────────────────────── relations ───────────────────────────────

create type public.relation_type as enum ('PART_OF', 'BELONGS_TO', 'LENT_TO', 'LAST_SEEN_WITH', 'SAME_AS_CANDIDATE', 'NOT_SAME_AS');

create table public.relations (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_id uuid not null,
  type public.relation_type not null,
  to_id uuid not null,
  valid_from timestamptz not null,
  valid_to timestamptz,
  source public.observation_source not null,
  confidence real not null default 1 check (confidence between 0 and 1),
  constraint valid_interval check (valid_to is null or valid_to >= valid_from)
);
create index relations_from on public.relations (from_id, type);
create index relations_to on public.relations (to_id, type);

-- ─────────────────────────────── loans & trips ───────────────────────────────

create table public.loans (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id uuid not null references public.entities(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  lent_at timestamptz not null,
  expected_return_at timestamptz,
  returned_at timestamptz,
  note text,
  constraint returned_after_lent check (returned_at is null or returned_at >= lent_at)
);
create index loans_open on public.loans (user_id) where returned_at is null;

create table public.trips (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  departs_at timestamptz,
  returns_at timestamptz,
  bag_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create type public.trip_item_state as enum ('packed', 'not_packed', 'needs_confirmation', 'arrived', 'left_behind');

create table public.trip_items (
  trip_id uuid not null references public.trips(id) on delete cascade,
  item_id uuid not null references public.entities(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  state public.trip_item_state not null default 'not_packed',
  updated_at timestamptz not null default now(),
  primary key (trip_id, item_id)
);

-- ─────────────────────────────── learning signal ───────────────────────────────

create table public.corrections (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete cascade,
  observation_id uuid references public.observations(id) on delete set null,
  field text not null check (field in ('label', 'category', 'placement', 'identity', 'attributes', 'room')),
  ai_value text not null,
  user_value text not null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────── embeddings ───────────────────────────────

-- Provider embeddings (Voyage multimodal, 1024-d) for visual re-identification and semantic
-- search. The on-device hashed embedding is recomputable and never synced.
create table public.entity_embeddings (
  entity_id uuid not null references public.entities(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  model text not null,
  modality text not null check (modality in ('text', 'image')),
  embedding extensions.vector(1024) not null,
  updated_at timestamptz not null default now(),
  primary key (entity_id, model, modality)
);
create index entity_embeddings_hnsw on public.entity_embeddings using hnsw (embedding extensions.vector_cosine_ops);

-- Visual signatures of rooms (V2 room recognition).
create table public.location_embeddings (
  entity_id uuid not null references public.entities(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  model text not null,
  media_id uuid references public.media_assets(id) on delete set null,
  embedding extensions.vector(1024) not null,
  created_at timestamptz not null default now(),
  primary key (entity_id, model, created_at)
);
create index location_embeddings_hnsw on public.location_embeddings using hnsw (embedding extensions.vector_cosine_ops);

-- ─────────────────────────────── subscriptions, usage, notifications, analytics ───────────────────────────────

create table public.subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement text not null,
  is_active boolean not null,
  product_id text,
  store text,
  period_type text,
  expires_at timestamptz,
  will_renew boolean,
  last_event text,
  updated_at timestamptz not null default now(),
  primary key (user_id, entitlement)
);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('scene', 'interpret', 'embed')),
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index ai_usage_month on public.ai_usage (user_id, kind, created_at desc);

create table public.notification_events (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null,
  entity_id uuid references public.entities(id) on delete cascade,
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  primary key (user_id, id)
);

-- Privacy-respecting product analytics: event names + coarse numeric props. Never object names.
create table public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (name ~ '^[a-z_]{3,48}$'),
  props jsonb not null default '{}' check (pg_column_size(props) < 2048),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────── row level security ───────────────────────────────

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.people enable row level security;
alter table public.entities enable row level security;
alter table public.media_assets enable row level security;
alter table public.captures enable row level security;
alter table public.observations enable row level security;
alter table public.relations enable row level security;
alter table public.loans enable row level security;
alter table public.trips enable row level security;
alter table public.trip_items enable row level security;
alter table public.corrections enable row level security;
alter table public.entity_embeddings enable row level security;
alter table public.location_embeddings enable row level security;
alter table public.subscriptions enable row level security;
alter table public.ai_usage enable row level security;
alter table public.notification_events enable row level security;
alter table public.analytics_events enable row level security;

-- Households
create policy "members read household" on public.households for select using (public.is_household_member(id) or created_by = auth.uid());
create policy "create household" on public.households for insert with check (created_by = auth.uid());
create policy "owner updates household" on public.households for update using (created_by = auth.uid());
create policy "owner deletes household" on public.households for delete using (created_by = auth.uid());
create policy "members read membership" on public.household_members for select using (public.is_household_member(household_id));
create policy "owner manages membership" on public.household_members for all
  using (exists (select 1 from public.households h where h.id = household_id and h.created_by = auth.uid()))
  with check (exists (select 1 from public.households h where h.id = household_id and h.created_by = auth.uid()));

-- Owner-only tables
create policy "own rows" on public.media_assets for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.captures for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.relations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.loans for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.trips for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.trip_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.corrections for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.entity_embeddings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.location_embeddings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on public.notification_events for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "insert own events" on public.analytics_events for insert with check (user_id = auth.uid());
-- Subscriptions and AI usage are written only by service-role functions; users may read their own.
create policy "read own subscription" on public.subscriptions for select using (user_id = auth.uid());
create policy "read own usage" on public.ai_usage for select using (user_id = auth.uid());

-- People: owner + household members can read shared people
create policy "own people" on public.people for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "household reads people" on public.people for select using (household_id is not null and public.is_household_member(household_id));

-- Entities: private by default. Household members see shared, NON-sensitive, non-private-zone entities.
create policy "own entities" on public.entities for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "household reads shared entities" on public.entities for select
  using (household_id is not null and not sensitive and not private_zone and public.is_household_member(household_id));
create policy "household writers add entities" on public.entities for insert
  with check (household_id is not null and user_id = auth.uid() and public.can_write_household(household_id));

-- Observations follow their subject's visibility.
create policy "own observations" on public.observations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "household reads shared observations" on public.observations for select
  using (
    household_id is not null and public.is_household_member(household_id)
    and exists (select 1 from public.entities e where e.id = subject_id and not e.sensitive and not e.private_zone)
  );

-- ─────────────────────────────── convenience views (security invoker → RLS applies) ───────────────────────────────

create view public.spaces with (security_invoker = true) as select * from public.entities where kind = 'space' and archived_at is null;
create view public.rooms with (security_invoker = true) as select * from public.entities where kind = 'room' and archived_at is null;
create view public.containers with (security_invoker = true) as select * from public.entities where kind in ('fixture', 'container') and archived_at is null;
create view public.objects with (security_invoker = true) as select * from public.entities where kind = 'item' and archived_at is null;
create view public.storage_boxes with (security_invoker = true) as select * from public.entities where box_code is not null and archived_at is null;
create view public.object_aliases with (security_invoker = true) as select id as entity_id, unnest(aliases) as alias from public.entities;

-- Latest sighting per subject (raw evidence; confidence is computed by the uncertainty engine).
create view public.latest_sightings with (security_invoker = true) as
select distinct on (subject_id) *
from public.observations
where type = 'sighting' and not retracted and verification <> 'rejected'
order by subject_id, observed_at desc;

-- ─────────────────────────────── hybrid search RPC ───────────────────────────────

-- Vector + full-text hybrid retrieval over the caller's (RLS-visible) entities.
create or replace function public.search_entities(query_text text, query_embedding extensions.vector(1024) default null, match_count int default 20)
returns table (entity_id uuid, name text, lexical real, semantic real, score real)
language sql stable security invoker set search_path = public, extensions as $$
  with lex as (
    select e.id, ts_rank(e.search_text, plainto_tsquery('simple', query_text))::real as r,
           similarity(e.name, query_text)::real as sim
    from entities e
    where e.kind = 'item' and e.archived_at is null
  ),
  sem as (
    select ee.entity_id as id, max(1 - (ee.embedding <=> query_embedding))::real as s
    from entity_embeddings ee
    where query_embedding is not null
    group by ee.entity_id
  )
  select e.id, e.name,
         greatest(coalesce(l.r, 0), coalesce(l.sim, 0)) as lexical,
         coalesce(s.s, 0) as semantic,
         (0.55 * greatest(coalesce(l.r, 0), coalesce(l.sim, 0)) + 0.45 * coalesce(s.s, 0))::real as score
  from entities e
  left join lex l on l.id = e.id
  left join sem s on s.id = e.id
  where e.kind = 'item' and e.archived_at is null
    and (coalesce(l.r, 0) > 0 or coalesce(l.sim, 0) > 0.2 or coalesce(s.s, 0) > 0.3)
  order by score desc
  limit match_count;
$$;

-- ─────────────────────────────── storage ───────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "users read own media" on storage.objects for select
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users write own media" on storage.objects for insert
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own media" on storage.objects for delete
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ─────────────────────────────── updated_at ───────────────────────────────

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger entities_touch before update on public.entities for each row execute function public.touch_updated_at();
