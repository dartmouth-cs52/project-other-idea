// Sign-in for joinhaptic.com, through Neon Auth.
//
// Neon hosts the sign-in server on its own domain. Talking to it straight from
// the browser would make its session cookie a third-party cookie, which Safari
// and others block. So every auth call goes to /api/auth on our own domain and
// is passed on from here, and the cookies come back as joinhaptic.com's own.
// This uses the same framework-neutral proxy Neon's Next.js integration does.
//
// Google sign-in returns to our page with a one-time verifier in the address.
// The browser client sends it on its next session check, through this proxy,
// together with the challenge cookie set when sign-in started, and gets the
// session cookie in exchange.

import { handleAuthProxyRequest } from "@neon/auth/server";

export interface AuthEnv {
  /** Neon Auth's address for the branch, ending in /neondb/auth. */
  NEON_AUTH_URL?: string;
  /** Signs the short-lived session copy kept in a cookie, so most checks skip a trip to Neon. A secret of 32+ characters. */
  NEON_AUTH_COOKIE_SECRET?: string;
}

export interface SignedInUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

const PREFIX = "/api/auth/";

export function authConfigured(env: AuthEnv): env is Required<AuthEnv> {
  return Boolean(env.NEON_AUTH_URL && env.NEON_AUTH_COOKIE_SECRET && env.NEON_AUTH_COOKIE_SECRET.length >= 32);
}

/** Answers /api/auth/*, the browser's way to Neon Auth. */
export async function proxyAuth(request: Request, env: AuthEnv): Promise<Response> {
  if (!authConfigured(env)) return Response.json({ error: "Sign-in is not set up on this server." }, { status: 503 });
  const path = new URL(request.url).pathname.slice(PREFIX.length);
  if (!path || path.includes("..")) return Response.json({ error: "Not found." }, { status: 404 });
  return handleAuthProxyRequest({ request, path, baseUrl: env.NEON_AUTH_URL!, cookieSecret: env.NEON_AUTH_COOKIE_SECRET! });
}

/**
 * Who is signed in on this request, or nobody. Asks the same way the browser
 * would, so a fresh session copy in the cookie answers without calling Neon.
 * Any cookies the check refreshes are returned, to pass on in the response.
 */
export async function currentUser(request: Request, env: AuthEnv): Promise<{ user?: SignedInUser; cookies: string[] }> {
  if (!authConfigured(env)) return { cookies: [] };
  const check = new Request(new URL(`${PREFIX}get-session`, request.url), {
    method: "GET",
    headers: { cookie: request.headers.get("cookie") ?? "", origin: new URL(request.url).origin, "user-agent": request.headers.get("user-agent") ?? "" },
  });
  const response = await handleAuthProxyRequest({ request: check, path: "get-session", baseUrl: env.NEON_AUTH_URL!, cookieSecret: env.NEON_AUTH_COOKIE_SECRET! });
  const cookies = response.headers.getSetCookie();
  if (!response.ok) return { cookies };
  const data = (await response.json().catch(() => null)) as { user?: Partial<SignedInUser> } | null;
  const user = data?.user;
  if (!user?.id || !user.email) return { cookies };
  return { user: { id: user.id, email: user.email.toLowerCase(), name: user.name ?? "", emailVerified: user.emailVerified === true }, cookies };
}

/**
 * Has Neon Auth email someone a sign-in link. Used when the team approves a
 * request, so the email the person gets is their invitation. The link brings
 * them back to `callbackURL` signed in.
 */
export async function sendSignInLink(env: AuthEnv, siteOrigin: string, email: string, callbackURL: string): Promise<boolean> {
  if (!authConfigured(env)) return false;
  const response = await fetch(`${env.NEON_AUTH_URL}/sign-in/magic-link`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: siteOrigin },
    body: JSON.stringify({ email, callbackURL }),
  });
  if (!response.ok) console.error("Neon Auth would not send a sign-in link:", response.status, await response.text().catch(() => ""));
  return response.ok;
}
