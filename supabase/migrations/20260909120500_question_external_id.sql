-- Seeding must be idempotent, and question identity must survive a reseed.
--
-- question_pool has a uuid primary key and no natural key, so re-running the
-- seed would insert 30 duplicate rows. Worse, seen_questions references those
-- uuids: fresh uuids on every reseed would silently erase every user's
-- question history, and they would start seeing questions they had already
-- been asked.
--
-- external_id is the stable authored identifier (e.g. "bk.sandbox-to-load"),
-- so the seed upserts onto it and uuids stay put across regenerations.

alter table public.question_pool
  add column external_id text;

update public.question_pool set external_id = id::text where external_id is null;

alter table public.question_pool
  alter column external_id set not null,
  add constraint question_pool_external_uniq unique (plan_id, external_id);
