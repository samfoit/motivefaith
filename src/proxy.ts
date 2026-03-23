import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Fast-path: skip Supabase session refresh for public routes
  if (
    pathname === "/" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/legal/")
  ) {
    return NextResponse.next({ request });
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

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
