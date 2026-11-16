import { addBusinessDays, endOfMonth, parseISO } from "date-fns";
import { ArrowRight, CheckCircle2, Lock, LockOpen, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useCollection } from "@/data/store";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { ago, date, shortDate } from "@/lib/format";
import { Button } from "@/ui/button";
import { Avatar, Badge, Callout, Card, Progress } from "@/ui/display";
import { act, Loader, RoleGate } from "@/ui/flow";
import { Checkbox, Select } from "@/ui/form";
import { ConfirmDialog } from "@/ui/overlay";
import { AccountingHeader } from "./Header";
import { CLOSE_TASKS, periods, startSync, useAccounting } from "./store";

export function ClosePage() {
  const list = periods();
  // The month being closed is last month.
  const [periodKey, setPeriodKey] = useState(list[1].key);
  const period = list.find((p) => p.key === periodKey)!;
  const locked = useAccounting((s) => s.locked[periodKey]);
  const done = useAccounting((s) => s.done[periodKey] ?? []);
  const setLocked = useAccounting((s) => s.setLocked);
  const [lockOpen, setLockOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const open = CLOSE_TASKS.length - done.length;

  return (
    <>
      <AccountingHeader
        description="Close each month, keep the ledger in sync and decide where spend lands."
        meta={locked ? <Badge tone="neutral"><Lock className="size-3" /> {period.label} locked {date(locked.slice(0, 10))}</Badge> : <Badge tone="warn" dot>{period.label} open</Badge>}
        actions={
          <>
            <Select aria-label="Period" className="w-44" value={periodKey} onValueChange={setPeriodKey} options={list.map((p) => ({ value: p.key, label: p.label }))} />
            <RoleGate action="accounting.manage">
              {(allowed) =>
                locked ? (
                  <Button disabled={!allowed} onClick={() => setReopenOpen(true)}>
                    <LockOpen /> Reopen period
                  </Button>
                ) : (
                  <Button variant="primary" disabled={!allowed} onClick={() => setLockOpen(true)}>
                    <Lock /> Lock period
                  </Button>
                )
              }
            </RoleGate>
          </>
        }
      />
      <Loader loadKey={["close", periodKey]} rows={10}>
        {() => <CloseBody periodKey={periodKey} locked={!!locked} />}
      </Loader>
      {/* Type-to-confirm, on purpose. A guide can point here but shouldn't type it for anyone. */}
      <ConfirmDialog
        open={lockOpen}
        onOpenChange={setLockOpen}
        title={`Lock ${period.label}?`}
        description={`No one can add or change transactions, bills or reimbursements dated in ${period.label}.${open ? ` ${open} checklist tasks are still open.` : ""}`}
        confirmText="LOCK"
        confirmLabel="Lock period"
        danger
        onConfirm={async () => {
          await act(() => setLocked(periodKey, true), { success: `${period.label} is locked` });
        }}
      />
      <ConfirmDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title={`Reopen ${period.label}?`}
        description="People can change entries in this month again. Anything already synced to Ledgerbook stays there."
        confirmLabel="Reopen period"
        onConfirm={async () => {
          await act(() => setLocked(periodKey, false), { success: `${period.label} reopened` });
        }}
      />
    </>
  );
}

function CloseBody({ periodKey, locked }: { periodKey: string; locked: boolean }) {
  const employees = useCollection("employees");
  const done = useAccounting((s) => s.done[periodKey] ?? []);
  const toggle = useAccounting((s) => s.toggleTask);
  const can = useCan("accounting.manage");
  const team = useMemo(() => [employees.find((e) => e.id === "emp_me")!, ...employees.filter((e) => e.departmentId === "dep_finance" && e.id !== "emp_me")].filter(Boolean), [employees]);
  const monthEnd = endOfMonth(parseISO(`${periodKey}-01`));
  const today = new Date();
  const pct = (done.length / CLOSE_TASKS.length) * 100;
  const sections = [...new Set(CLOSE_TASKS.map((t) => t.section))];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card
        title="Close checklist"
        description={`${done.length} of ${CLOSE_TASKS.length} done`}
        actions={<span className="w-40"><Progress value={pct} /></span>}
        bodyClassName="p-0"
      >
        {sections.map((section) => (
          <div key={section}>
            <h3 className="border-b border-line bg-sunken/60 px-4 py-1.5 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">{section}</h3>
            <ul>
              {CLOSE_TASKS.filter((t) => t.section === section).map((t) => {
                const isDone = done.includes(t.id);
                const due = addBusinessDays(monthEnd, t.dueDay);
                const late = !isDone && due < today;
                const who = team[t.assignee % team.length];
                return (
                  <li key={t.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                    <Checkbox checked={isDone} disabled={locked || !can.allowed} onCheckedChange={() => toggle(periodKey, t.id)} label={<span className={cn(isDone && "text-ink-3 line-through")}>{t.title}</span>} className="min-w-0 flex-1" />
                    {late ? <Badge tone="danger">Late</Badge> : null}
                    <span className={cn("w-16 text-right text-xs", late ? "text-danger" : "text-ink-3")}>{shortDate(due.toISOString())}</span>
                    <span className="flex w-36 items-center gap-2 truncate text-[12.5px] text-ink-2">
                      <Avatar person={who} size={20} />
                      <span className="truncate">{who ? `${who.firstName} ${who.lastName}` : ""}</span>
                    </span>
                    {t.href ? (
                      <Link to={t.href} aria-label={`Open ${t.title}`} className="grid size-7 place-items-center rounded text-ink-3 hover:bg-sunken hover:text-ink">
                        <ArrowRight className="size-4" />
                      </Link>
                    ) : (
                      <span className="size-7" />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Card>
      <div className="flex flex-col gap-5">
        {locked ? (
          <Callout tone="ok" title="This period is locked">Entries dated in this month can't change. Reopen it from the top of the page if you need to fix something.</Callout>
        ) : pct === 100 ? (
          <Callout tone="ok" title="Ready to lock">Every task is done. Lock the period to stop late changes.</Callout>
        ) : null}
        <SyncStatusCard />
        <Card title="Close stats">
          <dl className="grid grid-cols-2 gap-4 text-[13px]">
            <div>
              <dt className="text-xs text-ink-3">Days to close, last month</dt>
              <dd className="text-[18px] font-semibold">6</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">Target</dt>
              <dd className="text-[18px] font-semibold">5</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function SyncStatusCard() {
  const last = useAccounting((s) => s.history[0]);
  const failed = useAccounting((s) => s.failed.length);
  const job = useAccounting((s) => s.job);
  const can = useCan("accounting.manage");
  return (
    <Card
      title="Ledgerbook ERP"
      description={job.running ? job.stage : last ? `Last synced ${ago(last.startedAt)}` : "Not synced yet"}
      actions={<Badge tone={failed ? "warn" : "ok"} dot>{failed ? `${failed} failed` : "Healthy"}</Badge>}
    >
      {job.running ? (
        <Progress value={job.progress} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[13px] text-ink-2">
            <CheckCircle2 className="size-4 text-ok" /> Connected to Northpine Inc. (LB-20931)
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={!can.allowed} onClick={startSync}>
              <RefreshCw /> Sync now
            </Button>
            {/* A link dressed as a button, on purpose. */}
            <Button size="sm" variant="ghost" asChild>
              <Link to="/accounting/sync">View sync details</Link>
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
