import { useState, useCallback } from "react";

export function useCaptcha() {
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const handleToken = useCallback((token: string) => setCaptchaToken(token), []);
  const handleExpire = useCallback(() => setCaptchaToken(null), []);
  return { captchaToken, handleToken, handleExpire };
}
