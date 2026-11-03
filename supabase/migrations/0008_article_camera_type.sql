-- ============================================================
--  IP or Turbo HD, and how many megapixels
--
--  The Stock list sorts cameras and recorders by what they are: IP or
--  Turbo HD, and the megapixels. It reads that from the name, the code and
--  the specs (DS-2CD is IP, DS-2CE Turbo HD, "5MP" is 5 MP, and so on).
--  This adds a place to correct it by hand where the reading is wrong:
--
--    articles.cam_type   'ip', 'turbo', or 'none' (not a camera or
--                        recorder); empty means "read it from the name"
--    articles.mp         megapixels; empty means "read it from the name"
--
--  The app reads these two from the table itself, beside article_stock,
--  so the view is left exactly as it is. Before this runs, the sorting
--  still works; it can only be read from the name, not set.
--
--  Safe to run more than once. The article policies already cover new
--  columns.
-- ============================================================

alter table public.articles add column if not exists cam_type text
  check (cam_type in ('ip', 'turbo', 'none'));
alter table public.articles add column if not exists mp numeric
  check (mp > 0 and mp < 100);
