-- ============================================================
--  An offer without its total
--
--  Some offers go to the client as a list of prices with no sum under
--  them. This adds
--
--    offers.show_total   false leaves the "Вкупно" line (and the note
--                        beside it) off the PDF, the print and the Word
--                        file. The app itself still shows the total.
--
--  Every existing offer keeps its total. Before this runs the switch still
--  works, but only for the send at hand: the database cannot remember it.
--
--  Safe to run more than once. The offer policies already cover a new
--  column.
-- ============================================================

alter table public.offers add column if not exists show_total boolean not null default true;
