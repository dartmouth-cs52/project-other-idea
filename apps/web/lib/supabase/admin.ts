import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { env } from "../env";

let admin: ReturnType<typeof createClient<Database>> | undefined;

/**
 * Bypasses row level security. Only for server code acting without a
 * signed-in user: the public SDK API and Stripe webhooks.
 */
export function createAdminClient() {
  if (!env.supabaseServiceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  admin ??= createClient<Database>(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
