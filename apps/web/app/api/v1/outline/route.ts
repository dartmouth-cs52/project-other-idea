import { jsonResponse, preflight } from "@/lib/cors";
import { allow } from "@/lib/rateLimit";
import { verifySession } from "@/lib/sessionToken";
import { recordOutline } from "@/lib/siteMap";
import { validateOutline } from "@/lib/validate";

export function OPTIONS(request: Request) {
  return preflight(request);
}

// The SDK sends one cleaned outline per route per browser session. These
// build the learned site map that lets Haptic answer cross-page questions.
export async function POST(request: Request) {
  const claims = await verifySession(request);
  if (!claims) return jsonResponse(request, { error: "Session expired" }, 401);
  if (!claims.learning) return jsonResponse(request, { ok: false, reason: "learning disabled" });
  if (!allow(`outline:${claims.sessionId}`, 40, 10 * 60_000)) return jsonResponse(request, { error: "Too many requests" }, 429);

  try {
    const outline = validateOutline(await request.json());
    await recordOutline(claims.siteId, claims.visitor ?? claims.sessionId, outline);
  } catch (error) {
    return jsonResponse(request, { error: error instanceof Error ? error.message : "Bad request" }, 400);
  }
  return jsonResponse(request, { ok: true });
}
