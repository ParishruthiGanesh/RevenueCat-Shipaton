-- A member must not be able to change their own role (e.g. viewer → member/owner).
-- Display names are set when joining via join_household(); only the owner manages roles.
drop policy if exists "members update own membership" on public.household_members;
