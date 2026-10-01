-- ════════════════════════════════════════════════════════════════════════════
-- Family spaces: invite codes, create/join RPCs, and evidence-photo access that follows
-- the existing RLS (members see shared, non-sensitive, non-private-zone items only).
-- ════════════════════════════════════════════════════════════════════════════

create table public.household_invites (
  code text primary key check (code ~ '^[A-Z2-9]{6}$'),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  role public.household_role not null default 'member',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked boolean not null default false
);
alter table public.household_invites enable row level security;
create policy "owner manages invites" on public.household_invites for all
  using (exists (select 1 from public.households h where h.id = household_id and h.created_by = auth.uid()))
  with check (exists (select 1 from public.households h where h.id = household_id and h.created_by = auth.uid()));

create or replace function public.pm_new_invite_code() returns text
language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from household_invites where code = c);
  end loop;
  return c;
end $$;

-- Create a family: the caller becomes owner; returns the household and a member invite code.
create or replace function public.create_household(p_name text, p_display_name text default null)
returns table (household_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  hid uuid;
  code text;
begin
  if uid is null then raise exception 'sign in required'; end if;
  if char_length(coalesce(trim(p_name), '')) = 0 then raise exception 'name required'; end if;
  insert into households (name, created_by) values (trim(p_name), uid) returning id into hid;
  insert into household_members (household_id, user_id, role, display_name) values (hid, uid, 'owner', nullif(trim(p_display_name), ''));
  code := pm_new_invite_code();
  insert into household_invites (code, household_id, created_by, role) values (code, hid, uid, 'member');
  return query select hid, code;
end $$;

-- Join with a code. Free for members: the owner's Pro covers the household.
create or replace function public.join_household(p_code text, p_display_name text default null)
returns table (household_id uuid, household_name text, role public.household_role)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  inv household_invites%rowtype;
begin
  if uid is null then raise exception 'sign in required'; end if;
  select * into inv from household_invites where code = upper(trim(p_code)) and not revoked and expires_at > now();
  if not found then raise exception 'invalid or expired code'; end if;
  insert into household_members (household_id, user_id, role, display_name)
    values (inv.household_id, uid, inv.role, nullif(trim(p_display_name), ''))
    on conflict (household_id, user_id) do update set display_name = coalesce(excluded.display_name, household_members.display_name);
  return query select h.id, h.name, inv.role from households h where h.id = inv.household_id;
end $$;

-- Rotate the invite code (owner only).
create or replace function public.rotate_household_invite(p_household uuid)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not exists (select 1 from households where id = p_household and created_by = auth.uid()) then raise exception 'owner only'; end if;
  update household_invites set revoked = true where household_id = p_household;
  code := pm_new_invite_code();
  insert into household_invites (code, household_id, created_by, role) values (code, p_household, auth.uid(), 'member');
  return code;
end $$;

-- Leave a family (owners delete it instead).
create or replace function public.leave_household(p_household uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from households where id = p_household and created_by = auth.uid()) then
    delete from households where id = p_household;
  else
    delete from household_members where household_id = p_household and user_id = auth.uid();
  end if;
end $$;

grant execute on function public.create_household(text, text), public.join_household(text, text),
  public.rotate_household_invite(uuid), public.leave_household(uuid) to authenticated;

-- Members can update their own display name.
create policy "members update own membership" on public.household_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Evidence photos follow observation visibility: a member can read a media row / file only if
-- an observation they can already see (RLS-filtered subquery) references it.
create policy "household reads visible media" on public.media_assets for select
  using (exists (select 1 from public.observations o where o.media_id = media_assets.id));

create policy "household reads visible media files" on storage.objects for select
  using (
    bucket_id = 'media'
    and exists (
      select 1 from public.observations o
      where o.media_id::text = split_part(storage.filename(name), '.', 1)
    )
  );
