import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppConfigError } from "@/lib/types";

let adminClient: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Bypasses RLS, so it must only ever be built
 * from a server-only secret. NEXT_PUBLIC_* variables are inlined into the
 * browser bundle by Next.js and are therefore never accepted as the key.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppConfigError(
      "public_service_role_key",
      "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY must not be set: it would be exposed to the browser. Use SUPABASE_SERVICE_ROLE_KEY instead.",
    );
  }

  // The project URL is not a secret, so the public variant is acceptable.
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new AppConfigError(
      "missing_supabase_env",
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.",
    );
  }

  if (!adminClient) {
    adminClient = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return adminClient;
}
