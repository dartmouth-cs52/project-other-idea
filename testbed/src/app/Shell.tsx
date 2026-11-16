import { Bell, Check, ChevronDown, ChevronsUpDown, HelpCircle, Keyboard, LogOut, Menu as MenuIcon, Moon, PanelLeftClose, Plus, Search, Sun, User, X } from "lucide-react";
import { Dialog as RDialog } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from "react-router";
import { ME_ID, patch, useCollection, useRow } from "@/data/store";
import { useFeature } from "@/lib/access";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useLab } from "@/lab/lab";
import { Button, IconButton, Tooltip } from "@/ui/button";
import { Avatar, Kbd } from "@/ui/display";
import { Menu, Modal, Popover } from "@/ui/overlay";
import { ChatBubble, MaintenanceBanner } from "./Chrome";
import { CommandPalette, useCommandPalette } from "./CommandPalette";
import { ENTITY_ICON, NAV, NAV_FOOTER, navLabel, type NavItem } from "./nav";
import { useSession } from "./session";
import { useShortcuts, SHORTCUTS } from "./shortcuts";

export function Shell() {
  const navVariant = useLab((s) => s.nav);
  const rail = navVariant === "rail";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const palette = useCommandPalette();
  const location = useLocation();
  useShortcuts({ openPalette: () => palette.setOpen(true), openHelp: () => setShortcutsOpen(true) });
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-w", innerWidth >= 768 ? (rail ? "60px" : "240px") : "0px");
  }, [rail]);

  return (
    <div className="flex min-h-full" style={{ ["--sidebar-w" as string]: rail ? "60px" : "240px" }}>
      <MaintenanceBanner />
      <aside aria-label="Main navigation" className={cn("sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar text-sidebar-ink md:flex", rail ? "w-[60px]" : "w-[240px]")}>
        <Sidebar rail={rail} />
      </aside>

      {/* Below md the sidebar is a drawer behind a hamburger button. */}
      <RDialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <RDialog.Portal>
          <RDialog.Overlay className="fixed inset-0 z-50 bg-black/40 md:hidden" />
          <RDialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col bg-sidebar text-sidebar-ink md:hidden">
            <RDialog.Title className="sr-only">Navigation</RDialog.Title>
            <RDialog.Close className="absolute top-3 right-3 cursor-pointer text-sidebar-ink-2" aria-label="Close menu">
              <X className="size-5" />
            </RDialog.Close>
            <Sidebar rail={false} />
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} onSearch={() => palette.setOpen(true)} onShortcuts={() => setShortcutsOpen(true)} />
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ChatBubble />
      <ScrollRestoration />
    </div>
  );
}

function useBadges() {
  const approvals = useCollection("approvals");
  const transactions = useCollection("transactions");
  return useMemo(
    () => ({
      approvals: approvals.filter((a) => a.status === "pending" && a.approverIds.includes(ME_ID)).length,
      receipts: transactions.slice(0, 600).filter((t) => t.receipt === "missing" && t.employeeId === ME_ID).length,
    }),
    [approvals, transactions],
  );
}

