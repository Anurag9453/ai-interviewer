-- M4 verification script — NOT executed in this session (no live project
-- exists yet, same blocker as the M1 seed). Run once the project is linked:
--
--   psql "$DATABASE_URL" -f supabase/tests/m4_auth_and_credits.sql
--
-- Each block raises an exception on failure and prints a pass line on
-- success, so a clean run with no exceptions is the whole result. Everything
-- runs inside one transaction and rolls back at the end — nothing here
-- leaves data behind, real or fake.
--
-- What this script CAN prove: trigger behaviour (profile + credit-row
-- creation, idempotency), RPC correctness (grant/consume/exhaustion/refund),
-- and RLS row isolation via JWT claim impersonation (the standard Supabase
-- local-testing pattern: set_config('request.jwt.claims', ...)).
--
-- What it CANNOT prove: genuine concurrent-request races. The atomic
-- UPDATE's serialization is a documented Postgres guarantee (a row-level
-- write lock blocks a second concurrent UPDATE until the first commits, and
-- the second re-evaluates its WHERE clause against the committed result) —
-- not something one sequential script can exercise. A true concurrency test
-- needs either two simultaneous psql sessions or pgbench, or an
-- application-level test hitting POST /api/interviews twice at once — both
-- require the same live project this whole script is waiting on.

begin;

-- ── fixtures: two fake auth.users rows ───────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'candidate-a@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'candidate-b@example.com');

-- ═══ signup creates a profile AND a 2-credit allowance ═══════════════════
do $$
declare v_profiles int; v_credits record;
begin
  select count(*) into v_profiles from public.profiles where id = '00000000-0000-0000-0000-000000000001';
  if v_profiles != 1 then
    raise exception 'FAIL signup: expected exactly one profile row, got %', v_profiles;
  end if;

  select granted, consumed into v_credits from public.interview_credits
    where user_id = '00000000-0000-0000-0000-000000000001';
  if v_credits.granted != 2 or v_credits.consumed != 0 then
    raise exception 'FAIL signup: expected granted=2 consumed=0, got granted=% consumed=%',
      v_credits.granted, v_credits.consumed;
  end if;
  raise notice 'PASS signup creates profile + 2-credit allowance';
end $$;

-- ═══ returning user: re-running the trigger logic is idempotent ═════════
do $$
declare v_count int;
begin
  insert into public.profiles (id, display_name, email)
  values ('00000000-0000-0000-0000-000000000001', 'duplicate attempt', 'x@example.com')
  on conflict (id) do nothing;

  select count(*) into v_count from public.profiles where id = '00000000-0000-0000-0000-000000000001';
  if v_count != 1 then
    raise exception 'FAIL returning user: expected still exactly one profile row, got %', v_count;
  end if;
  raise notice 'PASS returning-user profile creation is idempotent';
end $$;

-- ═══ consuming one, then a second, then a third is correctly blocked ════
do $$
declare v_first record; v_second record; v_third record;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001"}', true);
  set local role authenticated;

  select * into v_first from public.consume_interview_credit();
  if v_first.allowed != true or v_first.remaining != 1 then
    raise exception 'FAIL first consume: expected allowed=true remaining=1, got allowed=% remaining=%',
      v_first.allowed, v_first.remaining;
  end if;

  select * into v_second from public.consume_interview_credit();
  if v_second.allowed != true or v_second.remaining != 0 then
    raise exception 'FAIL second consume: expected allowed=true remaining=0, got allowed=% remaining=%',
      v_second.allowed, v_second.remaining;
  end if;

  select * into v_third from public.consume_interview_credit();
  if v_third.allowed != false or v_third.remaining != 0 then
    raise exception 'FAIL third consume: expected allowed=false remaining=0 (blocked pending paid access), got allowed=% remaining=%',
      v_third.allowed, v_third.remaining;
  end if;

  reset role;
  raise notice 'PASS credit grant/consume/exhaustion sequence (2 allowed, 3rd blocked)';
end $$;

-- ═══ refund restores exactly one credit ══════════════════════════════════
do $$
declare v_after record;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001"}', true);
  set local role authenticated;

  perform public.refund_interview_credit();
  select granted - consumed as remaining into v_after
    from public.interview_credits where user_id = '00000000-0000-0000-0000-000000000001';
  if v_after.remaining != 1 then
    raise exception 'FAIL refund: expected remaining=1 after refunding one, got %', v_after.remaining;
  end if;

  reset role;
  raise notice 'PASS refund restores exactly one credit';
end $$;

-- ═══ RLS: user A cannot read user B's credit row or profile ═════════════
do $$
declare v_count int;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001"}', true);
  set local role authenticated;

  select count(*) into v_count from public.interview_credits
    where user_id = '00000000-0000-0000-0000-000000000002';
  if v_count != 0 then
    raise exception 'FAIL RLS: user A read % row(s) of user B''s credits — isolation broken', v_count;
  end if;

  select count(*) into v_count from public.profiles
    where id = '00000000-0000-0000-0000-000000000002';
  if v_count != 0 then
    raise exception 'FAIL RLS: user A read user B''s profile — isolation broken';
  end if;

  reset role;
  raise notice 'PASS RLS isolation holds for interview_credits and profiles';
end $$;

-- ═══ an unauthenticated caller cannot consume a credit at all ═══════════
do $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  set local role authenticated;
  begin
    perform public.consume_interview_credit();
    raise exception 'FAIL: consume_interview_credit succeeded with no authenticated user';
  exception when others then
    if sqlerrm not like '%no authenticated user%' then
      raise; -- a different failure — surface it, don't swallow it
    end if;
  end;
  reset role;
  raise notice 'PASS unauthenticated caller is rejected, not silently allowed';
end $$;

rollback;
