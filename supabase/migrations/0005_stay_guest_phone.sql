-- ============================================================
--  A phone number for a guest
--
--  Centrala can write to a guest on WhatsApp or Viber — the way in before
--  they arrive, a thank-you after they leave — and for that it needs their
--  number. This adds
--
--    stays.guest_phone   the guest's phone, as typed
--
--  The stay sheet gets a field for it, and a number typed into a message is
--  kept there for next time. Before this runs the app hides the field and
--  looks for a number in the stay's notes instead.
--
--  Safe to run more than once. The stay policies already cover a new column.
-- ============================================================

alter table public.stays add column if not exists guest_phone text;
