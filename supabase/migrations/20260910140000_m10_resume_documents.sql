-- M10 — resume-based interviews.
--
-- Resumes reuse the entire M7 document pipeline (same `custom_documents`
-- table, same private `interview-documents` bucket, same extraction, same
-- plan generation, same question model). The ONLY thing the pipeline was
-- missing is a way to tell a resume apart from generic uploaded material,
-- because the two need different analysis prompts and different interview
-- framing while producing an identical runnable plan.
--
-- `analysis jsonb` is intentionally left schema-free, so the resume-specific
-- profile (roles, projects, skills, claims) needs no DDL of its own.

alter table public.custom_documents
  add column document_type text not null default 'material'
    check (document_type in ('material', 'resume'));

-- Every pre-M10 row is generic material by definition — resumes did not exist
-- as a concept before this migration, so the default backfills correctly and
-- no data migration is needed.

comment on column public.custom_documents.document_type is
  'material = generic uploaded content (M7); resume = the candidate''s own resume (M10). '
  'Job-description support is a planned extension: add ''job_description'' to this '
  'check constraint and pair it with the resume row at interview-configuration time. '
  'Deliberately not added yet — an unused enum value is a state nothing can produce.';

-- Resume uploads are listed separately from material uploads in the candidate
-- UI, so the common query is (user, type, newest first).
create index custom_documents_user_type_idx
  on public.custom_documents (user_id, document_type, created_at desc);

-- No grant change required: `custom_documents` already has table-level
-- `grant select ... to authenticated` (writes are service-role only, with an
-- explicit ownership check in the route), so the new column inherits the
-- existing, correct posture rather than widening it.
