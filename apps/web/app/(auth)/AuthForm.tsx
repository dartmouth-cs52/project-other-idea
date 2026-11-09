"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Input, Label, Logo } from "@/components/ui";
import type { AuthState } from "./actions";

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: "login" | "signup";
  action: (state: AuthState, form: FormData) => Promise<AuthState>;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const login = mode === "login";
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo />
        </div>
        <form action={formAction} className="rounded-xl border border-line bg-white p-6">
          <h1 className="mb-1 font-display font-normal tracking-[-0.02em] text-[30px] leading-tight">{login ? "Sign in" : "Create your account"}</h1>
          <p className="mb-5 text-ink-muted">{login ? "Manage your sites and usage." : "Start a 14-day trial. No card needed."}</p>
          {next && <input type="hidden" name="next" value={next} />}
          <label className="mb-4 block">
            <Label>Work email</Label>
            <Input name="email" type="email" autoComplete="email" required />
          </label>
          <label className="mb-5 block">
            <Label>Password</Label>
            <Input name="password" type="password" autoComplete={login ? "current-password" : "new-password"} required minLength={8} />
          </label>
          {state.error && <p className="mb-4 text-red-700">{state.error}</p>}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "One moment…" : login ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-center text-ink-muted">
          {login ? "New to Haptic? " : "Already have an account? "}
          <Link href={login ? "/signup" : "/login"} className="font-medium text-accent hover:underline">
            {login ? "Create an account" : "Sign in"}
          </Link>
        </p>
      </div>
    </main>
  );
}
