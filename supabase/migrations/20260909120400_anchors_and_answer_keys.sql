-- M1 review outcomes:
--  * Rubric anchors move from 1/3/5 to 1/3/5/7/9 — finer granularity on the
--    0-10 dimension scale, so a grader can distinguish "competent" from
--    "strong" instead of collapsing both into 5.
--  * Every question carries an explicit weak/competent/excellent answer key.
--    It is the calibration reference for signal design AND the source for the
--    report's "example of a stronger answer" section, so it belongs with the
--    question rather than being re-invented at grading time.

alter table public.rubric_anchors
  add column anchor_7 text,
  add column anchor_9 text;

-- Backfill is not meaningful (no rows seeded yet), so enforce presence now.
alter table public.rubric_anchors
  alter column anchor_7 set not null,
  alter column anchor_9 set not null;

alter table public.question_pool
  add column answer_key jsonb not null default '{}'::jsonb;

-- {weak, competent, excellent} — all three required, none empty.
alter table public.question_pool
  add constraint question_pool_answer_key_shape check (
    answer_key ? 'weak' and answer_key ? 'competent' and answer_key ? 'excellent'
    and length(answer_key ->> 'weak') > 0
    and length(answer_key ->> 'competent') > 0
    and length(answer_key ->> 'excellent') > 0
  );

alter table public.question_pool alter column answer_key drop default;
