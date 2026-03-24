import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function buildCsp(nonce: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
    : null;
  const supabaseHost = supabaseUrl?.host ?? "*.supabase.co";
  const supabaseIsSecure = supabaseUrl
    ? supabaseUrl.protocol === "https:"
    : true;
  const httpProto = supabaseIsSecure ? "https:" : "http:";
  const wsProto = supabaseIsSecure ? "wss:" : "ws:";

  const isDev =
    process.env.NODE_ENV === "development" &&
    process.env.VERCEL_ENV === undefined;

  const cspReportUrl = process.env.CSP_REPORT_URL;

  return [
    "default-src 'self'",
    isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com"
      : `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com`,
    // style-src 'unsafe-inline' is required by Radix UI primitives and
    // motion (Framer Motion) which inject inline styles for positioning
    // and animations. Revisit when Radix UI supports CSP nonces for styles.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `connect-src 'self' ${httpProto}//${supabaseHost} ${wsProto}//${supabaseHost}`,
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${httpProto}//${supabaseHost}`,
    `media-src 'self' blob: ${httpProto}//${supabaseHost}`,
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
    ...(cspReportUrl
      ? [`report-uri ${cspReportUrl}`, `report-to csp-endpoint`]
      : []),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  // Set nonce on request headers BEFORE any NextResponse.next() call
  // so every response (including Supabase setAll recreations) includes it.
  request.headers.set("x-nonce", nonce);

  // Fast-path: skip Supabase session refresh for public routes
  if (
    pathname === "/" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/legal/")
  ) {
    const response = NextResponse.next({ request });
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          const isSecure = process.env.NODE_ENV === "production";
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              sameSite: options?.sameSite ?? "lax",
              secure: options?.secure ?? isSecure,
              httpOnly: options?.httpOnly ?? true,
            }),
          );
        },
      },
    },
  );

  // Use getSession() for redirect-only decisions — reads the JWT locally
  // without a network round-trip to Supabase Auth. The actual auth
  // verification happens via the cached getAuthUser() in layout/page.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  // Unauthenticated users trying to access protected routes
  if (
    !user &&
    (pathname.startsWith("/main") || pathname === "/auth/onboarding")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  // Authenticated users trying to access login/signup
  if (user && (pathname === "/auth/login" || pathname === "/auth/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/main/dashboard";
    return NextResponse.redirect(url);
  }

  supabaseResponse.headers.set("Content-Security-Policy", csp);
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
