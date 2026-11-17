"use client";

// The frame around every signed-in page: a bar across the top that says where
// you are, and, inside a site, a list of its pages down the left.

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, CreditCard, LayoutGrid, LogOut, Plus } from "lucide-react";
import { cn } from "cn";
import { Pointer } from "@/components/pointer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Me } from "@/lib/app-api";
import { auth } from "@/lib/auth-client";
import { hostOf } from "@/lib/setup";
import { site as haptic } from "@/lib/site";
import { BILLING_HREF, NEW_SITE_HREF, SITES_HREF, VIEWS, siteHref, type View } from "./nav";
import { SiteIcon, leaveFor } from "./parts";

type SiteRow = NonNullable<Me["sites"]>[number];


/** The first word of the person's name, from Google. Someone who signed in by an emailed link has none. */
function firstName(name: string | undefined): string | undefined {
  return name?.trim().split(/\s+/)[0] || undefined;
}

const CRUMB = "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";

function Slash() {
  return (
    <span className="text-border select-none" aria-hidden>
      /
    </span>
  );
}

/**
 * The bar across the top. From the left it reads as a path: Haptic, which
 * leads to the list of sites, then the site, which is a menu of the company's
 * sites. Who is signed in is on the right, with their company in the menu.
 * It sticks to the top of the window. `className` can hold it there another
 * way, as SiteShell does.
 */
export function TopBar({ me, current, className }: { me?: Me; current?: SiteRow; className?: string }) {
  const router = useRouter();
  // The sites whose script is running come first, here and on the list of sites, since those are the ones with something to see.
  const sites = [...(me?.sites ?? [])].sort((a, b) => Number(b.connected) - Number(a.connected));
  const inside = Boolean(me?.approved && sites.length);
  // A new site is named after its company, so two of a company's sites can share a name. Only then is the address needed to tell them apart.
  const shared = (site: SiteRow) => sites.filter((other) => other.name === site.name).length > 1;

  async function signOut() {
    await auth().signOut();
    leaveFor("/sign-in/");
  }

  return (
    <header className={cn("sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background px-4 sm:px-6", className)}>
      <nav aria-label="Where you are" className="flex min-w-0 items-center gap-1">
        {/* Inside the dashboard the name leads to the list of sites. Before that it leads home, by a full page load, for the reason given at leaveFor. */}
        {inside ? (
          <Link href={SITES_HREF} className={cn(CRUMB, "gap-1.5 pl-1 text-base tracking-tight")}>
            <Pointer className="size-5" />
            {haptic.name}
          </Link>
        ) : (
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a href="/" className={cn(CRUMB, "gap-1.5 pl-1 text-base tracking-tight")}>
            <Pointer className="size-5" />
            {haptic.name}
          </a>
        )}
        {inside && current && <Slash />}
        {inside && current && (
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(CRUMB, "data-popup-open:bg-muted")} aria-label={`Site, ${current.name}. Choose another`}>
              <span className="truncate">{current.name}</span>
              {shared(current) && <span className="hidden truncate font-normal text-muted-foreground sm:inline">{hostOf(current.origin)}</span>}
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Sites</DropdownMenuLabel>
                {sites.map((item) => (
                  <DropdownMenuItem key={item.id} onClick={() => router.push(siteHref(item.id))} className="gap-2.5 py-1.5">
                    <SiteIcon site={item} small />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{item.name}</span>
                      {shared(item) && <span className="truncate text-xs text-muted-foreground">{hostOf(item.origin)}</span>}
                    </span>
                    {item.id === current.id && <Check className="text-muted-foreground" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push(SITES_HREF)} className="gap-2 py-1.5">
                <LayoutGrid className="text-muted-foreground" />
                All sites
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push(NEW_SITE_HREF)} className="gap-2 py-1.5">
                <Plus className="text-muted-foreground" />
                Add a site
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>
      {me && (
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(CRUMB, "shrink-0 data-popup-open:bg-muted")} aria-label="Account">
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-medium uppercase">{(firstName(me.user.name) ?? me.user.email).slice(0, 1)}</span>
            <span className="hidden max-w-40 truncate sm:inline">{firstName(me.user.name) ?? me.user.email}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                {me.organization && <span className="truncate text-sm text-foreground">{me.organization.name}</span>}
                <span className="truncate font-normal">{me.user.email}</span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {me.approved && (
              <DropdownMenuItem onClick={() => router.push(BILLING_HREF)} className="gap-2 py-1.5">
                <CreditCard className="text-muted-foreground" />
                Billing
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={signOut} className="gap-2 py-1.5">
              <LogOut className="text-muted-foreground" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  );
}

/** A page with the bar across the top and nothing down the side: the list of sites, adding one, and the pages before a company is approved. */
export function Plain({ me, children, wide = false }: { me?: Me; children: ReactNode; wide?: boolean }) {
  return (
    <>
      <TopBar me={me} />
      <main className={cn("mx-auto flex w-full flex-col gap-6 px-4 py-10 sm:px-6", wide ? "max-w-6xl" : "max-w-5xl")}>{children}</main>
    </>
  );
}

/**
 * One site: the bar across the top, its pages down the left, and the page
 * chosen beside them. The bar and the list of pages are both fixed to the
 * window, so they and their lines stay where they are however far the page
 * scrolls. They are held the same way so that nothing moves one without the
 * other: a Mac's trackpad pulls the page past its top and lets it spring back,
 * which carries a sticky bar down over the list and leaves a gap above it.
 * Below 1024px the pages are a row under the bar that scrolls sideways, and
 * the bar and the row both stick, so they move together.
 */
export function SiteShell({ me, current, view, children }: { me: Me; current: SiteRow; view: View; children: ReactNode }) {
  return (
    <>
      <TopBar me={me} current={current} className="lg:fixed lg:inset-x-0" />
      <nav aria-label={`${current.name} pages`} className="sticky top-14 z-30 flex gap-1 overflow-x-auto border-b bg-background px-4 py-2 sm:px-6 lg:hidden">
        {VIEWS.map((item) => (
          <PageLink key={item.id} site={current.id} item={item} on={item.id === view} />
        ))}
      </nav>
      <aside className="fixed top-14 bottom-0 left-0 z-30 hidden w-56 flex-col gap-1 overflow-y-auto border-r bg-background p-3 lg:flex">
        <nav aria-label={`${current.name} pages`} className="flex flex-col gap-0.5">
          {VIEWS.map((item) => (
            <PageLink key={item.id} site={current.id} item={item} on={item.id === view} />
          ))}
        </nav>
      </aside>
      {/* The bar takes no room of its own from 1024px, so the page leaves room for it. */}
      <main className="min-w-0 flex-1 lg:pt-14 lg:pl-56">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </>
  );
}

function PageLink({ site, item, on }: { site: string; item: (typeof VIEWS)[number]; on: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={siteHref(site, item.id)}
      aria-current={on ? "page" : undefined}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        on ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {item.name}
    </Link>
  );
}
