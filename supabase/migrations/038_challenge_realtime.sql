-- Group chats show challenge events as they happen.
--
-- "Alice started 7-Day Early Bird" and "Bob joined" appear in the group's
-- conversation, so a challenge created or joined has to reach the chat
-- without a reload. Both tables already have member-only SELECT policies
-- (002), which realtime applies.

ALTER PUBLICATION supabase_realtime ADD TABLE public.group_challenges;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_challenge_participants;

-- Leaving a challenge deletes the participant row, and the chat listens for
-- that too: as in 006, a DELETE needs the old row whole to be checked
-- against RLS.
ALTER TABLE public.group_challenge_participants REPLICA IDENTITY FULL;
