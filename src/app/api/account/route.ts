import { createClient } from "@supabase/supabase-js";
import { verifyCsrf } from "@/lib/utils/csrf";
import {
  jsonResponse,
  parseRequestBody,
  requireAuthUser,
} from "@/lib/utils/api-helpers";
import { createServerSupabase } from "@/lib/supabase/server";
import { untypedRpc } from "@/lib/supabase/rpc";
import { removeStorageFolder } from "@/lib/utils/storage-cleanup";
import { accountConfirmation } from "@/lib/auth/account-confirmation";
import type { Database } from "@/lib/supabase/types";

/**
 * GET /api/account — How this account, in this session, confirms it is
 * them before it can be deleted: its password, a sign-in recent enough to
 * stand for one, or signing in again first. The delete dialog asks, so it
 * shows a password field only to an account that has a password.
 *
 * No CSRF check: it reads, changes nothing, and says only how the caller
 * themselves signs in.
 */
export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.ok) return auth.response;

  const { data } = await auth.supabase.auth.getClaims();
  return jsonResponse({ confirmWith: accountConfirmation(auth.user, data?.claims) });
}

/**
 * DELETE /api/account — Permanently delete the caller's account.
 *
 * Flow:
 *   1. CSRF + session auth.
 *   2. Confirm it is them (lib/auth/account-confirmation.ts). An account
 *      with a password re-verifies it against an isolated anon client (so
 *      cookies aren't touched). One that signs in with Google has none, and
 *      must have signed in within the last ten minutes instead.
 *   3. Call delete_own_account() RPC — atomically clears public-schema
 *      rows, hands off groups, AND removes the auth.users row (via the
 *      _delete_auth_user_self helper owned by supabase_auth_admin).
 *   4. Remove the account's files (avatars/<uid>/…, completions/<uid>/…),
 *      every folder deep — best-effort; failure is logged but doesn't
 *      fail the request, and the purge queue (056) picks up the rest.
 *
 * Note: we used to call auth.admin.deleteUser() over REST as the last
 * step, but the new sb_secret_* service-key format is rejected by
 * GoTrue's admin endpoint (supabase-js#1568). Doing the auth.users
 * delete inside the RPC sidesteps that and makes the whole operation
 * atomic.
 */
export async function DELETE(request: Request) {
  const csrfError = verifyCsrf(request);
  if (csrfError) return csrfError;

  const auth = await requireAuthUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const parsed = await parseRequestBody(request, 4096);
  if (parsed.error) return parsed.error;
  const body = parsed.data as Record<string, unknown>;

  const captchaToken = body.captchaToken;
  if (captchaToken !== undefined && typeof captchaToken !== "string") {
    return jsonResponse({ error: "Invalid captchaToken" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    const missing = [
      !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
      !anonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
    ]
      .filter(Boolean)
      .join(", ");
    console.error(`[api/account] Missing env vars: ${missing}`);
    return jsonResponse(
      { error: `Server misconfigured: missing ${missing}` },
      { status: 500 },
    );
  }

  const { data: claimsData } = await auth.supabase.auth.getClaims();
  const confirmWith = accountConfirmation(user, claimsData?.claims);

  if (confirmWith === "password") {
    if (!user.email) {
      return jsonResponse(
        { error: "Account has no email on file; cannot re-authenticate" },
        { status: 400 },
      );
    }

    const password = body.password;
    if (typeof password !== "string" || password.length === 0) {
      return jsonResponse({ error: "Password is required" }, { status: 400 });
    }

    // Isolated anon client — does NOT share cookies with the caller's
    // session, so signing in here doesn't disturb their cookies.
    const reauth = createClient<Database>(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: signInError } = await reauth.auth.signInWithPassword({
      email: user.email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (signInError) {
      console.error("[api/account] re-auth failed:", signInError.message);
      const isCaptcha = /captcha/i.test(signInError.message);
      return jsonResponse(
        {
          error: isCaptcha
            ? "Captcha verification failed — please retry"
            : "Invalid credentials",
        },
        { status: 401 },
      );
    }
  } else if (confirmWith === "sign_in_again") {
    // No password to check, and the sign-in that would stand for one was
    // too long ago. `code` tells the dialog to offer signing in again.
    return jsonResponse(
      {
        error: "Sign in again to delete your account",
        code: "reauth_required",
      },
      { status: 401 },
    );
  }

  // RPC runs as the user's session so its auth.uid() check passes. The
  // function is SECURITY DEFINER and ends with a privileged helper that
  // removes the auth.users row in the same transaction.
  const userSession = await createServerSupabase();
  const { error: rpcError } = await untypedRpc<void>(
    userSession,
    "delete_own_account",
    { p_user_id: user.id },
  );
  if (rpcError) {
    console.error("[api/account] delete_own_account failed:", rpcError.message);
    return jsonResponse(
      {
        error: "Failed to delete account data",
        detail:
          process.env.NODE_ENV === "development" ? rpcError.message : undefined,
      },
      { status: 500 },
    );
  }

  // Service-role client for storage listing / removal — it bypasses RLS
  // and doesn't depend on the (now-deleted) user's session.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The account's files: its avatar, and every photo, video and voice note
  // in its folder (<user_id>/<habit>/…, <user_id>/capture/…,
  // <user_id>/private/…), whether or not a row ever pointed at them.
  //
  // Best-effort from here, since the account is already gone, but not the
  // only attempt: deleting the profile queued each of these files in
  // media_purge_queue (056), and purge-media removes whatever this leaves.
  for (const bucket of ["avatars", "completions"] as const) {
    try {
      await removeStorageFolder(admin.storage, bucket, user.id);
    } catch (err) {
      console.error(`[api/account] storage cleanup (${bucket}) failed:`, err);
    }
  }

  return jsonResponse({ ok: true });
}
