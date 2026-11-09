import { createHmac } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { env } from "./env";

// Short-lived token the SDK gets from /session and sends with every turn, so
// the hot path never touches the database.

export interface SessionClaims {
  siteId: string;
  orgId: string;
  origin: string;
  sessionId: string;
  /** Hashed visitor ID, used to count learned labels once per person. */
  visitor: string;
  siteName: string;
  learning: boolean;
  voice: boolean;
}

const TTL_SECONDS = 30 * 60;

function secret(): Uint8Array {
  if (!env.sessionSecret) throw new Error("HAPTIC_SESSION_SECRET is not set");
  return new TextEncoder().encode(env.sessionSecret);
}

export async function signSession(claims: SessionClaims): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + TTL_SECONDS * 1000;
  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .setAudience("haptic-sdk")
    .sign(secret());
  return { token, expiresAt };
}

export async function verifySession(request: Request): Promise<SessionClaims | undefined> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return undefined;
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: "haptic-sdk", algorithms: ["HS256"] });
    const claims = payload as unknown as SessionClaims;
    // A token minted for one site's origin can't be replayed from another.
    if (claims.origin !== request.headers.get("origin")) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

/**
 * Turns the SDK's random visitor ID into a per-site pseudonym. Without one
 * (storage blocked), each session counts as its own visitor.
 */
export function visitorHash(siteId: string, visitorId: string | undefined, sessionId: string): string {
  const source = visitorId && /^[A-Za-z0-9-]{8,64}$/.test(visitorId) ? `v:${visitorId}` : `s:${sessionId}`;
  return createHmac("sha256", secret()).update(`${siteId}|${source}`).digest("hex").slice(0, 16);
}
