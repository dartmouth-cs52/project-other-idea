import { Copy, Download, Eye, MoreHorizontal, RotateCcw, ShieldOff, UserPlus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useEntityFilter } from "@/app/session";
import { ME_ID, patch, upsert, useCollection, useIndex } from "@/data/store";
import type { Employee, Role } from "@/data/types";
import { ROLE_LABELS, useCan } from "@/lib/access";
import { ago, date, fullName } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { DataTable, Pager, type ColumnDef } from "@/ui/data-table";
import { Avatar, PageHeader, Stat, StatusBadge, EmptyState } from "@/ui/display";
import { act, Loader, RoleGate, toast } from "@/ui/flow";
import { Field, Input, NativeSelect, Select } from "@/ui/form";
import { Combobox } from "@/ui/inputs";
import { ConfirmDialog, Menu, Modal } from "@/ui/overlay";
import { InviteModal } from "./InviteModal";
import { departmentOptions, isUnder, PeopleTabs, RoleBadge, ROLES } from "./shared";

const PAGE_SIZE = 25;

type StatusFilter = "current" | Employee["status"] | "all";
type Sort = "name" | "department" | "newest" | "active";

export function DirectoryPage() {
  const [params, setParams] = useSearchParams();
  const invite = useCan("people.invite");
  const inviteOpen = params.get("invite") === "1";
  const setInvite = (open: boolean) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (open) next.set("invite", "1");
        else next.delete("invite");
        return next;
      },
      { replace: !open },
    );

  return (
    <>
      <PageHeader
        title="People"
        description="Everyone at Northpine with an account, their role and who they report to."
        actions={
          <>
            <Button onClick={() => toast.success("Directory exported. Check your downloads.")}>
              <Download /> Export
            </Button>
            <RoleGate action="people.invite">
              {(ok) => (
                <Button variant="primary" disabled={!ok} onClick={() => setInvite(true)}>
                  <UserPlus /> Invite people
                </Button>
              )}
            </RoleGate>
          </>
        }
        tabs={<PeopleTabs active="/people" />}
      />
      <Loader loadKey="people" rows={12}>
        {() => <DirectoryBody />}
      </Loader>
      <InviteModal open={inviteOpen} onOpenChange={setInvite} allowed={invite.allowed} reason={invite.reason} />
    </>
  );
}

