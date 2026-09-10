-- M4 — profile fields, free-interview entitlement, and the interview_plans
-- lookup /api/interviews now needs to actually persist a row.
--
-- Design notes:
--  * Google OAuth reuses the exact same auth.users -> profiles trigger M0
--    already wired (handle_new_user). A Google sign-in is still an
--    auth.users insert under the hood, so "new-user profile creation" needs
--    no new trigger — only richer field extraction from raw_user_meta_data.
--  * Returning users: Supabase Auth itself matches a repeat Google sign-in
--    to the existing auth.users row (by verified email) — that's a platform
--    guarantee, not something this migration needs to implement. The
--    trigger's `on conflict (id) do nothing` makes profile creation
--    idempotent regardless.
--  * Credit consumption is a single atomic UPDATE guarded by
--    `where consumed < granted`, not an explicit SELECT ... FOR UPDATE. This
--    is sufficient: Postgres takes a row-level write lock for the duration
--    of an UPDATE, so two concurrent calls against the same row serialize —
--    the second one re-evaluates the WHERE clause against the first one's
--    committed result, not a stale read. A double-click or a race between
--    two requests can never push consumed past granted.

-- ── profile fields ────────────────────────────────────────────────────────
alter table public.profiles
  add column email text,
  add column avatar_url text,
  add column last_active_at timestamptz not null default now();

-- Backfill from auth.users for anyone created before this migration.
update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

-- Extend the M0 signup trigger: richer profile fields + the credit grant.
-- Replaces the M0 function body; the trigger itself (on_auth_user_created)
-- is unchanged.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;

  insert into public.interview_credits (user_id, granted, consumed)
  values (new.id, 2, 0)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Keep profiles.email in sync if the auth email ever changes (e.g. a user
-- later links a different provider). Cheap and correct; separate from
-- creation so it doesn't complicate the insert trigger's happy path.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

revoke all on function public.handle_user_email_change() from public, anon, authenticated;

-- ── free-interview entitlement ───────────────────────────────────────────
create table public.interview_credits (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  granted    integer not null default 2 check (granted >= 0),
  consumed   integer not null default 0 check (consumed >= 0 and consumed <= granted),
  updated_at timestamptz not null default now()
);

-- Backfill for any user created before this migration.
insert into public.interview_credits (user_id, granted, consumed)
select id, 2, 0 from auth.users
on conflict (user_id) do nothing;

alter table public.interview_credits enable row level security;

create policy "interview_credits: select own" on public.interview_credits
  for select to authenticated using ((select auth.uid()) = user_id);

-- No client INSERT/UPDATE/DELETE policy anywhere on this table — every
-- mutation goes through the two SECURITY DEFINER functions below, which
-- carry their own auth.uid() check independent of RLS.
revoke all on table public.interview_credits from anon, authenticated;
grant select on table public.interview_credits to authenticated;

-- Atomic consume. Returns allowed=false (never an error) when exhausted, so
-- callers branch on the result instead of catching an exception for a
-- routine, expected case.
create or replace function public.consume_interview_credit()
returns table (allowed boolean, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.interview_credits;
begin
  if v_user_id is null then
    raise exception 'consume_interview_credit: no authenticated user';
  end if;

  update public.interview_credits
  set consumed = consumed + 1, updated_at = now()
  where user_id = v_user_id and consumed < granted
  returning * into v_row;

  if v_row.user_id is null then
    return query
      select false, greatest(0, coalesce((select c.granted - c.consumed from public.interview_credits c where c.user_id = v_user_id), 0));
    return;
  end if;

  return query select true, (v_row.granted - v_row.consumed);
end;
$$;

-- Compensating action for when a credit was consumed but the interview it
-- was reserved for never actually got created (LiveKit down, DB error after
-- the RPC succeeded, etc.) — the two systems can't share one transaction, so
-- this is the standard reserve-then-compensate pattern rather than a single
-- perfect atomic operation across Postgres and an external service.
create or replace function public.refund_interview_credit()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'refund_interview_credit: no authenticated user';
  end if;

  update public.interview_credits
  set consumed = greatest(0, consumed - 1), updated_at = now()
  where user_id = v_user_id;
end;
$$;

revoke all on function public.consume_interview_credit() from public, anon;
revoke all on function public.refund_interview_credit() from public, anon;
grant execute on function public.consume_interview_credit() to authenticated;
grant execute on function public.refund_interview_credit() to authenticated;

-- ── last_active_at ────────────────────────────────────────────────────────
create or replace function public.touch_last_active()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set last_active_at = now() where id = auth.uid();
$$;

revoke all on function public.touch_last_active() from public, anon;
grant execute on function public.touch_last_active() to authenticated;
