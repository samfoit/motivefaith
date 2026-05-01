import { createClient } from "@supabase/supabase-js";
import { verifyCsrf } from "@/lib/utils/csrf";
import {
  jsonResponse,
  parseRequestBody,
  requireAuthUser,
} from "@/lib/utils/api-helpers";
import { createServerSupabase } from "@/lib/supabase/server";
import { untypedRpc } from "@/lib/supabase/rpc";
import type { Database } from "@/lib/supabase/types";

/**
 * DELETE /api/account — Permanently delete the caller's account.
 *
 * Flow:
 *   1. CSRF + session auth.
 *   2. Re-verify password against an isolated anon client (so cookies
 *      aren't touched).
 *   3. If the caller has a verified TOTP factor, require + verify a code.
 *   4. Call delete_own_account() RPC — atomically clears public-schema
 *      rows, hands off groups, AND removes the auth.users row (via the
 *      _delete_auth_user_self helper owned by supabase_auth_admin).
 *   5. Strip storage prefixes (avatars/<uid>/*, completions/<uid>/*) —
 *      best-effort; failure is logged but doesn't fail the request.
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

  if (!user.email) {
    return jsonResponse(
      { error: "Account has no email on file; cannot re-authenticate" },
      { status: 400 },
    );
  }

  const parsed = await parseRequestBody(request, 4096);
  if (parsed.error) return parsed.error;
  const body = parsed.data as Record<string, unknown>;

  const password = body.password;
  if (typeof password !== "string" || password.length === 0) {
    return jsonResponse({ error: "Password is required" }, { status: 400 });
  }

  const totpCode = body.totpCode;
  if (totpCode !== undefined && typeof totpCode !== "string") {
    return jsonResponse({ error: "Invalid totpCode" }, { status: 400 });
  }

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

  // Isolated anon client — does NOT share cookies with the caller's
  // session, so signing in / MFA here doesn't disturb their cookies.
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

  // Check for a verified TOTP factor on the freshly-authenticated session.
  const { data: factors } = await reauth.auth.mfa.listFactors();
  const verifiedTotp = factors?.totp?.find((f) => f.status === "verified");

  if (verifiedTotp) {
    if (typeof totpCode !== "string" || !/^\d{6}$/.test(totpCode)) {
      return jsonResponse(
        { error: "Two-factor code required" },
        { status: 401 },
      );
    }
    const challenge = await reauth.auth.mfa.challenge({
      factorId: verifiedTotp.id,
    });
    if (challenge.error) {
      return jsonResponse(
        { error: "Failed to create MFA challenge" },
        { status: 500 },
      );
    }
    const verify = await reauth.auth.mfa.verify({
      factorId: verifiedTotp.id,
      challengeId: challenge.data.id,
      code: totpCode,
    });
    if (verify.error) {
      return jsonResponse(
        { error: "Invalid two-factor code" },
        { status: 401 },
      );
    }
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

  // Best-effort storage cleanup. Path scheme for both buckets is
  // <user_id>/<...>, so list under the prefix and remove everything.
  for (const bucket of ["avatars", "completions"] as const) {
    try {
      const { data: files } = await admin.storage
        .from(bucket)
        .list(user.id, { limit: 1000 });
      if (files && files.length > 0) {
        const paths = files.map((f) => `${user.id}/${f.name}`);
        await admin.storage.from(bucket).remove(paths);
      }
    } catch (err) {
      console.error(`[api/account] storage cleanup (${bucket}) failed:`, err);
    }
  }

  return jsonResponse({ ok: true });
}