function DirectoryBody() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const all = useCollection("employees");
  const entityFilter = useEntityFilter();
  const deps = useIndex("departments");
  const departments = useCollection("departments");
  const entities = useCollection("entities");
  const people = useIndex("employees");
  const manage = useCan("people.manage");

  // Filters live in the address, so the Roles and Departments pages can link to a filtered list.
  const department = params.get("department") ?? "";
  const role = (params.get("role") ?? "") as Role | "";
  const entity = params.get("entity") ?? "";
  const status = (params.get("status") ?? "current") as StatusFilter;
  const setFilter = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value && !(key === "status" && value === "current")) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [suspending, setSuspending] = useState<string[] | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null);

  const scoped = useMemo(() => entityFilter(all), [all, entityFilter]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = scoped.filter((e) => {
      if (status === "current" ? e.status === "offboarded" : status !== "all" && e.status !== status) return false;
      if (role && e.role !== role) return false;
      if (entity && e.entityId !== entity) return false;
      if (department && !isUnder(e.departmentId, department, deps)) return false;
      if (needle && !`${e.firstName} ${e.lastName} ${e.email} ${e.title}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const by: Record<Sort, (a: Employee, b: Employee) => number> = {
      name: (a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
      department: (a, b) => (deps.get(a.departmentId)?.name ?? "").localeCompare(deps.get(b.departmentId)?.name ?? "") || a.lastName.localeCompare(b.lastName),
      newest: (a, b) => b.startDate.localeCompare(a.startDate),
      active: (a, b) => b.lastActive.localeCompare(a.lastActive),
    };
    return out.sort(by[sort]);
  }, [scoped, status, role, entity, department, q, sort, deps]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => setPage(1), [status, role, entity, department, q, sort]);
  const current = Math.min(page, pageCount);
  const pageRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const counts = useMemo(
    () => ({
      active: scoped.filter((e) => e.status === "active").length,
      invited: scoped.filter((e) => e.status === "invited").length,
      no2fa: scoped.filter((e) => e.status === "active" && !e.twoFactor).length,
      suspended: scoped.filter((e) => e.status === "suspended").length,
    }),
    [scoped],
  );

  const changeRole = (ids: string[], next: Role) => {
    const before = ids.map((id) => people.get(id)!).filter(Boolean);
    return act(() => ids.forEach((id) => patch("employees", id, { role: next })), {
      success: ids.length === 1 ? `${fullName(before[0])} is now ${ROLE_LABELS[next]}` : `${ids.length} people are now ${ROLE_LABELS[next]}`,
      undo: () => upsert("employees", ...before),
    });
  };
  const setStatus = (e: Employee, next: Employee["status"], message: string) => act(() => patch("employees", e.id, { status: next }), { success: message, undo: () => upsert("employees", e) });

  const columns = useMemo<ColumnDef<Employee, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        size: 280,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <span className="flex min-w-0 items-center gap-2.5">
              <Avatar person={e} size={28} />
              <span className="flex min-w-0 flex-col">
                <Link to={`/people/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="truncate font-medium text-ink hover:underline">
                  {fullName(e)}
                  {e.id === ME_ID ? <span className="ml-1.5 font-normal text-ink-3">(you)</span> : null}
                </Link>
                <span className="truncate text-xs text-ink-3">{e.title}</span>
              </span>
            </span>
          );
        },
      },
      { id: "email", header: "Email", enableSorting: false, cell: ({ row }) => <span className="text-ink-2">{row.original.email}</span> },
      { id: "department", header: "Department", enableSorting: false, size: 160, cell: ({ row }) => deps.get(row.original.departmentId)?.name },
      { id: "role", header: "Role", enableSorting: false, size: 110, cell: ({ row }) => <RoleBadge role={row.original.role} /> },
      {
        id: "manager",
        header: "Manager",
        enableSorting: false,
        size: 170,
        cell: ({ row }) => {
          const m = row.original.managerId ? people.get(row.original.managerId) : undefined;
          return m ? <span className="text-ink-2">{fullName(m)}</span> : <span className="text-ink-3">None</span>;
        },
      },
      { id: "entity", header: "Entity", enableSorting: false, size: 150, cell: ({ row }) => <span className="text-ink-2">{entities.find((x) => x.id === row.original.entityId)?.name}</span> },
      { id: "location", header: "Location", enableSorting: false, size: 150, cell: ({ row }) => <span className="text-ink-2">{row.original.location}</span> },
      { id: "phone", header: "Phone", enableSorting: false, size: 150, cell: ({ row }) => <span className="tabular text-ink-2">{row.original.phone || "None"}</span> },
      { id: "startDate", header: "Start date", enableSorting: false, size: 120, cell: ({ row }) => <span className="text-ink-2">{date(row.original.startDate)}</span> },
      { id: "status", header: "Status", enableSorting: false, size: 120, cell: ({ row }) => <StatusBadge status={row.original.status} /> },
      { id: "lastActive", header: "Last active", enableSorting: false, size: 130, cell: ({ row }) => <span className="text-ink-3">{row.original.status === "invited" ? "Never" : ago(row.original.lastActive)}</span> },
    ],
    [deps, people, entities],
  );

  const filtered = department || role || entity || status !== "current" || q;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active" value={counts.active} hint="can sign in and spend" />
        <button type="button" className="cursor-pointer text-left" onClick={() => setFilter("status", "invited")}>
          <Stat label="Invites pending" value={counts.invited} hint="haven't accepted yet" className="hover:ring-2 hover:ring-brand/20" />
        </button>
        <Stat label="Without two-factor" value={counts.no2fa} hint="active people" delta={counts.no2fa ? { value: "Needs attention", good: false } : undefined} />
        <Stat label="Suspended" value={counts.suspended} hint="can't sign in" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search people" placeholder="Search by name, email or title" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
        {/* A searchable combobox for departments, a custom select for role and a plain <select> for entity, like real apps mix them. */}
        <Combobox
          aria-label="Department"
          className="w-52"
          value={department || null}
          onChange={(v) => setFilter("department", v === "all" ? "" : v)}
          options={[{ value: "all", label: "All departments" }, ...departmentOptions(departments)]}
          placeholder="All departments"
          searchPlaceholder="Search departments…"
        />
        <Select aria-label="Role" className="w-40" value={role || "all"} onValueChange={(v) => setFilter("role", v === "all" ? "" : v)} options={[{ value: "all", label: "Any role" }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))]} />
        <NativeSelect aria-label="Entity" className="w-44" value={entity} onChange={(e) => setFilter("entity", e.target.value)}>
          <option value="">All entities</option>
          {entities.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </NativeSelect>
        <Select
          aria-label="Status"
          className="w-44"
          value={status}
          onValueChange={(v) => setFilter("status", v)}
          options={[
            { value: "current", label: "Active and invited" },
            { value: "active", label: "Active" },
            { value: "invited", label: "Invited" },
            { value: "suspended", label: "Suspended" },
            { value: "offboarded", label: "Offboarded" },
            { value: "all", label: "Everyone" },
          ]}
        />
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              setParams({}, { replace: true });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <DataTable
          label="People"
          data={pageRows}
          columns={columns}
          getRowId={(e) => e.id}
          height="none"
          rowHeight={52}
          selectable
          selection={selection}
          onSelectionChange={setSelection}
          columnPicker
          initialHidden={["entity", "location", "phone", "startDate"]}
          onRowClick={(e) => navigate(`/people/${e.id}`)}
          toolbar={
            <div className="flex w-full items-center justify-between gap-3">
              <span className="text-[13px] text-ink-2">
                <span className="font-medium text-ink">{rows.length}</span> {rows.length === 1 ? "person" : "people"}
                {department ? ` in ${deps.get(department)?.name} and its teams` : ""}
              </span>
              <span className="flex items-center gap-2 text-[12.5px] text-ink-3">
                Sort by
                <NativeSelect aria-label="Sort by" className="h-7 w-36" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="name">Last name</option>
                  <option value="department">Department</option>
                  <option value="newest">Newest first</option>
                  <option value="active">Recently active</option>
                </NativeSelect>
              </span>
            </div>
          }
          bulkActions={(ids, clear) => (
            <>
              <RoleGate action="people.manage">
                {(ok) => (
                  <Menu
                    align="start"
                    trigger={
                      <Button size="sm" disabled={!ok}>
                        Change role
                      </Button>
                    }
                    items={ROLES.map((r) => ({ label: ROLE_LABELS[r], onSelect: () => changeRole(ids, r).then(clear) }))}
                  />
                )}
              </RoleGate>
              <RoleGate action="people.manage">
                {(ok) => (
                  <Button size="sm" disabled={!ok} onClick={() => setMoving(ids)}>
                    Change department
                  </Button>
                )}
              </RoleGate>
              <RoleGate action="people.manage">
                {(ok) => (
                  <Button size="sm" variant="danger" disabled={!ok || ids.includes(ME_ID)} onClick={() => setSuspending(ids)}>
                    Suspend
                  </Button>
                )}
              </RoleGate>
            </>
          )}
          rowActions={(e) => (
            <>
              <IconButton icon={<Eye />} label="View profile" size="icon-sm" onClick={() => navigate(`/people/${e.id}`)} />
              {/* Icon-only with no accessible name, on purpose. The tooltip says "Copy email". */}
              <IconButton
                icon={<Copy />}
                label="Copy email"
                named={false}
                size="icon-sm"
                onClick={() => {
                  navigator.clipboard?.writeText(e.email).catch(() => undefined);
                  toast.success("Email copied");
                }}
              />
              <Menu
                label={`More actions for ${fullName(e)}`}
                trigger={<IconButton icon={<MoreHorizontal />} label={`More actions for ${fullName(e)}`} size="icon-sm" />}
                items={[
                  { label: "Open profile", icon: <Users />, onSelect: () => navigate(`/people/${e.id}`) },
                  // A submenu inside a hover-only menu, on purpose.
                  { label: "Change role", disabled: !manage.allowed, items: ROLES.map((r) => ({ label: r === e.role ? `${ROLE_LABELS[r]} (current)` : ROLE_LABELS[r], disabled: r === e.role, onSelect: () => changeRole([e.id], r) })) },
                  ...(e.status === "invited" ? [{ label: "Resend invite", icon: <RotateCcw />, disabled: !manage.allowed, onSelect: () => act(() => undefined, { success: `Invite sent again to ${e.email}` }) }] : []),
                  { separator: true, label: "" },
                  e.status === "suspended"
                    ? { label: "Reactivate", icon: <RotateCcw />, disabled: !manage.allowed, onSelect: () => setStatus(e, "active", `${fullName(e)} can sign in again`) }
                    : { label: "Suspend", icon: <ShieldOff />, danger: true, disabled: !manage.allowed || e.id === ME_ID || e.status === "offboarded", onSelect: () => setSuspending([e.id]) },
                ]}
              />
            </>
          )}
          empty={
            <EmptyState
              icon={<Users />}
              title="No one matches"
              description="Try a different name, or clear the filters."
              action={
                <Button size="sm" onClick={() => (setQ(""), setParams({}, { replace: true }))}>
                  Clear filters
                </Button>
              }
            />
          }
        />
        <div className="flex items-center justify-between text-[13px] text-ink-3">
          <span className="tabular">
            {rows.length ? `Showing ${(current - 1) * PAGE_SIZE + 1} to ${Math.min(current * PAGE_SIZE, rows.length)} of ${rows.length}` : "No results"}
          </span>
          <Pager page={current} pageCount={pageCount} onPage={setPage} />
        </div>
      </div>

      <ConfirmDialog
        open={!!suspending}
        onOpenChange={(v) => !v && setSuspending(null)}
        title={suspending?.length === 1 ? `Suspend ${fullName(people.get(suspending[0]))}?` : `Suspend ${suspending?.length} people?`}
        description="They're signed out everywhere, can't sign in, and their cards are declined until you reactivate them."
        confirmLabel="Suspend"
        danger
        onConfirm={async () => {
          const ids = suspending ?? [];
          const before = ids.map((id) => people.get(id)!).filter(Boolean);
          await act(() => ids.forEach((id) => patch("employees", id, { status: "suspended" })), {
            success: ids.length === 1 ? `Suspended ${fullName(before[0])}` : `Suspended ${ids.length} people`,
            undo: () => upsert("employees", ...before),
          });
          setSelection({});
        }}
      />
      <MoveModal
        ids={moving}
        onClose={(done) => {
          setMoving(null);
          if (done) setSelection({});
        }}
      />
    </div>
  );
}

