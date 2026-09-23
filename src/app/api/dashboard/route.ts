import { requireAuthUser, jsonResponse } from "@/lib/utils/api-helpers";
import { fetchDashboard } from "@/lib/data/dashboard";

/**
 * The dashboard's data, as JSON.
 *
 * This exists so `/main/dashboard`'s HTML can be free of user data and
 * therefore safe for the service worker to cache — which is what lets the
 * dashboard paint offline instead of falling back to the dead-end offline
 * page. The response itself is per-user and must never be cached: `jsonResponse`
 * sets `Cache-Control: no-store`, and the service worker skips `/api/*`
 * outright rather than relying on that header alone.
 *
 * No CSRF check: this is a GET with no side effects, and `requireAuthUser`
 * already establishes who is asking. The auth cookie is SameSite=Lax, so a
 * cross-site GET does not carry it.
 */
export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.ok) return auth.response;

  try {
    const data = await fetchDashboard(auth.supabase, auth.user.id);
    return jsonResponse(data);
  } catch (err) {
    console.error("Dashboard fetch failed:", err);
    return jsonResponse({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
