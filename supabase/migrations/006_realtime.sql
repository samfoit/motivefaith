-- ============================================================
-- 006_realtime.sql — Realtime publication and replica identity
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.completions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.encouragements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
ALTER PUBLICATION supabase_realtime ADD TABLE public.habit_shares;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_habit_shares;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_message_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_completion_reactions;

-- Tables with wildcard (*) subscriptions that include DELETE
-- need FULL to evaluate RLS on the old tuple. Others use DEFAULT.
ALTER TABLE public.group_members REPLICA IDENTITY FULL;
ALTER TABLE public.group_habit_shares REPLICA IDENTITY FULL;
ALTER TABLE public.group_message_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.group_completion_reactions REPLICA IDENTITY FULL;
