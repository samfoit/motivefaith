import { NextResponse } from "next/server";

/**
 * Verify that a state-changing request originates from our own app by
 * checking the Origin (or Referer) header against the expected host.
 *
 * Returns a 403 NextResponse if the check fails, or `null` if it passes.
 */
export function verifyCsrf(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // At least one must be present on cross-origin-capable requests
  const source = origin || (referer ? new URL(referer).origin : null);

  if (!source) {
    // Missing both headers — could be a direct API call or an old browser.
    // Reject to be safe.
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Compare against the app's own origin
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL;
  const allowed = new Set<string>();

  if (!appUrl && process.env.NODE_ENV === "production") {
    console.error(
      "[csrf] Neither NEXT_PUBLIC_SITE_URL nor VERCEL_URL is set. " +
      "Blocking request — configure NEXT_PUBLIC_SITE_URL for production.",
    );
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (appUrl) {
    // Normalize: add protocol if missing
    const normalized = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
    allowed.add(new URL(normalized).origin);
  }

  // Only allow localhost in development
  if (process.env.NODE_ENV === "development") {
    allowed.add("http://localhost:3000");
    allowed.add("http://127.0.0.1:3000");
  }

  if (!allowed.has(source)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null; // passed
}
