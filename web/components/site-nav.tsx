import Link from "next/link";
import { Pointer } from "@/components/pointer";
import { buttonVariants } from "@/components/ui/button";
import { accessHref, signInHref, site } from "@/lib/site";

export function SiteNav() {
  return (
    <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-6">
      <Link href="/" className="flex items-center gap-1.5 rounded-md text-lg font-medium tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Pointer className="size-[22px]" />
        {site.name}
      </Link>
      <nav className="flex items-center gap-6 text-sm font-medium">
        <Link href="/#faq" className="hidden text-muted-foreground transition-colors hover:text-foreground sm:block">
          FAQ
        </Link>
        <Link href={signInHref} className="text-muted-foreground transition-colors hover:text-foreground">
          Sign in
        </Link>
        <Link href={accessHref} className={buttonVariants({ size: "lg" })}>
          Request access
        </Link>
      </nav>
    </header>
  );
}
