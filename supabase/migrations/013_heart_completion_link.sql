-- Link heart encouragements to specific completions
-- Previously hearts were unlinked, causing one heart to display on all prior completions

ALTER TABLE public.encouragements
  ADD COLUMN completion_id UUID REFERENCES public.completions(id) ON DELETE CASCADE;

CREATE INDEX idx_encouragements_completion_user
  ON public.encouragements (completion_id, user_id)
  WHERE completion_id IS NOT NULL;
