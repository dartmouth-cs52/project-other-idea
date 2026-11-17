import { ChevronDown, ChevronRight, Download, ListPlus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { patch, upsert, useCollection } from "@/data/store";
import type { GLAccount } from "@/data/types";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { money, titleCase } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { Badge, Card, EmptyState } from "@/ui/display";
import { act, Loader, RoleGate, toast } from "@/ui/flow";
import { Field, Input, Switch, Textarea } from "@/ui/form";
import { Combobox } from "@/ui/inputs";
import { Modal } from "@/ui/overlay";
import { AccountingHeader } from "./Header";

export function ChartPage() {
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);
  return (
    <>
      <AccountingHeader
        description="Accounts mirror Ledgerbook. Turn off ones you don't want people to pick."
        actions={
          <>
            <Button onClick={() => toast.success("Chart of accounts exported")}>
              <Download /> Export
            </Button>
            <RoleGate action="accounting.manage">
              {(allowed) => (
                <Button variant="primary" disabled={!allowed} onClick={() => setAdding({ parentId: null })}>
                  <Plus /> Add account
                </Button>
              )}
            </RoleGate>
          </>
        }
      />
      <Loader loadKey="chart" rows={12}>
        {() => <ChartBody onAdd={(parentId) => setAdding({ parentId })} />}
      </Loader>
      <AddAccountModal parentId={adding?.parentId ?? null} open={!!adding} onOpenChange={(v) => !v && setAdding(null)} />
    </>
  );
}

const DETAIL: Record<GLAccount["type"], string> = { asset: "Bank / current asset", liability: "Current liability", equity: "Owner's equity", income: "Operating revenue", expense: "Operating expense" };

function ChartBody({ onAdd }: { onAdd: (parentId: string) => void }) {
  const accounts = useCollection("glAccounts");
  const can = useCan("accounting.manage");
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(accounts.filter((a) => !a.parentId).map((a) => a.id)));

  const children = useMemo(() => {
    const m = new Map<string | null, GLAccount[]>();
    for (const a of [...accounts].sort((x, y) => x.code.localeCompare(y.code))) m.set(a.parentId, [...(m.get(a.parentId) ?? []), a]);
    return m;
  }, [accounts]);

  // Search keeps matches and their ancestors, and opens every branch on the way.
  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!needle) return null;
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const keep = new Set<string>();
    for (const a of accounts) {
      if (a.code.includes(needle) || a.name.toLowerCase().includes(needle)) {
        let cur: GLAccount | undefined = a;
        while (cur) {
          keep.add(cur.id);
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
      }
    }
    return keep;
  }, [needle, accounts]);

  const rows: { a: GLAccount; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of children.get(parent) ?? []) {
      if (visible && !visible.has(a.id)) continue;
      if (!showInactive && !a.active) continue;
      rows.push({ a, depth });
      if (visible || expanded.has(a.id)) walk(a.id, depth + 1);
    }
  };
  walk(null, 0);

  const toggleActive = (a: GLAccount, v: boolean) =>
    act(() => patch("glAccounts", a.id, { active: v }), {
      success: `${a.code} ${a.name} turned ${v ? "on" : "off"}`,
      undo: () => patch("glAccounts", a.id, { active: !v }),
    });

  return (
    <Card bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Input aria-label="Search accounts" placeholder="Search by code or name" className="w-64" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set(accounts.map((a) => a.id)))}>
          Expand all
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set())}>
          Collapse all
        </Button>
        <span className="ml-auto flex items-center gap-2 text-[13px]">
          <Switch id="show-inactive" checked={showInactive} onCheckedChange={setShowInactive} />
          <label htmlFor="show-inactive" className="cursor-pointer">Show inactive</label>
        </span>
      </div>
      {/* Wider than the card, so it scrolls sideways inside it. The add button sits in the last column, on purpose. */}
      <div className="overflow-x-auto" data-scroll="chart">
        <table role="treegrid" aria-label="Chart of accounts" className="w-full min-w-[1480px] text-[13px]">
          <thead className="bg-sunken text-left text-[12px] text-ink-3">
            <tr>
              <th className="w-20 px-3 py-2 font-medium">Code</th>
              <th className="w-72 px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Detail type</th>
              <th className="px-3 py-2 font-medium">Currency</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
              <th className="px-3 py-2 text-right font-medium">YTD activity</th>
              <th className="px-3 py-2 font-medium">Tax code</th>
              <th className="px-3 py-2 font-medium">Ledgerbook ID</th>
              <th className="px-3 py-2 font-medium">Last synced</th>
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="w-14 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ a, depth }) => {
              const kids = children.get(a.id)?.length ?? 0;
              const open = !!visible || expanded.has(a.id);
              const switchId = `active-${a.id}`;
              return (
                <tr key={a.id} role="row" aria-level={depth + 1} aria-expanded={kids ? open : undefined} data-account={a.id} className={cn("border-b border-line hover:bg-sunken/60", !a.active && "text-ink-3")}>
                  <td className="tabular px-3 py-2">{a.code}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1" style={{ paddingLeft: depth * 20 }}>
                      {kids ? (
                        <button
                          type="button"
                          aria-label={`${open ? "Collapse" : "Expand"} ${a.name}`}
                          onClick={() => setExpanded((s) => {
                            const n = new Set(s);
                            if (n.has(a.id)) n.delete(a.id);
                            else n.add(a.id);
                            return n;
                          })}
                          className="grid size-5 cursor-pointer place-items-center rounded text-ink-3 hover:bg-line hover:text-ink"
                        >
                          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                        </button>
                      ) : (
                        <span className="size-5" />
                      )}
                      <span className={cn(!a.parentId && "font-semibold")}>{a.name}</span>
                      {!a.active ? <Badge className="ml-1">Inactive</Badge> : null}
                    </span>
                  </td>
                  <td className="px-3 py-2">{titleCase(a.type)}</td>
                  <td className="px-3 py-2 text-ink-2">{a.parentId ? DETAIL[a.type] : "Header"}</td>
                  <td className="px-3 py-2">USD</td>
                  <td className="tabular px-3 py-2 text-right">{money(a.balance)}</td>
                  <td className="tabular px-3 py-2 text-right text-ink-2">{money(Math.abs(a.balance) * 0.62)}</td>
                  <td className="px-3 py-2 text-ink-2">{a.type === "expense" ? "Non-taxable" : "None"}</td>
                  <td className="px-3 py-2 font-mono text-[12px] text-ink-3">LB-{a.code}-{a.id.length}</td>
                  <td className="px-3 py-2 text-ink-3">2 hours ago</td>
                  <td className="px-3 py-2">
                    <label htmlFor={switchId} className="sr-only">Active: {a.name}</label>
                    <Switch id={switchId} checked={a.active} disabled={!can.allowed} onCheckedChange={(v) => toggleActive(a, v)} />
                  </td>
                  <td className="px-3 py-2">
                    {/* Icon-only, its name only in a tooltip, on purpose. */}
                    <IconButton size="icon-sm" named={false} data-action="add-sub" icon={<ListPlus />} label="Add sub-account" disabled={!can.allowed} onClick={() => onAdd(a.id)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? <EmptyState title={`No accounts match "${q}"`} description="Search by the account code, like 6300, or part of its name." /> : null}
      </div>
    </Card>
  );
}

