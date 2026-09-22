-- No colour becomes the default for new habits and challenges.
--
-- Colour is a label the owner opts into, not something every habit is born
-- with: a list where four cards carry four unrelated hues reads as noise,
-- and a colour only means something when most rows do not have one.
--
-- Only the column default changes. Existing rows keep whatever colour they
-- were given — back-filling would throw away a choice someone actually made.

ALTER TABLE public.habits           ALTER COLUMN color DROP DEFAULT;
ALTER TABLE public.group_challenges ALTER COLUMN color DROP DEFAULT;

COMMENT ON COLUMN public.habits.color IS
  'Optional hex label chosen by the owner. NULL means no colour — a plain card.';
COMMENT ON COLUMN public.group_challenges.color IS
  'Optional hex label chosen by the creator. NULL means no colour.';
