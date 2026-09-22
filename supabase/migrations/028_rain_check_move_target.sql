-- ============================================================
-- 028_rain_check_move_target.sql — a move may only land on a free day
-- ============================================================
--
-- 027 let a rain check name a day to be made up on, bounded only by "forward,
-- within 14 days". That is not enough. A day the habit is already scheduled
-- for has its own occurrence, so moving onto it would:
--
--   * double-book the day — two obligations, one check-in; and
--   * settle the skip with work that was going to happen anyway, which makes
--     the promise free and the streak meaningless.
--
-- So a move may only land on a day the habit is NOT scheduled for. A habit
-- scheduled every day therefore cannot be moved at all — for it, a rain check
-- is a plain skip and nothing else.
--
-- This cannot be a CHECK constraint: the rule depends on habits.schedule,
-- which a row-level CHECK cannot reach. A BEFORE trigger it is, so the rule
-- holds for direct inserts too, not just the insert_completion RPCs.

CREATE OR REPLACE FUNCTION public.validate_rain_check_move()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sched_days JSONB;
  target_dow INT;
BEGIN
  IF NEW.rain_check_moved_to IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT schedule->'days' INTO sched_days
    FROM public.habits WHERE id = NEW.habit_id;

  -- No schedule, or an empty day list, means the habit is due every day.
  IF sched_days IS NULL OR jsonb_array_length(sched_days) = 0 THEN
    RAISE EXCEPTION
      'Habit % is scheduled every day and has no free day to move to', NEW.habit_id
      USING ERRCODE = 'check_violation';
  END IF;

  target_dow := EXTRACT(DOW FROM NEW.rain_check_moved_to)::int;

  IF sched_days @> to_jsonb(target_dow) THEN
    RAISE EXCEPTION
      'Habit % is already scheduled on %, so a rain check cannot be moved there',
      NEW.habit_id, NEW.rain_check_moved_to
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_rain_check_move ON public.completions;

CREATE TRIGGER trg_validate_rain_check_move
  BEFORE INSERT OR UPDATE OF rain_check_moved_to, habit_id ON public.completions
  FOR EACH ROW EXECUTE FUNCTION public.validate_rain_check_move();
