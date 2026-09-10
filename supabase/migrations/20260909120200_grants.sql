-- AI Interviewer — explicit Data API privileges
--
-- Supabase currently grants SELECT/INSERT/UPDATE/DELETE on new public tables
-- to anon + authenticated by default (that default is moving to opt-in).
-- RLS default-deny already blocks the writes, but relying on that leaves the
-- intent implicit. This migration states it: no client writes anywhere, read
-- access only where a policy exists, and nothing at all for anon — every
-- surface in this product requires a signed-in user.

revoke all privileges on all tables in schema public from anon, authenticated;

-- Client-readable, gated by the RLS policies in 20260909120100_rls.sql.
grant select on table public.profiles            to authenticated;
grant select on table public.categories          to authenticated;
grant select on table public.topics              to authenticated;
grant select on table public.interviews          to authenticated;
grant select on table public.interview_questions to authenticated;
grant select on table public.interview_turns     to authenticated;
grant select on table public.answer_evaluations  to authenticated;
grant select on table public.interview_reports   to authenticated;
grant select on table public.seen_questions      to authenticated;
grant select on table public.candidate_answers   to authenticated;  -- security_invoker view

-- Users may rename themselves; nothing else is client-writable.
grant update (display_name) on table public.profiles to authenticated;

-- NOT granted, deliberately: question_pool, rubric_anchors, interview_plans.
-- These hold must_hear signals and scoring bands. A candidate who can read
-- them can game every score. Server-side (service_role) access only.

-- Postgres grants EXECUTE to PUBLIC on every new function, which would make
-- this SECURITY DEFINER trigger function a callable public endpoint.
revoke all on function public.handle_new_user() from public, anon, authenticated;
