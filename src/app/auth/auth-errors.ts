/**
 * What to tell someone when sign up or sign in fails, from the error
 * Supabase Auth hands back.
 *
 * Measured against local Supabase (auth-js 2.118):
 *
 *   offline / unreachable    AuthRetryableFetchError, status 0, "Failed to fetch"
 *   username already taken   status 500, "Database error saving new user"
 *                            (handle_new_user's insert hits profiles.username UNIQUE)
 *   spent or missing token   status 500, "captcha verification process failed"
 *   email already registered code user_already_exists
 *   wrong email or password  code invalid_credentials
 *
 * Messages name the problem and the way forward. `field` says which input it
 * belongs under; without one it is shown above the submit button.
 */

export type AuthField = "displayName" | "username" | "email" | "password";

export interface AuthFailure {
  message: string;
  field?: AuthField;
  /** Sign in refused because the address was never confirmed: offer a resend. */
  unconfirmed?: true;
}

export interface AuthErrorLike {
  name?: string;
  status?: number;
  code?: string;
  message?: string;
}

export const OFFLINE_MESSAGE =
  "Couldn't reach MotiveFaith. Check your connection and try again.";

export const CAPTCHA_PENDING_MESSAGE =
  "The security check hasn't finished yet. Give it a moment, then try again. If it doesn't appear, reload the page.";

const GENERIC = "Something went wrong on our side. Please try again.";

export function describeAuthError(
  error: AuthErrorLike,
  action: "signup" | "login",
): AuthFailure {
  const message = error.message ?? "";
  const lower = message.toLowerCase();

  if (error.status === 0 || /failed to fetch|fetch failed|network|load failed/.test(lower)) {
    return { message: OFFLINE_MESSAGE };
  }

  if (error.code === "captcha_failed" || lower.includes("captcha")) {
    return {
      message: "The security check expired. It has been refreshed, so please try again.",
    };
  }

  if (
    error.status === 429 ||
    error.code === "over_request_rate_limit" ||
    error.code === "over_email_send_rate_limit"
  ) {
    return {
      message:
        error.code === "over_email_send_rate_limit"
          ? "Too many emails sent to this address. Wait a few minutes and try again."
          : "Too many attempts. Wait a minute and try again.",
    };
  }

  if (action === "login") {
    if (error.code === "email_not_confirmed" || lower.includes("email not confirmed")) {
      return {
        message: "Confirm your email first. We sent you a link when you signed up.",
        unconfirmed: true,
      };
    }
    if (error.code === "invalid_credentials" || lower.includes("invalid login credentials")) {
      return { message: "Invalid email or password", field: "password" };
    }
  }

  if (action === "signup") {
    if (error.code === "user_already_exists" || lower.includes("already registered")) {
      return {
        message: "An account with this email already exists. Sign in instead.",
        field: "email",
      };
    }
    if (lower.includes("database error saving new user")) {
      // Every other column the insert checks is validated before sending.
      return { message: "That username is taken. Try another.", field: "username" };
    }
    if (error.code === "email_address_invalid") {
      return { message: "Enter a valid email address.", field: "email" };
    }
    if (error.code === "weak_password") {
      return { message: message || "Choose a stronger password.", field: "password" };
    }
    if (error.code === "signup_disabled") {
      return { message: "New sign-ups are paused right now. Please try again later." };
    }
  }

  // GoTrue's 4xx messages are written for people; its 5xx ones are not.
  if (error.status !== undefined && error.status >= 500) return { message: GENERIC };
  return { message: message || GENERIC };
}

/** Whether the browser knows it's offline, so a submit can say so at once. */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
