"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "./FormAlert";
import { OFFLINE_MESSAGE, describeAuthError, isOffline } from "./auth-errors";

/**
 * Sends the sign-up confirmation link to `email` again: from the "Check your
 * email" screen after sign up, and from sign in when it's refused because the
 * address was never confirmed. Supabase limits how often it sends; hitting
 * that limit is reported, not swallowed.
 */
export function ResendConfirmation({
  email,
  className,
}: {
  email: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | { error: string }>("idle");

  async function handleResend() {
    if (isOffline()) {
      setState({ error: OFFLINE_MESSAGE });
      return;
    }
    setState("sending");
    try {
      const { error } = await createClient().auth.resend({ type: "signup", email });
      setState(error ? { error: describeAuthError(error, "signup").message } : "sent");
    } catch {
      setState({ error: OFFLINE_MESSAGE });
    }
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        loading={state === "sending"}
        disabled={state === "sent"}
        onClick={handleResend}
      >
        {state === "sent" ? "Sent. Check your inbox" : "Resend the confirmation link"}
      </Button>
      {typeof state === "object" && <FormAlert className="mt-3">{state.error}</FormAlert>}
    </div>
  );
}