function Sidebar({ rail }: { rail: boolean }) {
  const variant = useLab((s) => s.nav);
  const t = useT();
  const badges = useBadges();
  const collapsed = useSession((s) => s.collapsedGroups);
  const toggle = useSession((s) => s.toggleGroup);
  const setLab = useLab((s) => s.set);

  return (
    <>
      <div className={cn("flex h-14 shrink-0 items-center gap-2 px-4", rail && "justify-center px-0")}>
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label="Northpine home">
          <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
            <rect width="32" height="32" rx="7" fill="#2f8f57" />
            <path d="M16 6l7 10h-4l5 8H8l5-8H9z" fill="#fff" />
          </svg>
          {rail ? null : <span className="text-[15px]">Northpine</span>}
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {NAV.map((group) => {
          const label = navLabel(group, variant);
          const folded = !rail && label !== "" && collapsed.includes(group.label);
          return (
            <div key={group.label || "top"} className="mt-3 first:mt-0">
              {label && !rail ? (
                <button
                  type="button"
                  aria-expanded={!folded}
                  onClick={() => toggle(group.label)}
                  className="flex w-full cursor-pointer items-center justify-between px-2 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-ink-2 uppercase hover:text-sidebar-ink"
                >
                  {t(label)}
                  <ChevronDown className={cn("size-3.5 transition-transform", folded && "-rotate-90")} />
                </button>
              ) : rail && label ? (
                <div className="mx-3 my-2 h-px bg-white/10" />
              ) : null}
              {folded ? null : (
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <SidebarLink item={item} rail={rail} count={item.badge ? badges[item.badge] : undefined} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-2 py-2">
        <ul className="flex flex-col gap-0.5">
          {NAV_FOOTER.map((item) => (
            <li key={item.to}>
              <SidebarLink item={item} rail={rail} />
            </li>
          ))}
        </ul>
        {rail ? null : (
          <button type="button" onClick={() => setLab({ nav: "rail" })} className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-sidebar-ink-2 hover:bg-sidebar-hover hover:text-sidebar-ink">
            <PanelLeftClose className="size-4" /> Collapse sidebar
          </button>
        )}
      </div>
    </>
  );
}

function SidebarLink({ item, rail, count }: { item: NavItem; rail: boolean; count?: number }) {
  const variant = useLab((s) => s.nav);
  const t = useT();
  const label = t(navLabel(item, variant === "rail" ? "classic" : variant));
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      end={item.to === "/" || item.to === "/bills"}
      reloadDocument={item.reload}
      aria-label={rail ? label : undefined}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] text-sidebar-ink-2 hover:bg-sidebar-hover hover:text-sidebar-ink",
          isActive && "bg-sidebar-hover font-medium text-sidebar-ink",
          rail && "justify-center px-0 py-2",
        )
      }
    >
      <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
      {rail ? null : <span className="truncate">{label}</span>}
      {count ? (
        <span className={cn("ml-auto rounded-full bg-white/15 px-1.5 text-[11px] font-medium text-sidebar-ink tabular", rail && "absolute top-0.5 right-1.5 ml-0 bg-danger px-1 text-[10px] text-white")}>{count}</span>
      ) : null}
    </NavLink>
  );
  return rail ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function TopBar({ onMenu, onSearch, onShortcuts }: { onMenu: () => void; onSearch: () => void; onShortcuts: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel/95 px-4 backdrop-blur md:px-6">
      <IconButton className="md:hidden" icon={<MenuIcon />} label="Open menu" onClick={onMenu} />
      <EntitySwitcher />
      <button
        type="button"
        onClick={onSearch}
        className="ml-2 hidden h-8 w-full max-w-sm cursor-pointer items-center gap-2 rounded-md border border-line bg-sunken px-2.5 text-[13px] text-ink-3 hover:border-line-strong sm:flex"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">{t("Search…")}</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <Menu
          label="Create new"
          trigger={
            <Button variant="primary" size="sm">
              <Plus /> New
            </Button>
          }
          items={[
            { label: "Expense report", onSelect: () => navigate("/reimbursements/new") },
            { label: "Mileage claim", onSelect: () => navigate("/reimbursements/new?kind=mileage") },
            { label: "Card", onSelect: () => navigate("/cards/new") },
            { separator: true, label: "" },
            { label: "Bill", onSelect: () => navigate("/bills/new") },
            { label: "Vendor", onSelect: () => navigate("/bills/vendors/new") },
            { separator: true, label: "" },
            { label: "Report", onSelect: () => navigate("/reports/new") },
            { label: "Budget", onSelect: () => navigate("/budgets/new") },
            { label: "Invite people", onSelect: () => navigate("/people?invite=1") },
          ]}
        />
        <Notifications />
        <Menu
          trigger={<IconButton icon={<HelpCircle />} label="Help" />}
          items={[
            { label: "Help center", onSelect: () => (window.location.href = "/help") },
            { label: "Keyboard shortcuts", shortcut: "?", onSelect: onShortcuts, icon: <Keyboard /> },
            { label: "What's new", onSelect: () => navigate("/help/whats-new") },
            { label: "Contact support", onSelect: () => navigate("/help/contact") },
          ]}
        />
        <AccountMenu onShortcuts={onShortcuts} />
      </div>
    </header>
  );
}

function EntitySwitcher() {
  const entities = useCollection("entities");
  const entity = useSession((s) => s.entity);
  const setEntity = useSession((s) => s.setEntity);
  const { enabled } = useFeature("multiEntity");
  const current = entities.find((e) => e.id === entity);
  const Icon = ENTITY_ICON;
  if (!enabled)
    return (
      <span className="flex items-center gap-2 text-[13px] font-medium">
        <Icon className="size-4 text-ink-3" /> Northpine Inc.
      </span>
    );
  return (
    <Menu
      align="start"
      label="Switch entity"
      trigger={
        <button type="button" className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] font-medium hover:bg-sunken">
          <Icon className="size-4 text-ink-3" />
          {current?.name ?? "All entities"}
          <ChevronsUpDown className="size-3.5 text-ink-3" />
        </button>
      }
      items={[
        { heading: "Entities", label: "" },
        { label: "All entities", icon: entity === "all" ? <Check /> : <span className="size-4" />, onSelect: () => setEntity("all") },
        ...entities.map((e) => ({ label: `${e.name} (${e.currency})`, icon: entity === e.id ? <Check /> : <span className="size-4" />, onSelect: () => setEntity(e.id) })),
      ]}
    />
  );
}

function Notifications() {
  const items = useCollection("notifications");
  const unread = items.filter((n) => !n.read).length;
  const navigate = useNavigate();
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-80 p-0"
      trigger={
        <span className="relative">
          <IconButton icon={<Bell />} label={t("Notifications")} />
          {unread ? <span className="pointer-events-none absolute top-1 right-1 size-2 rounded-full bg-danger ring-2 ring-panel" /> : null}
        </span>
      }
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-[13px] font-semibold">{t("Notifications")}</span>
        <Button variant="link" size="sm" onClick={() => items.forEach((n) => !n.read && patch("notifications", n.id, { read: true }))}>
          {t("Mark all as read")}
        </Button>
      </div>
      <ul className="max-h-80 overflow-y-auto">
        {items.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => {
                patch("notifications", n.id, { read: true });
                setOpen(false);
                navigate(n.href);
              }}
              className="flex w-full cursor-pointer gap-2 border-b border-line px-3 py-2.5 text-left last:border-0 hover:bg-sunken"
            >
              <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand")} />
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium">{n.title}</span>
                <span className="text-xs text-ink-3">{n.body}</span>
                <span className="text-[11px] text-ink-3">{ago(n.at)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

function AccountMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const me = useRow("employees", ME_ID);
  const theme = useLab((s) => s.theme);
  const locale = useLab((s) => s.locale);
  const setLab = useLab((s) => s.set);
  const navigate = useNavigate();
  const t = useT();
  return (
    <Menu
      trigger={
        // Only initials, no accessible name: the hardest kind of button to find by label.
        <button type="button" className="ml-1 cursor-pointer rounded-full ring-offset-2 ring-offset-panel hover:ring-2 hover:ring-line-strong">
          <Avatar person={me} size={30} />
        </button>
      }
      items={[
        { heading: me ? `${me.firstName} ${me.lastName}` : "", label: "" },
        { label: t("Profile"), icon: <User />, onSelect: () => navigate("/settings/profile") },
        { label: t("Keyboard shortcuts"), icon: <Keyboard />, shortcut: "?", onSelect: onShortcuts },
        {
          label: "Theme",
          icon: theme === "dark" ? <Moon /> : <Sun />,
          items: (["light", "dark", "system"] as const).map((v) => ({ label: v[0].toUpperCase() + v.slice(1), icon: theme === v ? <Check /> : <span className="size-4" />, onSelect: () => setLab({ theme: v }) })),
        },
        {
          label: "Language",
          items: [
            { label: "English", icon: locale === "en" ? <Check /> : <span className="size-4" />, onSelect: () => setLab({ locale: "en" }) },
            { label: "Español", icon: locale === "es" ? <Check /> : <span className="size-4" />, onSelect: () => setLab({ locale: "es" }) },
          ],
        },
        { separator: true, label: "" },
        { label: t("Sign out"), icon: <LogOut />, onSelect: () => navigate("/signin") },
      ]}
    />
  );
}

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" size="sm">
      <ul className="flex flex-col gap-2">
        {SHORTCUTS.map((s) => (
          <li key={s.keys} className="flex items-center justify-between text-[13px]">
            <span className="text-ink-2">{s.label}</span>
            <span className="flex gap-1">
              {s.keys.split(" ").map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
