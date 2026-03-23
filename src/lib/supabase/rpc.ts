import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Call an RPC that is not yet reflected in the auto-generated Database types.
 * Isolates the type assertion to a single location so call sites stay clean.
 *
 * NOTE: The double-cast (`as unknown as`) is intentional — Supabase's
 * generated types only include RPCs present at codegen time. This wrapper
 * lets us call newer RPCs without scattering unsafe casts across every
 * call site. The cast disappears once types are regenerated.
 *
 * TODO: Remove after running `supabase gen types typescript`.
 */
type RpcResult<T> = PromiseLike<{
  data: T | null;
  error: { message: string; code: string } | null;
}>;

type UntypedRpcFn = (
  name: string,
  args?: Record<string, unknown>,
) => RpcResult<unknown>;

export function untypedRpc<T = unknown>(
  client: SupabaseClient<Database>,
  name: string,
  args?: Record<string, unknown>,
): RpcResult<T> {
  return (client.rpc as unknown as UntypedRpcFn)(name, args) as RpcResult<T>;
}
