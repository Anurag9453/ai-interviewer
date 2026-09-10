-- Extraction (upload time) and analysis (a separate, later request) are two
-- different API calls — the extracted text has to live somewhere between
-- them. Capped at MAX_EXTRACTED_CHARS (50k) by the application before it
-- ever reaches this column, so this is a small, bounded value, not an
-- unbounded document dump.
alter table public.custom_documents
  add column extracted_text text;
