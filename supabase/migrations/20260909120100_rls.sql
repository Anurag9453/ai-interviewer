-- AI Interviewer — row level security
--
-- Model: RLS is enabled on every public table. Clients get SELECT only, and
-- only on their own rows. There are NO client INSERT/UPDATE/DELETE policies
-- anywhere — every write goes through a server route or the voice agent using
-- the service role. Default-deny does the rest.
--
-- Three tables get no client policy at all, deliberately:
--   question_pool    contains must_hear signals = the exact grading criteria
--   rubric_anchors   contains the scoring bands
--   interview_plans  reveals the upcoming section/topic order
-- A candidate who can read these from the browser can game every score.

alter table public.profiles            enable row level security;
alter table public.categories          enable row level security;
alter table public.topics              enable row level security;
alter table public.rubric_anchors      enable row level security;
alter table public.interview_plans     enable row level security;
alter table public.question_pool       enable row level security;
alter table public.interviews          enable row level security;
alter table public.interview_questions enable row level security;
alter table public.interview_turns     enable row level security;
alter table public.answer_evaluations  enable row level security;
alter table public.interview_reports   enable row level security;
alter table public.seen_questions      enable row level security;

-- ── own profile ─────────────────────────────────────────────────────────
create policy "own profile: select" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy "own profile: update" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ── public catalogue (needed to render the config screen) ───────────────
create policy "categories: read active" on public.categories
  for select to authenticated using (active);

create policy "topics: read" on public.topics
  for select to authenticated using (true);

-- ── own interviews ──────────────────────────────────────────────────────
create policy "interviews: select own" on public.interviews
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "interview_questions: select own" on public.interview_questions
  for select to authenticated using (
    exists (
      select 1 from public.interviews i
      where i.id = interview_questions.interview_id
        and i.user_id = (select auth.uid())
    )
  );

create policy "interview_turns: select own" on public.interview_turns
  for select to authenticated using (
    exists (
      select 1
      from public.interview_questions q
      join public.interviews i on i.id = q.interview_id
      where q.id = interview_turns.interview_question_id
        and i.user_id = (select auth.uid())
    )
  );

-- Anti-gaming: evaluations expose which must_hear signals are still
-- unresolved. Readable only once the interview is over, so a candidate
-- cannot open devtools mid-interview and see what the interviewer is
-- still listening for.
create policy "answer_evaluations: select own after completion" on public.answer_evaluations
  for select to authenticated using (
    exists (
      select 1
      from public.interview_questions q
      join public.interviews i on i.id = q.interview_id
      where q.id = answer_evaluations.interview_question_id
        and i.user_id = (select auth.uid())
        and i.status in ('complete','abandoned')
    )
  );

create policy "interview_reports: select own" on public.interview_reports
  for select to authenticated using (
    exists (
      select 1 from public.interviews i
      where i.id = interview_reports.interview_id
        and i.user_id = (select auth.uid())
    )
  );

create policy "seen_questions: select own" on public.seen_questions
  for select to authenticated using ((select auth.uid()) = user_id);

-- Indexes backing the RLS subqueries above. Without these, every policy
-- check on a transcript does a sequential scan.
create index if not exists interview_questions_rls_idx
  on public.interview_questions (interview_id);
create index if not exists interview_turns_rls_idx
  on public.interview_turns (interview_question_id);
