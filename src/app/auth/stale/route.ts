import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Exit route for an orphaned session: an auth user whose `profiles` row is
 * gone, usually the tail of an account deletion where `auth.admin.deleteUser()`
 * did not run to completion.
 *
 * This exists because `signOut()` cannot work from where the condition is
 * detected. `AuthGate` runs as a Server Component, and `createServerSupabase()`
 * swallows cookie writes there (Next only permits them in Server Actions and
 * Route Handlers) — so the sign-out revoked the refresh token but left the
 * session cookie in place. The user was then redirected to `/auth/login`,
 * where `proxy.ts` sees a still-valid JWT and bounces them back to
 * `/main/dashboard`, into `AuthGate`, and around again: a redirect loop that
 * only ended when the access token expired. A Route Handler can set cookies,
 * so the sign-out actually sticks.
 *
 * Re-checking the orphan condition here rather than trusting the caller keeps
 * this safe to hit from anywhere: a GET that logs you out is otherwise
 * forgeable by any third-party page (`<img src="/auth/stale">`). A session
 * with a real profile is sent on its way untouched.
 */
export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl;
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/auth/login`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  // Not orphaned after all — nothing to clear.
  if (profile) {
    return NextResponse.redirect(`${origin}/main/dashboard`);
  }

  await supabase.auth.signOut();
  return NextResponse.redirect(`${origin}/auth/login?stale=1`);
}
