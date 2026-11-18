import Link from "next/link";
import { Pointer } from "@/components/pointer";
import { buttonVariants } from "@/components/ui/button";
import { accessHref, signInHref, site } from "@/lib/site";

export function SiteNav() {
  return (
    // A container, so the name beside the pointer can follow the bar's own width.
    <header className="@container mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-6">
      <Link href="/" className="flex h-7 min-w-6 items-center gap-1.5 rounded-md text-lg font-medium tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Pointer className="size-[22px]" />
        {/* The lockup is the pointer beside the name where there is room for the name (DESIGN.md). On the narrowest
            phones there isn't, beside Sign in and Request access, so the pointer stands for Haptic alone and the name
            is only read out, rather than Sign in breaking over two lines. */}
        <span className="sr-only @xs:not-sr-only">{site.name}</span>
      </Link>
      <nav className="flex items-center gap-6 text-sm font-medium">
        <Link href="/#pricing" className="hidden text-muted-foreground transition-colors hover:text-foreground sm:block">
          Pricing
        </Link>
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
