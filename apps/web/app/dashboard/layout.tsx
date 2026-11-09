import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { signOut } from "../(auth)/actions";

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link href="/dashboard">
              <Logo />
            </Link>
            <nav className="flex gap-5 text-ink-muted">
              <Link href="/dashboard" className="hover:text-ink">
                Sites
              </Link>
              <Link href="/dashboard/billing" className="hover:text-ink">
                Billing
              </Link>
              <Link href="/docs" className="hover:text-ink">
                Docs
              </Link>
            </nav>
          </div>
          <Suspense fallback={null}>
            <Account />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

async function Account() {
  const { user } = await requireUser();
  return (
    <form action={signOut} className="flex items-center gap-4 text-ink-muted">
      <span>{user.email}</span>
      <button type="submit" className="hover:text-ink">
        Sign out
      </button>
    </form>
  );
}
