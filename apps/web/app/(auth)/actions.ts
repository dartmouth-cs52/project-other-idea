"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/dashboard") ? next : "/dashboard";
}

export async function signIn(_state: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
  });
  if (error) return { error: "That email and password don't match an account." };
  redirect(safeNext(form.get("next")));
}

export async function signUp(_state: AuthState, form: FormData): Promise<AuthState> {
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters for the password." };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email: String(form.get("email") ?? ""), password });
  if (error) return { error: error.message };
  if (!data.session) return { error: "Check your email to confirm your account, then sign in." };
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
