import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(
      `${origin}/auth/login?error=auth_callback_failed`,
    );
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/auth/login?error=auth_callback_failed`,
    );
  }

  // Check profile completeness before honoring any redirect.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("avatar_url, date_of_birth")
      .eq("id", user.id)
      .single();

    // OAuth user who hasn't completed profile (no DOB = never filled out the form)
    if (!profile?.date_of_birth) {
      return NextResponse.redirect(`${origin}/auth/complete-profile`);
    }

    // Email/password user who hasn't chosen an avatar yet
    if (!profile?.avatar_url) {
      return NextResponse.redirect(`${origin}/auth/onboarding`);
    }
  }

  // If a specific next page was requested (e.g. password reset), go there.
  // Normalize the path to prevent traversal (e.g. /main/../evil) and decode.
  // Whitelist allowed redirect prefixes to prevent open redirect attacks.
  const ALLOWED_REDIRECT_PREFIXES = ["/main/", "/auth/onboarding", "/auth/complete-profile", "/auth/reset-password"];
  if (next) {
    const normalized = new URL(next, "http://n").pathname; // resolves ../ segments
    if (
      normalized.startsWith("/") &&
      !normalized.startsWith("//") &&
      ALLOWED_REDIRECT_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ) {
      return NextResponse.redirect(`${origin}${normalized}`);
    }
  }

  return NextResponse.redirect(`${origin}/main/dashboard`);
}
