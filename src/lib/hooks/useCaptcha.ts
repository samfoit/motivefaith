import { useState, useCallback } from "react";

/**
 * The Turnstile token for an auth form.
 *
 * A token can be verified only once. After any attempt that sent it, pass or
 * fail, call `reset()`: it drops the spent token and bumps `resetKey`, which
 * tells `<Turnstile resetKey>` to fetch a new one. Without that, a second
 * attempt (after a mistyped password, say) is refused by the captcha check.
 *
 * `required` is whether a widget is configured at all; locally and in tests
 * there may be none, and then a missing token is expected.
 */
export function useCaptcha() {
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const handleToken = useCallback((token: string) => setCaptchaToken(token), []);
  const handleExpire = useCallback(() => setCaptchaToken(null), []);
  const reset = useCallback(() => {
    setCaptchaToken(null);
    setResetKey((k) => k + 1);
  }, []);
  const required = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  return { captchaToken, handleToken, handleExpire, reset, resetKey, required };
}
