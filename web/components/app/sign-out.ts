"use client";

// Signing out, for every place that offers it: the bar's menu, the setup
// screens and the card for an account that isn't approved. It is a file of its
// own so the setup screens, which have no bar, don't load the bar with it.

import { useState } from "react";
import type { Failure } from "@/components/form";
import { auth } from "@/lib/auth-client";
import { leaveFor } from "./parts";

/**
 * Signing out. The session is a cookie the page can't clear by itself, so until the call has gone through the person
 * is still signed in. When it fails, the page stays and `failure` says so, for the page to show with Try again: the
 * sign-in page would tell them they had left. Once it has gone through, the page leaves for the sign-in page with a
 * full page load, for the reason given at leaveFor.
 */
export function useSignOut() {
  const [signingOut, setSigningOut] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function signOut() {
    setSigningOut(true);
    setFailure(null);
    try {
      const { error } = await auth().signOut();
      if (!error) return leaveFor("/sign-in/");
    } catch {
      // The auth client throws when the call is turned down or can't reach the server, as well as returning an error.
    }
    setSigningOut(false);
    setFailure({ title: "Couldn't sign you out", detail: "You are still signed in. Try again in a moment." });
  }

  return { signOut, signingOut, failure };
}
