-- M7 — custom / file-based interviews.
--
-- Two independent additions:
--
--  1. custom_documents + Storage bucket: tracks an uploaded PDF/DOCX/TXT
--     through extraction -> analysis -> question-pool generation. The
--     generated content itself is NOT a new content model — it lands in the
--     exact same categories/topics/interview_plans/question_pool tables M1
--     already defined, so AdaptiveBrain, the report pipeline, and every
--     RLS/ownership rule already proven for the seeded Salesforce content
--     apply unchanged. A custom category is created with active=false so it
--     never appears in the public "browse categories" query — the ONLY way
--     to reach it is through custom_documents.generated_plan_id, which is
--     itself RLS-scoped to its owner.
--
--  2. credit_grants: an audit/source ledger sitting ALONGSIDE the existing
--     interview_credits table, not replacing it. interview_credits.granted/
--     consumed stays the single fast, already-proven counter
--     consume_interview_credit() races against — that function is
--     UNTOUCHED by this migration, zero regression risk to the M4/M5/M6
--     entitlement layer. credit_grants is the new thing: one row per grant
--     event (free_trial today; subscription/topup/promo later), so a future
--     billing milestone can answer "why does this user have N credits" and
--     top up without redesigning anything here. granted_interview_credits()
--     is the seam that future milestone calls — service-role only, nothing
--     in this app calls it yet.

-- ── uploaded documents ──────────────────────────────────────────────────
create table public.custom_documents (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  filename             text not null,
  file_type            text not null check (file_type in ('pdf', 'docx', 'txt')),
  size_bytes           integer not null check (size_bytes > 0),
  storage_path         text not null unique,
  status               text not null default 'uploaded'
                         check (status in (
                           'uploaded', 'extracted', 'empty', 'extraction_failed',
                           'analyzed', 'analysis_failed',
                           'generated', 'generation_failed'
                         )),
  error_message        text,
  extracted_char_count integer,
  truncated            boolean not null default false,
  analysis             jsonb,        -- DocumentBlueprint, once analyzed
  category_id          text references public.categories (id),
  generated_plan_id    uuid references public.interview_plans (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index custom_documents_user_idx on public.custom_documents (user_id, created_at desc);

alter table public.custom_documents enable row level security;

-- Candidate can see their own upload's status/blueprint as it progresses —
-- needed for the review-before-generating step in the upload UI. No client
-- write policy: every mutation (upload, extraction, analysis, generation)
-- goes through a server route using the service role with an explicit
-- ownership check, matching the pattern /api/interviews/[id]/token already
-- established for tables that need more than "am I the owner" to write.
create policy "custom_documents: select own" on public.custom_documents
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.custom_documents from anon, authenticated;
grant select on table public.custom_documents to authenticated;

-- ── storage: uploaded document bytes ────────────────────────────────────
-- Private bucket. Path convention is "<user_id>/<document_id>/<filename>" —
-- ownership is the first path segment, checked by the policies below, the
-- same convention Supabase's own storage RLS examples use.
insert into storage.buckets (id, name, public)
values ('interview-documents', 'interview-documents', false)
on conflict (id) do nothing;

create policy "interview-documents: select own" on storage.objects
  for select to authenticated
  using (bucket_id = 'interview-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "interview-documents: insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'interview-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "interview-documents: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'interview-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── entitlement source ledger (additive, does not touch interview_credits) ─
create table public.credit_grants (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  source     text not null check (source in ('free_trial', 'subscription', 'topup', 'promo')),
  amount     integer not null check (amount > 0),
  note       text,
  granted_at timestamptz not null default now()
);
create index credit_grants_user_idx on public.credit_grants (user_id, granted_at desc);

alter table public.credit_grants enable row level security;

create policy "credit_grants: select own" on public.credit_grants
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.credit_grants from anon, authenticated;
grant select on table public.credit_grants to authenticated;

-- Backfill: every user granted credits before this ledger existed gets one
-- retroactive free_trial row matching what they were actually given, so the
-- ledger is a complete history from here on, not just for new signups.
insert into public.credit_grants (user_id, source, amount, note)
select user_id, 'free_trial', granted, 'backfilled at ledger creation'
from public.interview_credits
where granted > 0;

-- The free-trial grant now also records itself in the ledger. Still one
-- statement per table, still inside the same trigger transaction — the
-- CURRENT 2-free-interview behavior is byte-for-byte unchanged, this only
-- adds the audit row future sources will follow the same shape for.
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

  insert into public.credit_grants (user_id, source, amount, note)
  values (new.id, 'free_trial', 2, 'signup grant');

  return new;
end;
$$;

-- Future billing seam: grants N credits from a given source and bumps the
-- fast counter in the same statement, so interview_credits.granted is
-- always exactly sum(credit_grants.amount) for that user. Not called from
-- anywhere in this app yet (no payment processing in M7) — service-role
-- only, so nothing but a trusted backend can ever grant itself credits.
create or replace function public.grant_interview_credits(
  p_user_id uuid, p_source text, p_amount integer, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_amount <= 0 then
    raise exception 'grant_interview_credits: amount must be positive';
  end if;

  insert into public.credit_grants (user_id, source, amount, note)
  values (p_user_id, p_source, p_amount, p_note);

  update public.interview_credits
  set granted = granted + p_amount, updated_at = now()
  where user_id = p_user_id;

  if not found then
    insert into public.interview_credits (user_id, granted, consumed)
    values (p_user_id, p_amount, 0);
  end if;
end;
$$;

revoke all on function public.grant_interview_credits(uuid, text, integer, text) from public, anon, authenticated;
