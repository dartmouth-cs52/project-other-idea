import { Check, Info, Lock, Minus, Plus, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useCollection } from "@/data/store";
import type { Role } from "@/data/types";
import { ROLE_LABELS, roleCan, useCan, type Action } from "@/lib/access";
import { useLab } from "@/lab/lab";
import { Button, IconButton, Tooltip } from "@/ui/button";
import { Badge, Card, PageHeader } from "@/ui/display";
import { act, Loader, UpgradePrompt } from "@/ui/flow";
import { Checkbox, Field, Input, Select } from "@/ui/form";
import { ConfirmDialog, Modal } from "@/ui/overlay";
import { ACTION_GROUPS, ALL_ACTIONS, PeopleTabs, ROLE_SUMMARY, ROLES, useCustomRoles, type CustomRole } from "./shared";

const LOCKED = "Built-in roles can't be changed. Create a custom role to choose permissions one by one.";

export function RolesPage() {
  // Custom roles are Enterprise only. There's no plan feature for them in access.ts, so this checks the plan directly.
  const enterprise = useLab((s) => s.plan) === "enterprise";
  const manage = useCan("people.manage");
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="People"
        description="What each role can do. Change someone's role from their profile, under Access."
        actions={
          enterprise ? (
            <Tooltip content={manage.allowed ? undefined : manage.reason}>
              <span tabIndex={manage.allowed ? undefined : 0} className="inline-flex">
                <Button variant="primary" disabled={!manage.allowed} onClick={() => setCreating(true)}>
                  <Plus /> Create custom role
                </Button>
              </span>
            </Tooltip>
          ) : (
            <>
              <UpgradePrompt title="Custom roles" needs="enterprise" compact />
              {/* Disabled, with the plan named only in the tooltip. On purpose. */}
              <Tooltip content="Custom roles are on the Enterprise plan.">
                <span tabIndex={0} className="inline-flex">
                  <Button variant="primary" disabled>
                    <Lock /> Create custom role
                  </Button>
                </span>
              </Tooltip>
            </>
          )
        }
        tabs={<PeopleTabs active="/people/roles" />}
      />
      <Loader loadKey="roles" rows={10}>
        {() => <RolesBody />}
      </Loader>
      <CustomRoleModal open={creating} onOpenChange={setCreating} />
    </>
  );
}

