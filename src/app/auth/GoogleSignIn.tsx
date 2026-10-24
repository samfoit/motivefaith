"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { destinationAfterAuth } from "@/lib/constants/pending-invite";
import { Button } from "@/components/ui/Button";

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentity {
  initialize: (options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    nonce?: string;
    ux_mode?: "popup";
    use_fedcm_for_button?: boolean;
    itp_support?: boolean;
  }) => void;
  renderButton: (
    container: HTMLElement,
    options: {
      type?: "standard";
      theme?: "outline" | "filled_black";
      size?: "large";
      text?: "continue_with";
      shape?: "pill";
      logo_alignment?: "center";
      width?: number;
    },
  ) => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}

const SCRIPT_ID = "google-gsi-script";
const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

function loadScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("gsi")), { once: true });
  });
}

/**
 * A random nonce and its SHA-256. Google puts the hash in the ID token and
 * Supabase checks the raw value against it, so a token lifted from elsewhere
 * cannot be replayed here.
 */
async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return { raw, hashed };
}

/**
 * Installed to the home screen. Google's button signs in through a popup,
 * and a standalone app opens popups in a separate browser sheet that cannot
 * hand the result back, so there the redirect flow is the one that works.
 */
function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Where a Google sign-in lands. A first Google sign-in creates the account,
 * so — as /auth/callback does for the redirect flow — send anyone whose
 * profile isn't finished to complete it first.
 */
export async function destinationAfterGoogle(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "/auth/login";
  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_url, date_of_birth")
    .eq("id", user.id)
    .single();
  if (!profile?.date_of_birth) return "/auth/complete-profile";
  if (!profile.avatar_url) return "/auth/onboarding";
  return destinationAfterAuth();
}

/**
 * Where Google's button can't be used, the redirect flow: through Google
 * and back by /auth/callback, which sends a new account on to finish its
 * profile the same way.
 */
function GoogleRedirectButton() {
  async function handleClick() {
    await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <Button variant="secondary" className="w-full" size="lg" onClick={handleClick}>
      <span className="inline-flex items-center">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          className="mr-2 shrink-0"
          aria-hidden="true"
        >
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Continue with Google
      </span>
    </Button>
  );
}

interface GoogleSignInProps {
  /** Runs once Supabase has a session. */
  onSignedIn: () => void | Promise<void>;
  onError: (message: string) => void;
}

/**
 * Google's own sign-in button, exchanging its ID token with Supabase.
 *
 * The redirect flow (`signInWithOAuth`) sends the user to Google with
 * Supabase's callback URL, so Google's consent screen names the Supabase
 * project's domain. Here the token comes back to this page, so Google names
 * this site instead — and once its branding is verified, MotiveFaith.
 *
 * Without a client ID, with the script blocked, or in the installed app, it
 * falls back to the redirect flow's own button.
 */
export function GoogleSignIn({ onSignedIn, onError }: GoogleSignInProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [busy, setBusy] = useState(false);
  // Google calls back long after the button was set up, so it reads the
  // latest handlers from here rather than the ones from that first render.
  const handlers = useRef({ onSignedIn, onError });
  useEffect(() => {
    handlers.current = { onSignedIn, onError };
  });

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId) return;

    let cancelled = false;
    (isStandalone()
      ? Promise.reject(new Error("standalone"))
      : Promise.all([loadScript(), makeNonce()])
    )
      .then(([, nonce]) => {
        const container = containerRef.current;
        const gsi = window.google?.accounts?.id;
        if (cancelled || !container || !gsi) return;

        gsi.initialize({
          client_id: clientId,
          nonce: nonce.hashed,
          ux_mode: "popup",
          use_fedcm_for_button: true,
          itp_support: true,
          callback: async ({ credential }) => {
            setBusy(true);
            const { error } = await createClient().auth.signInWithIdToken({
              provider: "google",
              token: credential,
              nonce: nonce.raw,
            });
            if (error) {
              setBusy(false);
              handlers.current.onError("Google sign-in failed. Please try again.");
              return;
            }
            await handlers.current.onSignedIn();
          },
        });

        gsi.renderButton(container, {
          type: "standard",
          theme:
            document.documentElement.getAttribute("data-theme") === "dark"
              ? "filled_black"
              : "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "center",
          // Google's button takes a fixed width, between 200 and 400px.
          width: Math.min(400, Math.max(200, container.clientWidth)),
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!clientId || status === "unavailable") return <GoogleRedirectButton />;

  return (
    <div
      ref={containerRef}
      aria-busy={busy || status === "loading"}
      // Holds the button's height while the script loads, so the card
      // doesn't jump when it appears.
      className={`flex justify-center min-h-10 transition-opacity ${
        busy ? "opacity-50 pointer-events-none" : ""
      }`}
      // Google draws the button in an iframe whose page declares no dark
      // color scheme. When an iframe's scheme differs from the one its
      // <iframe> element gets from this page (dark, at night or on the Dark
      // pin), the browser paints the frame with an opaque white backdrop
      // instead of letting the page show through, leaving a white box
      // around the pill. Declaring this slot light makes the two agree, so
      // the frame stays transparent; the button keeps its own dark theme.
      style={{ colorScheme: "light" }}
    />
  );
}
