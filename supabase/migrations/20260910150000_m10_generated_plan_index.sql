-- Production-readiness audit finding.
--
-- M10/M10.1 added four query paths that filter custom_documents by
-- generated_plan_id, to resolve a human-readable label for resume/material
-- interviews (their categories row is active=false and therefore invisible to
-- the read-active RLS policy, so the document is the only naming source):
--
--   apps/web/app/dashboard/page.tsx        (per-render, recent interviews)
--   apps/web/app/interviews/page.tsx       (per-render, up to 50 rows)
--   apps/web/app/interview/[id]/report/page.tsx
--   apps/web/app/api/interviews/[id]/meta/route.ts   (every interview room load)
--
-- The column had no index, so each of those was a sequential scan. Harmless at
-- current row counts, wrong as soon as a user accumulates documents — and the
-- meta route runs on every interview start.
--
-- Partial index: rows with a null generated_plan_id are documents that were
-- never turned into an interview, and no query ever looks those up by this
-- column, so they're excluded rather than indexed for nothing.

create index custom_documents_generated_plan_idx
  on public.custom_documents (generated_plan_id)
  where generated_plan_id is not null;
