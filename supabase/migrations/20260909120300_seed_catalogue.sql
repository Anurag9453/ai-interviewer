-- MVP scope: one category, one difficulty, one duration.
-- Topics and rubric anchors are M1 content work.
insert into public.categories (id, label, dimensions, active, sort)
values (
  'salesforce_dev',
  'Salesforce Developer',
  array['correctness','relevance','depth','clarity','technical_accuracy','problem_solving'],
  true,
  0
)
on conflict (id) do update
  set label = excluded.label,
      dimensions = excluded.dimensions,
      active = excluded.active;
