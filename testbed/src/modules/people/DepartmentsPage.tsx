import { ChevronDown, ChevronRight, FolderInput, MoreHorizontal, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { newId, patch, remove, upsert, useCollection, useIndex } from "@/data/store";
import type { Department } from "@/data/types";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { Card, PageHeader, Person } from "@/ui/display";
import { act, Loader, RoleGate } from "@/ui/flow";
import { Field, Input, NativeSelect } from "@/ui/form";
import { Combobox } from "@/ui/inputs";
import { ConfirmDialog, Menu, Modal, type MenuEntry } from "@/ui/overlay";
import { isUnder, PeopleTabs, usePeopleOptions } from "./shared";

export function DepartmentsPage() {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHeader
        title="People"
        description="Departments, who runs them and what each one may spend in a month. Budgets and approvals follow this tree."
        actions={
          <RoleGate action="people.manage">
            {(ok) => (
              <Button variant="primary" disabled={!ok} onClick={() => setAdding(true)}>
                <Plus /> Add department
              </Button>
            )}
          </RoleGate>
        }
        tabs={<PeopleTabs active="/people/departments" />}
      />
      <Loader loadKey="departments" rows={10}>
        {() => <DepartmentTree />}
      </Loader>
      <DepartmentModal open={adding} onOpenChange={setAdding} />
    </>
  );
}

