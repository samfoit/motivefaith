import { redirect } from "next/navigation";
import { getAuthUser, createServerSupabase } from "@/lib/supabase/server";
import { NewGroupClient } from "./new-group-client";

export default async function NewGroupPage() {
  const {
    data: { user },
  } = await getAuthUser();

  if (!user) redirect("/auth/login");

  const supabase = await createServerSupabase();

  // Fetch accepted friends for initial member selection
  const { data: friendships } = await supabase
    .from("friendships")
    .select("register_id, addressee_id")
    .or(`register_id.eq.${user.id},addressee_id.eq.${user.id}`)
    .eq("status", "accepted");

  const friendIds = (friendships ?? []).map((f) =>
    f.register_id === user.id ? f.addressee_id : f.register_id,
  );

  let friends: {
    id: string;
    display_name: string;
    username: string;
    avatar_url: string | null;
  }[] = [];

  if (friendIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, username, avatar_url")
      .in("id", friendIds);
    friends = profiles ?? [];
  }

  return <NewGroupClient userId={user.id} friends={friends} />;
}
