import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "../database.types";
import { env } from "../env";

/** Supabase as the signed-in dashboard user. Row level security applies. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // proxy.ts refreshes the session on the next request.
        }
      },
    },
  });
}