function DepartmentTree() {
  const departments = useCollection("departments");
  const employees = useCollection("employees");
  const deps = useIndex("departments");
  const people = useIndex("employees");
  const manage = useCan("people.manage");
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);

  const headcount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of employees) if (e.status !== "offboarded") m.set(e.departmentId, (m.get(e.departmentId) ?? 0) + 1);
    return m;
  }, [employees]);
  const childrenOf = (id: string | null) => departments.filter((d) => d.parentId === id).sort((a, b) => a.name.localeCompare(b.name));
  const total = (d: Department): number => (headcount.get(d.id) ?? 0) + childrenOf(d.id).reduce((s, c) => s + total(c), 0);
  const budgetTotal = departments.filter((d) => !d.parentId).reduce((s, d) => s + d.budgetMonthly, 0);

  const move = (d: Department, parentId: string | null) => {
    const to = parentId ? deps.get(parentId)?.name : "the top level";
    return act(() => patch("departments", d.id, { parentId }), { success: `Moved ${d.name} to ${to}`, undo: () => upsert("departments", d) });
  };

  const rows: { d: Department; level: number }[] = [];
  const walk = (parent: string | null, level: number) => {
    for (const d of childrenOf(parent)) {
      rows.push({ d, level });
      if (!collapsed.includes(d.id)) walk(d.id, level + 1);
    }
  };
  walk(null, 1);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-panel p-4 shadow-xs">
          <p className="text-[12.5px] text-ink-3">Departments</p>
          <p className="tabular text-[22px] font-semibold">{departments.length}</p>
        </div>
        <div className="rounded-lg border border-line bg-panel p-4 shadow-xs">
          <p className="text-[12.5px] text-ink-3">Without a manager</p>
          <p className="tabular text-[22px] font-semibold">{departments.filter((d) => !d.managerId).length}</p>
        </div>
        <div className="rounded-lg border border-line bg-panel p-4 shadow-xs">
          <p className="text-[12.5px] text-ink-3">Monthly budget, top-level teams</p>
          <p className="tabular text-[22px] font-semibold">{money(budgetTotal, "USD", { compact: true })}</p>
        </div>
      </div>

      <Card
        title="Department tree"
        description="Sub-teams roll up into their parent for budgets and reports."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => setCollapsed([])}>
              Expand all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(departments.filter((d) => childrenOf(d.id).length).map((d) => d.id))}>
              Collapse all
            </Button>
          </>
        }
        bodyClassName="p-0"
      >
        {/* Wider than a phone, so it scrolls sideways inside the card there. */}
        <div className="relative overflow-x-auto">
          <div role="treegrid" aria-label="Departments" className="min-w-[760px] text-[13px]">
            <div role="row" className="grid grid-cols-[minmax(220px,1.4fr)_minmax(180px,1fr)_110px_140px_80px_48px] border-b border-line bg-sunken px-4 py-2 text-[12px] font-medium text-ink-3">
              <span role="columnheader">Department</span>
              <span role="columnheader">Manager</span>
              <span role="columnheader" className="text-right">
                People
              </span>
              <span role="columnheader" className="text-right">
                Monthly budget
              </span>
              <span role="columnheader" className="text-right">
                GL code
              </span>
              <span role="columnheader" className="sr-only">
                Actions
              </span>
            </div>
            {rows.map(({ d, level }) => {
              const kids = childrenOf(d.id);
              const open = !collapsed.includes(d.id);
              const manager = d.managerId ? people.get(d.managerId) : undefined;
              const direct = headcount.get(d.id) ?? 0;
              const all = total(d);
              const targets = departments.filter((x) => x.id !== d.parentId && !isUnder(x.id, d.id, deps)).sort((a, b) => a.name.localeCompare(b.name));
              const items: MenuEntry[] = [
                { label: "Edit department", icon: <Pencil />, disabled: !manage.allowed, onSelect: () => setEditing(d) },
                // "Move to" opens a submenu of every department it could go under. On purpose.
                {
                  label: "Move to",
                  icon: <FolderInput />,
                  disabled: !manage.allowed,
                  items: [
                    ...(d.parentId ? [{ label: "Top level", onSelect: () => move(d, null) }, { separator: true, label: "" }] : []),
                    ...targets.map((t) => ({ label: t.name, onSelect: () => move(d, t.id) })),
                  ],
                },
                { label: "View people", icon: <Users />, onSelect: () => navigate(`/people?department=${d.id}`) },
                { separator: true, label: "" },
                {
                  label: all ? `Delete (move its ${all} people first)` : "Delete department",
                  icon: <Trash2 />,
                  danger: true,
                  disabled: !manage.allowed || all > 0 || kids.length > 0,
                  onSelect: () => setDeleting(d),
                },
              ];
              return (
                <div
                  key={d.id}
                  role="row"
                  aria-level={level}
                  aria-expanded={kids.length ? open : undefined}
                  className="group grid grid-cols-[minmax(220px,1.4fr)_minmax(180px,1fr)_110px_140px_80px_48px] items-center border-b border-line px-4 py-2 last:border-0 hover:bg-sunken/50"
                >
                  <span role="gridcell" className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: (level - 1) * 24 }}>
                    {kids.length ? (
                      <button
                        type="button"
                        aria-label={open ? `Collapse ${d.name}` : `Expand ${d.name}`}
                        onClick={() => setCollapsed((c) => (open ? [...c, d.id] : c.filter((x) => x !== d.id)))}
                        className="grid size-6 cursor-pointer place-items-center rounded text-ink-3 hover:bg-line hover:text-ink"
                      >
                        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </button>
                    ) : (
                      <span className="size-6" />
                    )}
                    <span className={cn("truncate", level === 1 && "font-medium")}>{d.name}</span>
                    {kids.length ? <span className="text-xs text-ink-3">{kids.length === 1 ? "1 team" : `${kids.length} teams`}</span> : null}
                  </span>
                  <span role="gridcell" className="min-w-0">
                    {manager ? (
                      <Link to={`/people/${manager.id}`} className="block hover:underline">
                        <Person person={manager} sub={manager.title} />
                      </Link>
                    ) : (
                      <span className="text-ink-3">No manager</span>
                    )}
                  </span>
                  <span role="gridcell" className="tabular text-right">
                    <Link to={`/people?department=${d.id}`} className="hover:underline">
                      {all}
                    </Link>
                    {kids.length ? <span className="block text-[11.5px] text-ink-3">{direct} directly</span> : null}
                  </span>
                  <span role="gridcell" className="tabular text-right">
                    {d.budgetMonthly ? money(d.budgetMonthly, "USD", { compact: true }) : <span className="text-ink-3">None</span>}
                  </span>
                  <span role="gridcell" className="text-right font-mono text-[12px] text-ink-3">
                    {d.glCode}
                  </span>
                  <span role="gridcell" className="flex justify-end">
                    <Menu label={`Actions for ${d.name}`} trigger={<IconButton icon={<MoreHorizontal />} label={`Actions for ${d.name}`} size="icon-sm" />} items={items} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {editing ? <DepartmentModal open onOpenChange={(v) => !v && setEditing(null)} department={editing} /> : null}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Budgets and reports that used it keep their history under the old name."
        confirmLabel="Delete department"
        danger
        onConfirm={async () => {
          const d = deleting;
          if (d) await act(() => remove("departments", d.id), { success: `Deleted ${d.name}`, undo: () => upsert("departments", d) });
        }}
      />
    </div>
  );
}