function RolesBody() {
  const employees = useCollection("employees");
  const custom = useCustomRoles((s) => s.roles);
  const removeRole = useCustomRoles((s) => s.remove);
  const [deleting, setDeleting] = useState<CustomRole | null>(null);
  const counts = useMemo(() => {
    const m = new Map<Role, number>();
    for (const e of employees) if (e.status !== "offboarded") m.set(e.role, (m.get(e.role) ?? 0) + 1);
    return m;
  }, [employees]);
  const cols: { key: string; label: string; has: (a: Action) => boolean; custom?: CustomRole }[] = [
    ...ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r], has: (a: Action) => roleCan(r, a) })),
    ...custom.map((c) => ({ key: c.id, label: c.name, has: (a: Action) => c.actions.includes(a), custom: c })),
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {ROLES.map((r) => (
          <div key={r} className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4 shadow-xs">
            <span className="flex items-center justify-between">
              <h3 className="text-[13.5px] font-semibold">{ROLE_LABELS[r]}</h3>
              <Badge>{counts.get(r) ?? 0}</Badge>
            </span>
            <p className="flex-1 text-[12.5px] text-ink-3">{ROLE_SUMMARY[r]}</p>
            {/* Five links that all say "View people", told apart only by the card they sit in. On purpose. */}
            <Button variant="link" size="sm" className="self-start px-0" asChild>
              <Link to={`/people?role=${r}`}>View people</Link>
            </Button>
          </div>
        ))}
      </div>

      <Card
        title={
          <span className="flex items-center gap-1.5">
            Permissions
            <Tooltip content={LOCKED}>
              <span tabIndex={0} aria-label="Why can't I edit this?" className="inline-grid cursor-help place-items-center text-ink-3">
                <Info className="size-3.5" />
              </span>
            </Tooltip>
          </span>
        }
        description="Read-only for built-in roles."
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-64 border-b border-line bg-sunken px-4 py-2 text-left text-[12px] font-medium text-ink-3">Permission</th>
                {cols.map((c) => (
                  <th key={c.key} className="min-w-28 border-b border-line bg-sunken px-3 py-2 text-center text-[12px] font-medium whitespace-nowrap text-ink-2">
                    <span className="inline-flex items-center gap-1">
                      {c.custom ? null : <Lock className="size-3 text-ink-3" />}
                      {c.label}
                      {c.custom ? <IconButton icon={<Trash2 />} label={`Delete ${c.label} role`} size="icon-sm" className="size-6" onClick={() => setDeleting(c.custom!)} /> : null}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ACTION_GROUPS.map((g) => (
                <Fragment key={g.area}>
                  <tr>
                    <th colSpan={cols.length + 1} className="sticky left-0 border-b border-line bg-panel px-4 pt-4 pb-1.5 text-left text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                      {g.area}
                    </th>
                  </tr>
                  {g.actions.map((a) => (
                    <tr key={a.action} className="hover:bg-sunken/50">
                      <th scope="row" className="sticky left-0 border-b border-line bg-panel px-4 py-2 text-left font-normal">
                        {a.label}
                      </th>
                      {cols.map((c) => {
                        const on = c.has(a.action);
                        return (
                          <td key={c.key} className="border-b border-line px-3 py-2 text-center">
                            <Tooltip content={c.custom ? undefined : LOCKED}>
                              <span aria-label={`${c.label}: ${on ? "allowed" : "not allowed"}`} className={on ? "inline-grid size-5 place-items-center rounded-full bg-ok-soft text-ok" : "inline-grid size-5 place-items-center text-ink-3"}>
                                {on ? <Check className="size-3.5" strokeWidth={3} /> : <Minus className="size-3.5" />}
                              </span>
                            </Tooltip>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete the ${deleting?.name} role?`}
        description="People with this role from your identity provider fall back to Employee."
        confirmLabel="Delete role"
        danger
        onConfirm={async () => {
          const r = deleting;
          if (r) await act(() => removeRole(r.id), { success: `Deleted ${r.name}`, undo: () => useCustomRoles.getState().save(r) });
        }}
      />
    </div>
  );
}

function CustomRoleModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const existing = useCustomRoles((s) => s.roles);
  const saveRole = useCustomRoles((s) => s.save);
  const [name, setName] = useState("");
  const [base, setBase] = useState<Role>("employee");
  const [actions, setActions] = useState<Action[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName("");
    setBase("employee");
    setActions(ALL_ACTIONS.filter((a) => roleCan("employee", a.action)).map((a) => a.action));
    setError(null);
  }, [open]);

  const save = async () => {
    const n = name.trim();
    if (!n) return setError("Name the role.");
    if ([...ROLES.map((r) => ROLE_LABELS[r]), ...existing.map((r) => r.name)].some((x) => x.toLowerCase() === n.toLowerCase())) return setError("A role with this name already exists.");
    setBusy(true);
    const ok = await act(
      () => {
        saveRole({ id: `role_${Date.now().toString(36)}`, name: n, actions });
        return true;
      },
      { success: `Created ${n}` },
    );
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Create custom role"
      description="Custom roles are assigned through your identity provider with SCIM."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Create role
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role name" error={error}>
            {(id) => <Input id={id} autoFocus value={name} aria-invalid={!!error} placeholder="Travel coordinator" onChange={(e) => (setName(e.target.value), setError(null))} />}
          </Field>
          <Field label="Start from" hint="Copies that role's permissions below.">
            {(id) => (
              <Select
                id={id}
                aria-label="Start from"
                value={base}
                onValueChange={(r) => {
                  setBase(r);
                  setActions(ALL_ACTIONS.filter((a) => roleCan(r, a.action)).map((a) => a.action));
                }}
                options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {ACTION_GROUPS.map((g) => (
            <fieldset key={g.area} className="flex flex-col gap-2">
              <legend className="mb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{g.area}</legend>
              {g.actions.map((a) => (
                <Checkbox key={a.action} checked={actions.includes(a.action)} onCheckedChange={(v) => setActions((xs) => (v ? [...xs, a.action] : xs.filter((x) => x !== a.action)))} label={a.label} />
              ))}
            </fieldset>
          ))}
        </div>
      </div>
    </Modal>
  );
}