/** Moves the selected people to another department. */
function MoveModal({ ids, onClose }: { ids: string[] | null; onClose: (done: boolean) => void }) {
  const departments = useCollection("departments");
  const people = useIndex("employees");
  const [dep, setDep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (ids) {
      setDep(null);
      setError(null);
    }
  }, [ids]);
  const target = departments.find((d) => d.id === dep);
  return (
    <Modal
      open={!!ids}
      onOpenChange={(v) => !v && onClose(false)}
      title={`Move ${ids?.length ?? 0} ${ids?.length === 1 ? "person" : "people"}`}
      description="Their manager changes to the new department's manager. Cards and budgets follow the department."
      footer={
        <>
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              if (!target || !ids) return setError("Pick a department.");
              setBusy(true);
              const before = ids.map((id) => people.get(id)!).filter(Boolean);
              const ok = await act(
                () => {
                  ids.forEach((id) => patch("employees", id, { departmentId: target.id, managerId: target.managerId === id ? null : target.managerId }));
                  return true;
                },
                { success: `Moved ${ids.length === 1 ? fullName(before[0]) : `${ids.length} people`} to ${target.name}`, undo: () => upsert("employees", ...before) },
              );
              setBusy(false);
              if (ok) onClose(true);
            }}
          >
            Move
          </Button>
        </>
      }
    >
      <Field label="New department" error={error}>
        {(id) => <Combobox id={id} aria-label="New department" value={dep} onChange={(v) => (setDep(v), setError(null))} options={departmentOptions(departments)} placeholder="Choose a department" searchPlaceholder="Search departments…" />}
      </Field>
    </Modal>
  );
}