/** Add a department, or edit one when `department` is passed. */
function DepartmentModal({ open, onOpenChange, department }: { open: boolean; onOpenChange: (v: boolean) => void; department?: Department }) {
  const departments = useCollection("departments");
  const deps = useIndex("departments");
  const people = usePeopleOptions();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [managerId, setManagerId] = useState<string | null>(null);
  const [budget, setBudget] = useState("");
  const [gl, setGl] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(department?.name ?? "");
    setParentId(department?.parentId ?? "");
    setManagerId(department?.managerId ?? null);
    setBudget(department ? String(department.budgetMonthly) : "");
    setGl(department?.glCode ?? `D${String(departments.length + 1).padStart(2, "0")}`);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, department]);

  const parents = departments.filter((d) => !department || !isUnder(d.id, department.id, deps)).sort((a, b) => a.name.localeCompare(b.name));

  const save = async () => {
    const e: Record<string, string> = {};
    const n = name.trim();
    if (!n) e.name = "Name the department.";
    else if (departments.some((d) => d.id !== department?.id && d.name.toLowerCase() === n.toLowerCase())) e.name = "There's already a department with this name.";
    const amount = Number(budget.replace(/[,$\s]/g, ""));
    if (budget.trim() && (!Number.isFinite(amount) || amount < 0)) e.budget = "Enter an amount, like 25000.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const row: Department = { id: department?.id ?? newId("dep"), name: n, parentId: parentId || null, managerId, budgetMonthly: budget.trim() ? amount : 0, glCode: gl.trim() || "D00" };
    const ok = await act(
      () => {
        upsert("departments", row);
        return true;
      },
      { success: department ? `Saved ${n}` : `Added ${n}` },
    );
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={department ? `Edit ${department.name}` : "Add department"}
      description={department ? undefined : "New departments show up in budgets, reports and the invite form right away."}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {department ? "Save department" : "Add department"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" error={errors.name}>
          {(id) => <Input id={id} autoFocus value={name} aria-invalid={!!errors.name} placeholder="Partnerships" onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Parent department" hint="Leave empty for a top-level department.">
          {(id) => (
            <NativeSelect id={id} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">None, top level</option>
              {parents
                .filter((p) => p.id !== department?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </NativeSelect>
          )}
        </Field>
        <Field label="Manager" optional hint="Approves spend for everyone in the department.">
          {(id) => <Combobox id={id} aria-label="Manager" value={managerId} onChange={setManagerId} options={people} placeholder="Choose a person" searchPlaceholder="Search people…" />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Monthly budget" error={errors.budget} optional>
            {(id) => <Input id={id} inputMode="decimal" prefix="$" value={budget} placeholder="25,000" onChange={(e) => setBudget(e.target.value)} />}
          </Field>
          <Field label="GL code" hint="Used when exporting to accounting.">
            {(id) => <Input id={id} value={gl} onChange={(e) => setGl(e.target.value)} />}
          </Field>
        </div>
      </div>
    </Modal>
  );
}
