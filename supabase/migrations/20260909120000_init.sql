-- AI Interviewer — core schema
-- Design notes:
--  * Status/enum-ish columns use text + CHECK, not Postgres enums. Enums are
--    painful to alter and the spec requires adding categories and question
--    kinds later without migrations that lock the table.
--  * Reference data (categories/topics/plans/pool) is seeded server-side and
--    is never written by end users.

create extension if not exists pgcrypto;

-- ─────────────────────────────── identity ───────────────────────────────
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ────────────────────────── reference / content ─────────────────────────
create table public.categories (
  id         text primary key,
  label      text not null,
  -- evaluation dimensions are per-category: Salesforce scores differently
  -- than a behavioural round would.
  dimensions text[] not null,
  active     boolean not null default true,
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.topics (
  id           text primary key,
  category_id  text not null references public.categories (id) on delete cascade,
  label        text not null,
  importance   numeric(3,2) not null default 0.50 check (importance >= 0 and importance <= 1),
  depth_ready  boolean not null default true,
  difficulties text[] not null default '{beginner,intermediate,advanced}',
  prereqs      text[] not null default '{}',
  aliases      text[] not null default '{}',
  rubric_ref   text not null,
  created_at   timestamptz not null default now()
);
create index topics_category_idx on public.topics (category_id);

-- Behavioural anchors, keyed by (rubric_ref, difficulty, dimension).
-- This is what makes difficulty change GRADING, not just question selection.
create table public.rubric_anchors (
  rubric_ref text not null,
  difficulty text not null check (difficulty in ('beginner','intermediate','advanced')),
  dimension  text not null,
  anchor_1   text not null,
  anchor_3   text not null,
  anchor_5   text not null,
  primary key (rubric_ref, difficulty, dimension)
);

create table public.interview_plans (
  id             uuid primary key default gen_random_uuid(),
  plan_key       text not null unique,
  category_id    text not null references public.categories (id),
  difficulty     text not null check (difficulty in ('beginner','intermediate','advanced')),
  mode           text not null check (mode in ('breadth','depth')),
  duration_s     integer not null check (duration_s > 0),
  plan           jsonb not null,          -- persona, sections, dimension weights
  prompt_version text not null,
  validated_at   timestamptz,
  created_at     timestamptz not null default now()
);

create table public.question_pool (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.interview_plans (id) on delete cascade,
  topic_id         text not null references public.topics (id),
  text             text not null,
  kind             text not null default 'definition'
                     check (kind in ('definition','scenario','tradeoff','debug','code_reasoning')),
  scores           text[] not null,
  must_hear        jsonb not null,        -- [{id, signal, probe}]
  max_probes       integer not null default 2,
  hard_time_s      integer not null default 180,
  difficulty_band  text not null check (difficulty_band in ('beginner','intermediate','advanced')),
  created_at       timestamptz not null default now()
);
create index question_pool_plan_idx on public.question_pool (plan_id, topic_id);

-- ──────────────────────────── per-user data ─────────────────────────────
create table public.interviews (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  plan_id           uuid not null references public.interview_plans (id),
  category_id       text not null references public.categories (id),
  difficulty        text not null,
  duration_s        integer not null,
  status            text not null default 'configuring'
                      check (status in ('configuring','live','grading','complete','abandoned')),
  room_name         text unique,           -- LiveKit room ↔ interview mapping
  started_at        timestamptz,
  ended_at          timestamptz,
  actual_duration_s integer,
  end_reason        text check (end_reason in ('completed','user_ended','timeout','disconnected','error')),
  cost_cents        numeric(10,4) not null default 0,
  created_at        timestamptz not null default now()
);
create index interviews_user_idx on public.interviews (user_id, created_at desc);
create index interviews_status_idx on public.interviews (status) where status in ('live','grading');

create table public.interview_questions (
  id                uuid primary key default gen_random_uuid(),
  interview_id      uuid not null references public.interviews (id) on delete cascade,
  question_id       uuid not null references public.question_pool (id),
  seq               integer not null,
  section_id        text,
  difficulty_at_ask text not null,
  asked_at          timestamptz not null default now(),
  closed_at         timestamptz,
  close_reason      text check (close_reason in
                      ('covered','time','probes_exhausted','candidate_stuck','interview_ended')),
  probes_used       integer not null default 0,
  unique (interview_id, seq)
);
create index interview_questions_interview_idx on public.interview_questions (interview_id, seq);

-- One ordered transcript for both speakers. Grading needs the interleaving,
-- so interviewer turns live here too; `candidate_answers` below is the
-- filtered view that matches the spec's CandidateAnswer model.
create table public.interview_turns (
  id                    uuid primary key default gen_random_uuid(),
  interview_question_id uuid not null references public.interview_questions (id) on delete cascade,
  turn_index            integer not null,
  speaker               text not null check (speaker in ('interviewer','candidate')),
  text                  text not null,
  start_ms              integer,
  end_ms                integer,
  audio_url             text,
  is_probe              boolean not null default false,
  created_at            timestamptz not null default now(),
  unique (interview_question_id, turn_index)
);
create index interview_turns_question_idx on public.interview_turns (interview_question_id, turn_index);

create view public.candidate_answers with (security_invoker = true) as
  select id, interview_question_id, turn_index, text, start_ms, end_ms, audio_url,
         is_probe as is_probe_response, created_at
  from public.interview_turns
  where speaker = 'candidate';

-- One row per question, upserted as signals resolve during the interview.
create table public.answer_evaluations (
  id                    uuid primary key default gen_random_uuid(),
  interview_question_id uuid not null unique references public.interview_questions (id) on delete cascade,
  signals               jsonb not null default '[]',  -- [{signal_id,status,evidence_turn_id,quote}]
  dimensions            jsonb,                        -- {correctness:8, relevance:9, ...}
  model                 text not null,
  evaluated_at          timestamptz not null default now()
);

create table public.interview_reports (
  id              uuid primary key default gen_random_uuid(),
  interview_id    uuid not null unique references public.interviews (id) on delete cascade,
  overall_score   integer not null check (overall_score between 0 and 100),
  category_scores jsonb not null,
  strengths       jsonb not null default '[]',
  weaknesses      jsonb not null default '[]',
  answer_feedback jsonb not null default '[]',
  narrative       text,
  -- true when the Opus narrative pass failed and we shipped the
  -- deterministic ledger-only report instead.
  degraded        boolean not null default false,
  model           text not null,
  prompt_version  text not null,
  generated_at    timestamptz not null default now()
);

create table public.seen_questions (
  user_id     uuid not null references auth.users (id) on delete cascade,
  question_id uuid not null references public.question_pool (id) on delete cascade,
  seen_at     timestamptz not null default now(),
  primary key (user_id, question_id)
);
