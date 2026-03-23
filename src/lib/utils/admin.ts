import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { untypedRpc } from "@/lib/supabase/rpc";
import { jsonResponse } from "@/lib/utils/api-helpers";

type AdminResult =
  | { ok: true; userId: string; supabase: Awaited<ReturnType<typeof createServerSupabase>> }
  | { ok: false; response: NextResponse };

/**
 * Verify the request comes from an authenticated app admin.
 * Returns the user ID and supabase client on success, or a
 * 401/403 NextResponse on failure.
 */
export async function requireAdmin(): Promise<AdminResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: jsonResponse({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: isAdmin, error } = await untypedRpc<boolean>(supabase, "is_app_admin");

  if (error || !isAdmin) {
    return { ok: false, response: jsonResponse({ error: "Forbidden" }, { status: 403 }) };
  }

  return { ok: true, userId: user.id, supabase };
}
