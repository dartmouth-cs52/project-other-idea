import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Only the dashboard and auth pages need the session. The public SDK API,
// the script and static files skip this entirely.
export const config = {
  matcher: ["/dashboard/:path*", "/login", "/signup", "/auth/:path*"],
};
