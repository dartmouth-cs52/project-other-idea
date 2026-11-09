import { Suspense } from "react";
import { signIn } from "../actions";
import { AuthForm } from "../AuthForm";

export const metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={<AuthForm mode="login" action={signIn} />}>
      <LoginWithNext searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginWithNext({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { next } = await searchParams;
  return <AuthForm mode="login" action={signIn} next={typeof next === "string" ? next : undefined} />;
}
