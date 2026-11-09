import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "./supabase/server";

/** The signed-in user, or a redirect to login. Call inside a Suspense boundary. */
export async function requireUser() {
  // Supabase checks the session's expiry against the clock. With partial
  // prefetching, Next may prerender a route with cookies already available,
  // and reading the clock there is an error. Everything signed-in is
  // per-request anyway, so opt out of prerendering before touching it.
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { user, supabase };
}

/** The user's first organization. Haptic has one per account for now. */
export async function currentOrganization() {
  const { user, supabase } = await requireUser();
  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, plan, subscription_status, trial_ends_at, current_period_end, monthly_turn_limit, stripe_customer_id, cancels_at_period_end)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  const org = memberships?.[0]?.organizations ?? null;
  return { user, supabase, org, role: memberships?.[0]?.role ?? null };
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4000").replace(/\/$/, "");
}
