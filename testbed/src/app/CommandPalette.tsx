import { Command } from "cmdk";
import { ArrowRight, CreditCard, FileText, Store, User } from "lucide-react";
import { Dialog as RDialog } from "radix-ui";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useCollection } from "@/data/store";
import { useLab } from "@/lab/lab";
import { ALL_NAV_ITEMS, NAV_FOOTER, navLabel } from "./nav";

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}

const ACTIONS = [
  { label: "Issue a card", to: "/cards/new" },
  { label: "Submit an expense report", to: "/reimbursements/new" },
  { label: "Log mileage", to: "/reimbursements/new?kind=mileage" },
  { label: "Add a bill", to: "/bills/new" },
  { label: "Add a vendor", to: "/bills/vendors/new" },
  { label: "Build a report", to: "/reports/new" },
  { label: "Invite people", to: "/people?invite=1" },
  { label: "Create an API key", to: "/settings/developer" },
  { label: "Change plan", to: "/settings/billing" },
  { label: "Turn on two-factor sign-in", to: "/settings/security" },
  { label: "Review missing receipts", to: "/expenses?receipt=missing" },
];

/** ⌘K. Pages, actions, and records by name. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const variant = useLab((s) => s.nav);
  const employees = useCollection("employees");
  const vendors = useCollection("vendors");
  const cards = useCollection("cards");
  const bills = useCollection("bills");
  const [query, setQuery] = useState("");
  const go = (to: string) => {
    onOpenChange(false);
    setQuery("");
    navigate(to);
  };
  // Records only show once something is typed, and only the first few.
  const records = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;
    return {
      people: employees.filter((e) => `${e.firstName} ${e.lastName}`.toLowerCase().includes(q)).slice(0, 5),
      vendors: vendors.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 5),
      cards: cards.filter((c) => c.nickname.toLowerCase().includes(q) || c.last4.includes(q)).slice(0, 5),
      bills: bills.filter((b) => b.number.toLowerCase().includes(q)).slice(0, 5),
    };
  }, [query, employees, vendors, cards, bills]);
  const item = "flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-[13px] data-[selected=true]:bg-sunken [&_svg]:size-4 [&_svg]:text-ink-3";
  const group = "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-3 [&_[cmdk-group-heading]]:uppercase";
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RDialog.Content aria-describedby={undefined} className="fixed top-[14vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 animate-in overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
          <RDialog.Title className="sr-only">Search Northpine</RDialog.Title>
          <Command loop shouldFilter>
            <Command.Input value={query} onValueChange={setQuery} placeholder="Search pages, people, vendors, cards…" className="h-12 w-full border-b border-line bg-transparent px-4 text-[14px] outline-none placeholder:text-ink-3" />
            <Command.List className="max-h-96 overflow-y-auto p-2">
              <Command.Empty className="py-8 text-center text-[13px] text-ink-3">No results.</Command.Empty>
              <Command.Group heading="Go to" className={group}>
                {[...ALL_NAV_ITEMS, ...NAV_FOOTER].map((n) => {
                  const Icon = n.icon;
                  return (
                    <Command.Item key={n.to} value={`go ${navLabel(n, variant)} ${n.label}`} onSelect={() => go(n.to)} className={item}>
                      <Icon /> {navLabel(n, variant)}
                    </Command.Item>
                  );
                })}
              </Command.Group>
              <Command.Group heading="Actions" className={group}>
                {ACTIONS.map((a) => (
                  <Command.Item key={a.label} value={a.label} onSelect={() => go(a.to)} className={item}>
                    <ArrowRight /> {a.label}
                  </Command.Item>
                ))}
              </Command.Group>
              {records ? (
                <>
                  {records.people.length ? (
                    <Command.Group heading="People" className={group}>
                      {records.people.map((p) => (
                        <Command.Item key={p.id} value={`person ${p.firstName} ${p.lastName}`} onSelect={() => go(`/people/${p.id}`)} className={item}>
                          <User /> {p.firstName} {p.lastName} <span className="ml-auto text-xs text-ink-3">{p.title}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}
                  {records.vendors.length ? (
                    <Command.Group heading="Vendors" className={group}>
                      {records.vendors.map((v) => (
                        <Command.Item key={v.id} value={`vendor ${v.name}`} onSelect={() => go(`/bills/vendors/${v.id}`)} className={item}>
                          <Store /> {v.name}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}
                  {records.cards.length ? (
                    <Command.Group heading="Cards" className={group}>
                      {records.cards.map((c) => (
                        <Command.Item key={c.id} value={`card ${c.nickname} ${c.last4}`} onSelect={() => go(`/cards/${c.id}`)} className={item}>
                          <CreditCard /> {c.nickname} <span className="ml-auto text-xs text-ink-3">•••• {c.last4}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}
                  {records.bills.length ? (
                    <Command.Group heading="Bills" className={group}>
                      {records.bills.map((b) => (
                        <Command.Item key={b.id} value={`bill ${b.number}`} onSelect={() => go(`/bills/${b.id}`)} className={item}>
                          <FileText /> {b.number}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}
                </>
              ) : null}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
