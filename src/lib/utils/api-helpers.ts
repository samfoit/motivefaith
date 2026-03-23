import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

type AuthResult =
  | { ok: false; response: NextResponse }
  | { ok: true; user: User; supabase: Awaited<ReturnType<typeof createServerSupabase>> };

/** Wrap NextResponse.json with Cache-Control: no-store on every response. */
export function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

/**
 * Authenticate the current request and return the user + supabase client.
 * Returns a 401 jsonResponse if not authenticated.
 */
export async function requireAuthUser(): Promise<AuthResult> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, response: jsonResponse({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true as const, user, supabase };
}

/**
 * Parse and validate a JSON request body with size enforcement.
 * Returns `{ data }` on success or `{ error }` with a ready-to-return response.
 */
export async function parseRequestBody(
  request: Request,
  maxBytes: number,
): Promise<{ data: unknown; error?: never } | { data?: never; error: NextResponse }> {
  const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
  if (contentLength > maxBytes) {
    return { error: jsonResponse({ error: "Request body too large" }, { status: 413 }) };
  }

  try {
    const text = await request.text();
    if (text.length > maxBytes) {
      return { error: jsonResponse({ error: "Request body too large" }, { status: 413 }) };
    }
    return { data: JSON.parse(text) };
  } catch {
    return { error: jsonResponse({ error: "Invalid JSON body" }, { status: 400 }) };
  }
}
