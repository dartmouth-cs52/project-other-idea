"use client";

import { useSearchParams } from "next/navigation";
import { SignInForm } from "./sign-in-form";

/** Reads a failed sign-in link's error from the address, so the form can say what happened. */
export function SignIn() {
  return <SignInForm linkError={useSearchParams().get("error")} />;
}
