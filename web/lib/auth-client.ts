"use client";

// Neon Auth in the browser. Every call goes to /api/auth on our own domain,
// which the site's Worker passes on to Neon (see worker/auth.ts), so the
// session cookie is joinhaptic.com's own.
//
// The client also finishes sign-in: when the emailed link or Google sends the
// person back with a one-time verifier in the address, its next session check
// exchanges it for the session cookie and takes it out of the address.

import { createAuthClient } from "@neon/auth";
import { BetterAuthVanillaAdapter } from "@neon/auth/vanilla/adapters";

function make() {
  return createAuthClient(`${window.location.origin}/api/auth`, { adapter: BetterAuthVanillaAdapter() });
}

let client: ReturnType<typeof make> | undefined;

export function auth() {
  client ??= make();
  return client;
}

/** Where people land once signed in. Absolute, because the emailed link is opened from Neon's domain. */
export function dashboardUrl(): string {
  return `${window.location.origin}/dashboard/`;
}
