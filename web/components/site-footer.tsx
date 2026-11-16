import Link from "next/link";
import { HapticTag } from "@/components/haptic-tag";
import { Pointer } from "@/components/pointer";
import { site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Pointer className="size-4 text-foreground" />
          <span>
            © {new Date().getFullYear()} {site.company}
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/privacy/" className="transition-colors hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms/" className="transition-colors hover:text-foreground">
            Terms
          </Link>
          <a href={`mailto:${site.email}`} className="transition-colors hover:text-foreground">
            {site.email}
          </a>
        </nav>
      </div>
      <HapticTag />
    </footer>
  );
}
