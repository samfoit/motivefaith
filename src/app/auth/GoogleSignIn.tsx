"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

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

interface GoogleSignInProps {
  /** Runs once Supabase has a session. */
  onSignedIn: () => void | Promise<void>;
  onError: (message: string) => void;
  /** Shown instead when Google's button can't be used: no client ID, the
   *  script was blocked, or the app is installed. */
  fallback: ReactNode;
}

/**
 * Google's own sign-in button, exchanging its ID token with Supabase.
 *
 * The redirect flow (`signInWithOAuth`) sends the user to Google with
 * Supabase's callback URL, so Google's consent screen names the Supabase
 * project's domain. Here the token comes back to this page, so Google names
 * this site instead — and once its branding is verified, MotiveFaith.
 */
export function GoogleSignIn({ onSignedIn, onError, fallback }: GoogleSignInProps) {
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

  if (!clientId || status === "unavailable") return <>{fallback}</>;

  return (
    <div
      ref={containerRef}
      aria-busy={busy || status === "loading"}
      // Holds the button's height while the script loads, so the card
      // doesn't jump when it appears.
      className={`flex justify-center min-h-10 transition-opacity ${
        busy ? "opacity-50 pointer-events-none" : ""
      }`}
    />
  );
}
