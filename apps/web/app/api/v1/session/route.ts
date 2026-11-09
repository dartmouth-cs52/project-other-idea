import type { SessionResponse } from "@haptic/protocol";
import { after } from "next/server";
import { jsonResponse, preflight } from "@/lib/cors";
import { isOriginAllowed } from "@/lib/origins";
import { allow } from "@/lib/rateLimit";
import { signSession, visitorHash } from "@/lib/sessionToken";
import { env } from "@/lib/env";
import { getSiteByKey } from "@/lib/sites";

export function OPTIONS(request: Request) {
  return preflight(request);
}

// The SDK calls this once per page load. It checks the publishable key and
// the page's origin, then hands back a short-lived token and the site's
// public settings. The first successful call marks the site as installed.
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allow(`session:${ip}`, 60, 60_000)) {
    return jsonResponse(request, { error: "Too many requests" }, 429);
  }

  const body = (await request.json().catch(() => ({}))) as { key?: unknown; visitor?: unknown };
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) return jsonResponse(request, { error: "Missing key" }, 400);

  const site = await getSiteByKey(key);
  if (!site) return jsonResponse(request, { error: "Unknown key" }, 404);

  if (!isOriginAllowed(origin, site.allowedOrigins)) {
    return jsonResponse(
      request,
      { error: `This key isn't allowed on ${origin ?? "this page"}. Add the origin under Install in the Haptic dashboard.` },
      403,
    );
  }
  if (site.blockedReason) return jsonResponse(request, { error: site.blockedReason }, 403);

  // Voice is off for everyone until the feature flag turns it back on.
  const voice = env.voiceFeature && site.voiceEnabled;
  const sessionId = crypto.randomUUID();
  const { token, expiresAt } = await signSession({
    siteId: site.id,
    orgId: site.orgId,
    origin: origin!,
    sessionId,
    visitor: visitorHash(site.id, typeof body.visitor === "string" ? body.visitor : undefined, sessionId),
    siteName: site.name,
    learning: site.learningEnabled,
    voice,
  });

  after(async () => {
    if (site.id === "dev-site") return;
    const { markInstalled } = await import("@/lib/db/usage");
    await markInstalled(site.id, origin!);
  });

  const response: SessionResponse = {
    token,
    expiresAt,
    config: {
      siteName: site.name,
      appearance: site.appearance,
      voiceEnabled: voice,
      learningEnabled: site.learningEnabled,
    },
  };
  return jsonResponse(request, response);
}
