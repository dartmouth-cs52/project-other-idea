import Link from "next/link";
import { HapticTag } from "@/components/haptic-tag";
import { Pointer } from "@/components/pointer";
import { site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      {/* Haptic's launcher sits 20px in from the window's bottom right corner, 40px tall. A link of the footer's in that
          corner at the foot of the page would send it up the side for good, and on a phone that is over the page's
          first screen, such as the request form's Company field. So the footer leaves the corner free with room under
          its links, until the window is wide enough that they end left of the launcher. */}
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 pt-8 pb-20 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between xl:pb-8">
        <div className="flex items-center gap-2">
          <Pointer className="size-4 text-foreground" />
          <span>
            © {new Date().getFullYear()} {site.company}
          </span>
        </div>
        {/* Each link is padded to a 24px target, as the bar's are. */}
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/privacy/" className="py-0.5 transition-colors hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms/" className="py-0.5 transition-colors hover:text-foreground">
            Terms
          </Link>
          <a href={`mailto:${site.email}`} className="py-0.5 transition-colors hover:text-foreground">
            {site.email}
          </a>
        </nav>
      </div>
      <HapticTag />
    </footer>
  );
}
