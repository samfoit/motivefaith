"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { AuthWordmark } from "../../AuthWordmark";
import { destinationAfterGoogle } from "../../GoogleSignIn";
import { readGoogleCallback, takeRedirectState } from "../../google-redirect";

/**
 * Where Google sends a redirect sign-in back (google-redirect.ts), with the ID
 * token in the URL's fragment.
 *
 * The fragment is read and taken out of the address as this module loads:
 * before the page renders, before anything else on it (analytics, the
 * Supabase client) looks at the URL, and so the token never stays in the
 * history.
 */
const fragment = typeof window === "undefined" ? "" : takeFragment();

function takeFragment(): string {
  const { hash, pathname, search } = window.location;
  if (hash) window.history.replaceState(window.history.state, "", pathname + search);
  return hash;
}

type Outcome =
  | { kind: "signed-in"; destination: string }
  | { kind: "cancelled" }
  | { kind: "failed" };

/**
 * Once per page load. The state is read once and the token spent on the first
 * try, so a second run, as React's development double-mount makes, could only
 * fail; it waits on the first instead.
 */
let finishing: Promise<Outcome> | null = null;

async function finishSignIn(): Promise<Outcome> {
  const callback = readGoogleCallback(fragment);
  const saved = takeRedirectState();
  if (callback.kind === "cancelled") return { kind: "cancelled" };
  // A token this browser didn't ask for, or none, is not signed in with.
  if (callback.kind !== "token" || !saved || callback.state !== saved.state) {
    return { kind: "failed" };
  }

  const { error } = await createClient().auth.signInWithIdToken({
    provider: "google",
    token: callback.idToken,
    nonce: saved.nonce,
  });
  if (error) return { kind: "failed" };

  // A first Google sign-in makes the account, which goes on to finish its
  // profile, as from the button.
  return { kind: "signed-in", destination: await destinationAfterGoogle() };
}

export default function GoogleCallbackPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    finishing ??= finishSignIn().catch((): Outcome => ({ kind: "failed" }));
    void finishing.then((outcome) => {
      if (cancelled) return;
      if (outcome.kind === "signed-in") {
        router.replace(outcome.destination);
        router.refresh();
      } else if (outcome.kind === "cancelled") {
        router.replace("/auth/login");
      } else {
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="w-full max-w-sm auth-card-enter">
      <div className="bg-bg-elevated rounded-lg shadow-md px-5 py-7 sm:p-8 text-center">
        <AuthWordmark />
        {failed ? (
          <>
            <h1 className="font-display text-lg font-medium mb-1">
              Google sign-in didn&apos;t finish
            </h1>
            <p className="text-sm text-text-secondary mb-6">Please try again.</p>
            <Link
              href="/auth/login"
              className={cn(buttonVariants({ size: "lg" }), "w-full")}
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h1 className="font-display text-lg font-medium mb-1">Signing you in…</h1>
            <p role="status" className="text-sm text-text-secondary">
              Finishing with Google
            </p>
          </>
        )}
      </div>
    </div>
  );
}