function AddAccountModal({ parentId, open, onOpenChange }: { parentId: string | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const accounts = useCollection("glAccounts");
  const [parent, setParent] = useState<string | null>(parentId);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<{ code?: string; name?: string }>({});
  const [busy, setBusy] = useState(false);
  const parentRow = accounts.find((a) => a.id === parent);

  useEffect(() => {
    if (!open) return;
    setParent(parentId);
    const p = accounts.find((a) => a.id === parentId);
    // Suggest the next free code under the parent.
    if (p) {
      let n = Number(p.code) + (p.parentId ? 1 : 10);
      while (accounts.some((a) => a.code === String(n))) n += p.parentId ? 1 : 10;
      setCode(String(n));
    } else setCode("");
    setName("");
    setDescription("");
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parentId]);

  const save = async () => {
    const e: typeof errors = {};
    if (!/^\d{4}$/.test(code)) e.code = "Codes are 4 digits.";
    else if (accounts.some((a) => a.code === code)) e.code = `${code} is already used.`;
    if (!name.trim()) e.name = "Name the account.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const type: GLAccount["type"] = parentRow?.type ?? (code.startsWith("1") ? "asset" : code.startsWith("2") ? "liability" : code.startsWith("3") ? "equity" : code.startsWith("4") ? "income" : "expense");
    const ok = await act(() => {
      upsert("glAccounts", { id: `gl_${code}`, code, name: name.trim(), type, parentId: parent, active: true, balance: 0 });
      return true;
    }, { success: `${code} ${name.trim()} added. It syncs to Ledgerbook in a few minutes.` });
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={parentRow ? `Add sub-account under ${parentRow.name}` : "Add account"}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Add account
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
        <Field label="Parent account" className="sm:col-span-2">
          {(id) => <Combobox id={id} value={parent} onChange={setParent} options={accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} placeholder="None (top level)" />}
        </Field>
        <Field label="Code" error={errors.code}>
          {(id) => <Input id={id} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.trim())} aria-invalid={!!errors.code} />}
        </Field>
        <Field label="Account name" error={errors.name}>
          {(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} placeholder="Conferences" />}
        </Field>
        <Field label="Description" optional className="sm:col-span-2">
          {(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        {parentRow ? <p className="text-xs text-ink-3 sm:col-span-2">Type: {titleCase(parentRow.type)}, from the parent account.</p> : null}
      </div>
    </Modal>
  );
}
